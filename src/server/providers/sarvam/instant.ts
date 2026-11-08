import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { AppError } from '@/server/providers/types';
import { SarvamCalling } from './calling';

// Sarvam "instant outbound": one call, dialled immediately (no campaign, no 2-minute start delay).
//   POST https://apps.sarvam.ai/api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds   (X-API-Key)
// The result arrives at the CRM webhook with the attempt_id and our metadata echoed in webhook_config.

const BASE = () => (process.env.SARVAM_OUTBOUNDS_URL || 'https://apps.sarvam.ai/api/outbounds/v1').replace(/\/$/, '');

export interface InstantCallInput {
  apiKey: string;
  orgId: string;
  workspaceId: string;
  appId: string;
  appVersion: number;
  connectionId: string;
  agentPhone: string;
  userPhone: string;
  variables: Record<string, string>;
  baseUrl: string;
  callId: string;
  extraMetadata?: Record<string, string>;
}

/** Thrown when Sarvam definitely refused the call (nothing was dialled), so a fallback is safe. */
export class InstantRefused extends AppError {}

export async function placeInstantCall(input: InstantCallInput): Promise<string> {
  const url = `${BASE()}/orgs/${encodeURIComponent(input.orgId)}/workspaces/${encodeURIComponent(input.workspaceId)}/outbounds`;
  const body = {
    app_config: {
      app_id: input.appId,
      app_version: input.appVersion,
      connection_config: { connection_id: input.connectionId, agent_phone_number: input.agentPhone },
      ...(Object.keys(input.variables).length ? { agent_variables: input.variables } : {}),
    },
    user_config: { user_phone_number: input.userPhone },
    webhook_config: SarvamCalling.webhookConfig(input.baseUrl, { crm_kind: 'instant', call_id: input.callId, app_id: input.appId, ...(input.extraMetadata ?? {}) }),
  };
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'X-API-Key': input.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(25_000) });
  } catch {
    // Unknown whether Sarvam dialled: do not place a second call.
    throw new AppError('Sarvam did not confirm the call in time. If it rings, the result still appears in Call Logs.', 'sarvam_timeout');
  }
  const text = await res.text();
  if (!res.ok) {
    console.error('[sarvam instant] HTTP', res.status, text.slice(0, 1000));
    const detail = (() => {
      try {
        const j = JSON.parse(text) as { detail?: unknown; error?: { message?: string; data?: { details?: unknown } } };
        if (j.error) return String(j.error.data?.details ?? j.error.message ?? '');
        return typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? (j.detail as { msg?: string }[]).map((d) => d.msg).filter(Boolean).join('; ') : '';
      } catch {
        return '';
      }
    })();
    throw new InstantRefused(`Sarvam refused the instant call (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}.`, 'sarvam_refused', text.slice(0, 2000));
  }
  const attempt = (JSON.parse(text) as { attempt_id?: string }).attempt_id;
  if (!attempt) throw new AppError('Sarvam accepted the call but returned no attempt id.', 'sarvam_http');
  return attempt;
}

export async function instantCredsFor(admin: DB) {
  const { SarvamRecordings } = await import('@/server/services/sarvam-recordings');
  return SarvamRecordings.apiCreds(admin);
}

/**
 * Safety net if a result webhook is lost: instant calls still "ringing" after 5 minutes are looked up in
 * Sarvam's attempts report and finished like a webhook would; after an hour with no record they are failed.
 */
export async function reconcileInstantCalls(admin: DB, limit = 10): Promise<number> {
  const creds = await instantCredsFor(admin);
  if (!creds) return 0;
  const { data: stale } = await admin
    .from('calls')
    .select('id, provider_call_id, started_at, phone_e164')
    .eq('provider', 'sarvam')
    .eq('status', 'ringing')
    .eq('is_simulated', false)
    .not('provider_call_id', 'is', null)
    .lt('started_at', new Date(Date.now() - 5 * 60_000).toISOString())
    .order('started_at')
    .limit(limit);
  if (!stale?.length) return 0;
  const { SarvamWebhookService } = await import('@/server/services/sarvam-webhook-service');
  let fixed = 0;
  for (const c of stale) {
    const { data: ev } = await admin.from('call_events').select('payload').eq('call_id', c.id).eq('event_type', 'submitted_to_sarvam').order('occurred_at', { ascending: false }).limit(1).maybeSingle();
    const appId = (ev?.payload as { agent?: string } | null)?.agent;
    if (!appId) continue;
    const from = new Date(new Date(c.started_at).getTime() - 10 * 60_000).toISOString();
    const to = new Date(Math.min(Date.now(), new Date(c.started_at).getTime() + 3 * 3600_000)).toISOString();
    const q = new URLSearchParams({ start_datetime: from, end_datetime: to, limit: '5', filter_conditions: JSON.stringify([{ field: 'attempt_id', operator: 'equals', value: c.provider_call_id }]) });
    const url = `${(process.env.SARVAM_ANALYTICS_URL || 'https://apps.sarvam.ai/api/analytics/v1').replace(/\/$/, '')}/${encodeURIComponent(creds.orgId)}/${encodeURIComponent(creds.workspaceId)}/${encodeURIComponent(appId)}/attempts?${q}`;
    try {
      const res = await fetch(url, { headers: { 'X-API-Key': creds.apiKey }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const item = ((await res.json()) as { items?: Record<string, unknown>[] }).items?.find((i) => i.attempt_id === c.provider_call_id);
      if (item && typeof item.connectivity_status === 'string') {
        const fr = typeof item.failure_reason === 'string' && item.failure_reason !== 'NO_FAILURE_REASON' ? item.failure_reason : null;
        await SarvamWebhookService.handleInstant(admin, {
          attempt_id: c.provider_call_id!,
          status: item.connectivity_status,
          duration: typeof item.duration_in_seconds === 'number' ? item.duration_in_seconds : null,
          interaction_id: typeof item.interaction_id === 'string' ? item.interaction_id : null,
          failure_reason: fr,
          final_agent_variables: (item.agent_variables as Record<string, unknown> | null) ?? null,
          interaction_transcript: null,
          channel_info: { agent_phone_number: typeof item.bot_contact_identifier === 'string' ? item.bot_contact_identifier : null },
          webhook_config: { metadata: { app_id: appId, call_id: c.id, crm_kind: 'instant', reconciled: 'attempts_report' } },
        });
        fixed++;
      } else if (Date.now() - new Date(c.started_at).getTime() > 60 * 60_000) {
        await admin.from('calls').update({ status: 'failed', failure_reason: 'Sarvam has no record of this call attempt (checked after 1 hour).' }).eq('id', c.id).eq('status', 'ringing');
        await admin.from('call_events').insert({ call_id: c.id, event_type: 'failed', status: 'failed', source: 'system', payload: { reason: 'no_record_at_sarvam' } });
        fixed++;
      }
    } catch (e) {
      console.error('[sarvam instant] reconcile', e);
    }
  }
  return fixed;
}
