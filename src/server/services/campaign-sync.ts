import 'server-only';
import type { DB } from '@/lib/supabase/types';

// Safety net for live campaigns: if a result webhook is lost, the contact would stay "in progress" and the
// campaign would never finish. Sarvam's attempts report (Analytics API) lists every dial with our
// user_identifier ("cc:<campaign contact>"), so missing attempts are replayed through the normal pipeline.

const ANALYTICS = () => (process.env.SARVAM_ANALYTICS_URL || 'https://apps.sarvam.ai/api/analytics/v1').replace(/\/$/, '');
const none = (v: unknown, empty: string) => (typeof v === 'string' && v && v !== empty && v !== 'UNKNOWN' ? v : null);

export async function reconcileCampaign(admin: DB, campaignId: string, opts: { staleMinutes?: number } = {}): Promise<{ replayed: number; stillOpen: number }> {
  const { SarvamRecordings } = await import('@/server/services/sarvam-recordings');
  const creds = await SarvamRecordings.apiCreds(admin);
  const { data: cp } = await admin.from('campaigns').select('id, status, mode, provider_campaign_id, started_at, created_at, voice_agents(provider_agent_id)').eq('id', campaignId).maybeSingle();
  const appId = (cp?.voice_agents as { provider_agent_id: string | null } | null)?.provider_agent_id;
  if (!creds || !cp || cp.mode !== 'live' || !cp.provider_campaign_id || !appId) return { replayed: 0, stillOpen: 0 };
  const cutoff = new Date(Date.now() - (opts.staleMinutes ?? 10) * 60_000).toISOString();
  const { data: open } = await admin.from('campaign_contacts').select('id').eq('campaign_id', campaignId).eq('status', 'in_progress').lt('last_attempt_at', cutoff).limit(1000);
  if (!open?.length) return { replayed: 0, stillOpen: 0 };
  const openIds = new Set(open.map((o) => o.id));

  const from = new Date(new Date(cp.started_at ?? cp.created_at).getTime() - 3600_000).toISOString();
  const items: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const q = new URLSearchParams({
      start_datetime: from,
      end_datetime: new Date().toISOString(),
      limit: '1000',
      offset: String(offset),
      sort_by: 'attempted_at',
      sort_order: 'asc',
      filter_conditions: JSON.stringify([{ field: 'campaign_id', operator: 'equals', value: cp.provider_campaign_id }]),
    });
    const res = await fetch(`${ANALYTICS()}/${encodeURIComponent(creds.orgId)}/${encodeURIComponent(creds.workspaceId)}/${encodeURIComponent(appId)}/attempts?${q}`, {
      headers: { 'X-API-Key': creds.apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) break;
    const page = ((await res.json()) as { items?: Record<string, unknown>[] }).items ?? [];
    items.push(...page);
    if (page.length < 1000) break;
  }
  const candidates = items.filter((i) => {
    const m = /^cc:([0-9a-f-]{36})$/.exec(String(i.user_identifier ?? ''));
    return m && openIds.has(m[1]) && typeof i.attempt_id === 'string' && typeof i.connectivity_status === 'string';
  });
  if (!candidates.length) return { replayed: 0, stillOpen: open.length };
  const { data: known } = await admin.from('calls').select('provider_call_id').eq('provider', 'sarvam').in('provider_call_id', candidates.map((c) => c.attempt_id as string));
  const seen = new Set((known ?? []).map((k) => k.provider_call_id));
  const { data: line } = await admin.from('campaigns').select('phone_numbers(phone_e164)').eq('id', campaignId).maybeSingle();
  const agentPhone = (line?.phone_numbers as { phone_e164: string } | null)?.phone_e164 ?? null;
  const { SarvamWebhookService } = await import('@/server/services/sarvam-webhook-service');
  let replayed = 0;
  for (const i of candidates) {
    if (seen.has(i.attempt_id as string)) continue;
    const status = String(i.connectivity_status);
    const phone = typeof i.user_contact === 'string' ? i.user_contact : null;
    if (!phone) continue;
    try {
      await SarvamWebhookService.handleOutbound(admin, {
        attempt_id: i.attempt_id as string,
        campaign_id: cp.provider_campaign_id,
        completion_status: status === 'connected' ? 'completed' : 'failed',
        connectivity_status: status,
        next_action_status: none(i.next_action_status, ''),
        retry_attempt: typeof i.retry_attempt === 'number' ? Math.max(0, i.retry_attempt - 1) : 0, // report is 1-based, webhooks 0-based
        failure_reason: none(i.failure_reason, 'NO_FAILURE_REASON'),
        user_identifier: String(i.user_identifier),
        user_phone_number: phone,
        agent_phone_number: none(i.bot_contact_identifier, '') ?? agentPhone,
        app_id: appId,
        app_version: typeof i.app_version === 'number' ? i.app_version : null,
        interaction_id: none(i.interaction_id, 'NO_INTERACTION_ID'),
        duration: typeof i.duration_in_seconds === 'number' ? i.duration_in_seconds : null,
        start_datetime: none(i.start_datetime, '') ? `${i.start_datetime}Z` : null,
        end_datetime: none(i.end_datetime, '') ? `${i.end_datetime}Z` : null,
        executed_at: none(i.attempted_at, '') ? `${i.attempted_at}Z` : null,
        final_agent_variables: (i.agent_variables as Record<string, unknown> | null) ?? null,
        metadata: { reconciled: 'attempts_report' },
      });
      replayed++;
    } catch (e) {
      console.error('[campaign sync] replay', e);
    }
  }
  const { count } = await admin.from('campaign_contacts').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).in('status', ['pending', 'in_progress']);
  return { replayed, stillOpen: count ?? 0 };
}

/** Background pass over running live campaigns (bounded). */
export async function reconcileRunningCampaigns(admin: DB, limit = 3): Promise<number> {
  const { data } = await admin.from('campaigns').select('id').eq('mode', 'live').eq('status', 'running').not('provider_campaign_id', 'is', null).order('started_at', { ascending: false }).limit(limit);
  let n = 0;
  for (const c of data ?? []) n += (await reconcileCampaign(admin, c.id).catch(() => ({ replayed: 0 }))).replayed;
  return n;
}
