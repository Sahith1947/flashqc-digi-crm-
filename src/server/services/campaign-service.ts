import 'server-only';
import type { DB } from '@/lib/supabase/types';
import type { TablesUpdate } from '@/lib/supabase/database.types';
import { istTimeOfDay, isWithinWindow } from '@/lib/dates';
import { AppError, ProviderNotConfiguredError } from '@/server/providers/types';
import { evaluateCallable, suppressedNumbers } from './compliance';
import { TelephonyService } from './telephony-service';
import { createAdminClient } from '@/lib/supabase/admin';
import { SarvamCalling } from '@/server/providers/sarvam/calling';

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
        const live = await TelephonyService.liveStatus({ voiceAgentId: campaign.voice_agent_id, phoneNumberId: campaign.phone_number_id });
        if (!live.available) throw new AppError(`Live calling is not ready: ${live.reason}`, 'live_not_ready');
        if (live.via === 'sarvam') await this.startOnSarvam(db, campaign);
        else if (!campaign.phone_number_id) throw new AppError('Select a business phone number for a live campaign');
      }
    }
    if (campaign.mode === 'live' && campaign.provider_campaign_id && (to === 'paused' || to === 'cancelled')) {
      const admin = createAdminClient();
      if (!admin) throw new AppError('SUPABASE_SECRET_KEY is required for live campaigns');
      await SarvamCalling.control(admin, campaign.provider_campaign_id, to === 'paused' ? 'pause' : 'cancel');
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
   * Creates (first start) or resumes the Sarvam campaign, then uploads every contact that
   * passes compliance and has not been sent yet. Blocked contacts are skipped with a reason.
   */
  async startOnSarvam(db: DB, campaign: Awaited<ReturnType<typeof getCampaign>>) {
    const admin = createAdminClient();
    if (!admin) throw new AppError('SUPABASE_SECRET_KEY is required for live campaigns');
    // Use the agent's newest published version (re-read from Sarvam when the last sync is over 2 minutes old).
    await (await import('@/server/services/sarvam-service')).SarvamService.autoSync(admin, 2 * 60_000).catch((e) => console.error('[sarvam] version sync', e));
    const r = await SarvamCalling.readiness(admin, { voiceAgentId: campaign.voice_agent_id, phoneNumberId: campaign.phone_number_id });
    if (!r.ok) throw new AppError(`Live calling is not ready: ${r.reason}`, 'live_not_ready');

    let providerId = campaign.provider_campaign_id;
    if (!providerId) {
      providerId = await SarvamCalling.createCampaign(admin, {
        name: `CRM ${campaign.name}`,
        description: campaign.description ?? 'Bulk campaign from FlashQC Digi CRM',
        agent: r.agent,
        line: r.line,
        baseUrl: r.baseUrl,
        maxAttempts: campaign.max_attempts,
        windowStart: campaign.calling_window_start,
        windowEnd: campaign.calling_window_end,
        metadata: { crm_kind: 'campaign', crm_campaign_id: campaign.id },
      });
      const { error } = await admin
        .from('campaigns')
        .update({ provider: 'sarvam', provider_campaign_id: providerId, provider_synced_at: new Date().toISOString(), voice_agent_id: r.agent.id, phone_number_id: r.line.id })
        .eq('id', campaign.id);
      if (error) throw error;
    } else {
      await SarvamCalling.control(admin, providerId, 'resume');
    }

    // Upload pending contacts (new campaign, or contacts added while paused).
    const { data: pending, error } = await db
      .from('campaign_contacts')
      .select('id, contact_id, contacts(phone_e164, full_name, business_name, business_category, city, consent_status, dnd_status)')
      .eq('campaign_id', campaign.id)
      .eq('status', 'pending')
      .limit(10000);
    if (error) throw error;
    type Row = { id: string; contacts: { phone_e164: string; full_name: string | null; business_name: string | null; business_category: string | null; city: string | null; consent_status: string; dnd_status: string } | null };
    const rows = (pending ?? []) as unknown as Row[];
    const suppressed = await suppressedNumbers(db, rows.map((x) => x.contacts?.phone_e164).filter((x): x is string => Boolean(x)));
    const send: { ccId: string; user: { user_phone_number: string; user_identifier: string; app_variables: Record<string, string> } }[] = [];
    for (const row of rows) {
      const c = row.contacts;
      const check = c ? evaluateCallable(suppressed.has(c.phone_e164), c) : { allowed: false, reason: 'Contact no longer exists' };
      if (!c || !check.allowed) {
        await db.from('campaign_contacts').update({ status: 'skipped', skip_reason: check.reason }).eq('id', row.id);
        continue;
      }
      const vars: Record<string, string> = {};
      if (c.full_name) vars.user_name = c.full_name;
      if (c.business_name) vars.business_name = c.business_name;
      if (c.business_category) vars.business_category = c.business_category;
      if (c.city) vars.location = c.city;
      send.push({ ccId: row.id, user: { user_phone_number: c.phone_e164, user_identifier: `cc:${row.id}`, app_variables: vars } });
    }
    if (send.length) {
      await SarvamCalling.streamUsers(admin, providerId, `CRM ${campaign.name}`, send.map((x) => x.user));
      const now = new Date().toISOString();
      for (let i = 0; i < send.length; i += 500) {
        await db.from('campaign_contacts').update({ status: 'in_progress', last_attempt_at: now }).in('id', send.slice(i, i + 500).map((x) => x.ccId)).eq('status', 'pending');
      }
    }
    return { uploaded: send.length };
  },

  /**
   * Processes up to `batchSize` contacts of a running campaign.
   * Claims rows atomically (pending → in_progress) so concurrent workers never
   * dial the same contact twice. Completes the campaign when nothing is left.
   */
  async processBatch(db: DB, id: string, batchSize = 5) {
    const campaign = await getCampaign(db, id);
    if (campaign.status !== 'running') return { processed: 0, remaining: 0, status: campaign.status, note: null as string | null };

    if (campaign.mode === 'live' && campaign.provider_campaign_id) {
      // Sarvam dials; results arrive by webhook. Only report progress here.
      const { count: open } = await db
        .from('campaign_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', id)
        .in('status', ['pending', 'in_progress']);
      if (!open) {
        await this.transition(db, id, 'completed').catch(() => undefined);
        return { processed: 0, remaining: 0, status: 'completed', note: null };
      }
      return { processed: 0, remaining: open, status: 'running', note: `Sarvam is dialling — ${open} contact${open === 1 ? '' : 's'} waiting for a result. Results appear as each call ends.` };
    }
    if (campaign.mode === 'live') {
      if (!(await TelephonyService.liveStatus()).available) {
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
