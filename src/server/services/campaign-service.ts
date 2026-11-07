import 'server-only';
import type { DB } from '@/lib/supabase/types';
import type { TablesUpdate } from '@/lib/supabase/database.types';
import { istTimeOfDay, isWithinWindow } from '@/lib/dates';
import { AppError, ProviderNotConfiguredError } from '@/server/providers/types';
import { evaluateCallable, suppressedNumbers } from './compliance';
import { TelephonyService } from './telephony-service';

const TRANSITIONS: Record<string, string[]> = {
  draft: ['running', 'cancelled'],
  running: ['paused', 'completed', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: [],
  cancelled: [],
};

const RETRYABLE = ['no_answer', 'busy'];

async function getCampaign(db: DB, id: string) {
  const { data, error } = await db.from('campaigns').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Campaign not found', 'not_found');
  return data;
}

export const CampaignService = {
  async enrollContacts(db: DB, campaignId: string, contactIds: string[]): Promise<number> {
    const unique = [...new Set(contactIds)];
    let added = 0;
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500).map((contact_id) => ({ campaign_id: campaignId, contact_id }));
      const { data, error } = await db
        .from('campaign_contacts')
        .upsert(chunk, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      added += data?.length ?? 0;
    }
    return added;
  },

  async transition(db: DB, id: string, to: 'running' | 'paused' | 'cancelled' | 'completed') {
    const campaign = await getCampaign(db, id);
    if (!TRANSITIONS[campaign.status]?.includes(to)) {
      throw new AppError(`A ${campaign.status} campaign cannot be changed to ${to}`, 'invalid_transition');
    }

    if (to === 'running') {
      const { count, error } = await db
        .from('campaign_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', id);
      if (error) throw error;
      if (!count) throw new AppError('Add at least one contact before starting the campaign');
      if (campaign.mode === 'live') {
        if (!TelephonyService.isLiveCallingAvailable()) throw new ProviderNotConfiguredError('Live campaign calling');
        if (!campaign.phone_number_id) throw new AppError('Select a business phone number for a live campaign');
      }
    }

    const now = new Date().toISOString();
    const patch: TablesUpdate<'campaigns'> = { status: to };
    if (to === 'running') {
      patch.paused_at = null;
      if (!campaign.started_at) patch.started_at = now;
    }
    if (to === 'paused') patch.paused_at = now;
    if (to === 'completed' || to === 'cancelled') patch.completed_at = now;

    // Optimistic concurrency: only apply if status has not changed meanwhile.
    const { data, error } = await db.from('campaigns').update(patch).eq('id', id).eq('status', campaign.status).select('id');
    if (error) throw error;
    if (!data?.length) throw new AppError('Campaign was changed by someone else. Refresh and try again.', 'conflict');

    if (to === 'cancelled') {
      await db.from('campaign_contacts').update({ status: 'skipped', skip_reason: 'Campaign cancelled' }).eq('campaign_id', id).eq('status', 'pending');
    }
  },

  /**
   * Processes up to `batchSize` contacts of a running campaign.
   * Claims rows atomically (pending → in_progress) so concurrent workers never
   * dial the same contact twice. Completes the campaign when nothing is left.
   */
  async processBatch(db: DB, id: string, batchSize = 5) {
    const campaign = await getCampaign(db, id);
    if (campaign.status !== 'running') return { processed: 0, remaining: 0, status: campaign.status, note: null as string | null };

    if (campaign.mode === 'live') {
      if (!TelephonyService.isLiveCallingAvailable()) {
        await this.transition(db, id, 'paused');
        throw new ProviderNotConfiguredError('Live campaign calling');
      }
      if (!isWithinWindow(istTimeOfDay(), campaign.calling_window_start, campaign.calling_window_end)) {
        return { processed: 0, remaining: -1, status: 'running', note: 'Outside the calling window (IST). Waiting.' };
      }
    }

    const retryFilter = `and(status.eq.failed,outcome.in.(${RETRYABLE.join(',')}),attempts.lt.${campaign.max_attempts})`;
    const { data: candidates, error } = await db
      .from('campaign_contacts')
      .select('id, contact_id, attempts, status')
      .eq('campaign_id', id)
      .or(`status.eq.pending,${retryFilter}`)
      .order('created_at', { ascending: true })
      .limit(batchSize);
    if (error) throw error;

    if (!candidates?.length) {
      const { count: inFlight } = await db
        .from('campaign_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', id)
        .eq('status', 'in_progress');
      if (!inFlight) {
        await this.transition(db, id, 'completed').catch(() => undefined);
        return { processed: 0, remaining: 0, status: 'completed', note: null };
      }
      return { processed: 0, remaining: inFlight, status: 'running', note: 'Waiting for in-flight calls' };
    }

    // Claim
    const claimed: typeof candidates = [];
    for (const c of candidates) {
      const { data } = await db
        .from('campaign_contacts')
        .update({ status: 'in_progress', last_attempt_at: new Date().toISOString() })
        .eq('id', c.id)
        .eq('status', c.status)
        .select('id');
      if (data?.length) claimed.push(c);
    }

    const { data: contacts, error: cErr } = await db
      .from('contacts')
      .select('id, phone_e164, consent_status, dnd_status')
      .in('id', claimed.map((c) => c.contact_id));
    if (cErr) throw cErr;
    const byId = new Map((contacts ?? []).map((c) => [c.id, c]));
    const suppressed = await suppressedNumbers(db, (contacts ?? []).map((c) => c.phone_e164));

    let processed = 0;
    for (const cc of claimed) {
      const contact = byId.get(cc.contact_id);
      if (!contact) {
        await db.from('campaign_contacts').update({ status: 'skipped', skip_reason: 'Contact no longer exists' }).eq('id', cc.id);
        continue;
      }
      const check = evaluateCallable(suppressed.has(contact.phone_e164), contact);
      if (!check.allowed) {
        await db.from('campaign_contacts').update({ status: 'skipped', skip_reason: check.reason }).eq('id', cc.id);
        processed++;
        continue;
      }
      try {
        const res = await TelephonyService.startOutboundCall(db, {
          phoneE164: contact.phone_e164,
          contactId: contact.id,
          phoneNumberId: campaign.phone_number_id,
          voiceAgentId: campaign.voice_agent_id,
          campaignId: campaign.id,
          mode: campaign.mode as 'simulated' | 'live',
          skipComplianceCheck: true,
        });
        // Live calls stay in_progress until the provider webhook reports the result.
        const finished = res.simulated;
        await db
          .from('campaign_contacts')
          .update({
            status: finished ? (res.status === 'completed' ? 'completed' : 'failed') : 'in_progress',
            outcome: finished ? (res.outcome ?? res.status) : null,
            attempts: cc.attempts + 1,
            last_call_id: res.callId,
          })
          .eq('id', cc.id);
      } catch (err) {
        await db
          .from('campaign_contacts')
          .update({
            status: 'failed',
            outcome: 'error',
            attempts: cc.attempts + 1,
            skip_reason: (err instanceof Error ? err.message : 'Call failed').slice(0, 300),
          })
          .eq('id', cc.id);
        if (err instanceof ProviderNotConfiguredError) {
          await this.transition(db, id, 'paused').catch(() => undefined);
          throw err;
        }
      }
      processed++;
    }

    const { count: remaining } = await db
      .from('campaign_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .or(`status.eq.pending,${retryFilter}`);
    return { processed, remaining: remaining ?? 0, status: 'running', note: null };
  },
};
