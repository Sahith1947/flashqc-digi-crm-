import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { normalizePhone } from '@/lib/phone';
import { AppError, type HealthResult } from '@/server/providers/types';
import { SarvamMcpClient } from '@/server/providers/sarvam/mcp-client';

// Reads from the connected Sarvam workspace and mirrors it into the CRM.
// Every write here uses the backend (service role) client, because the
// synced fields are provider-verified and the database refuses them from users.
// Nothing in this service changes anything in the Sarvam account.

interface Page<T> {
  items: T[];
  pagination?: { more?: boolean; next_offset?: number; total?: number };
}
export interface SarvamAgentSummary {
  app_id: string;
  app_name: string;
  app_version: number;
  status: string;
  channel_type: string;
  is_deployed: boolean | null;
}
interface SarvamAgentConfig extends SarvamAgentSummary {
  intro_message_config?: { audio?: string | null } | null;
  language_config?: { initial_language_name?: string; supported_languages?: string[] } | null;
}
interface SarvamConnection {
  connection_id: string;
  name: string;
  channel_type: string;
  channel_provider: string;
  status: string;
}

const LANGUAGE_CODES: Record<string, string> = {
  English: 'en-IN',
  Hindi: 'hi-IN',
  Telugu: 'te-IN',
  Tamil: 'ta-IN',
  Kannada: 'kn-IN',
  Malayalam: 'ml-IN',
  Marathi: 'mr-IN',
  Gujarati: 'gu-IN',
  Bengali: 'bn-IN',
  Punjabi: 'pa-IN',
  Odia: 'od-IN',
};

async function client(admin: DB) {
  const c = await SarvamMcpClient.connect(admin);
  if (!c) throw new AppError('Sarvam is not connected. Connect it on the Integrations page.', 'sarvam_not_connected');
  return c;
}

async function listAll<T>(c: SarvamMcpClient, tool: string, operation: string, id?: string) {
  const items: T[] = [];
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    const page = await c.callTool<Page<T>>(tool, { operation, ...(id ? { id } : {}), params: { offset, limit: 50 } });
    items.push(...(page.items ?? []));
    if (!page.pagination?.more || page.pagination.next_offset == null) break;
    offset = page.pagination.next_offset;
  }
  return items;
}

function endpointNumber(e: Record<string, unknown>): string | null {
  for (const k of ['phone_number', 'number', 'e164', 'endpoint', 'did', 'phone']) {
    const v = e[k];
    if (typeof v === 'string') {
      const p = normalizePhone(v);
      if (p.ok) return p.e164;
    }
  }
  return null;
}

export const SarvamService = {
  async health(admin: DB): Promise<HealthResult> {
    const c = await SarvamMcpClient.connect(admin);
    if (!c) return { ok: false, verified: false, message: 'Sarvam is not connected. Use "Connect Sarvam" to sign in.' };
    const agents = await c.callTool<Page<SarvamAgentSummary>>('agents', { operation: 'list', params: { limit: 1 } });
    const total = agents.pagination?.total ?? agents.items.length;
    return { ok: true, verified: true, message: `Connected to Sarvam. ${total} voice agent${total === 1 ? '' : 's'} in the workspace.` };
  },

  async telephonyHealth(admin: DB): Promise<HealthResult & { connections: number; numbers: number }> {
    const c = await SarvamMcpClient.connect(admin);
    if (!c) return { ok: false, verified: false, message: 'Sarvam is not connected.', connections: 0, numbers: 0 };
    const conns = await listAll<SarvamConnection>(c, 'telephony', 'list_connections');
    let numbers = 0;
    for (const conn of conns) {
      const d = await c.callTool<{ endpoints?: unknown[] }>('telephony', { operation: 'get_connection', id: conn.connection_id, params: { include: ['endpoints'] } });
      numbers += d.endpoints?.length ?? 0;
    }
    const ok = conns.some((x) => x.status === 'connection_successful') && numbers > 0;
    const providers = [...new Set(conns.map((x) => x.channel_provider))].join(', ') || 'none';
    return {
      ok,
      verified: true,
      connections: conns.length,
      numbers,
      message: ok
        ? `Sarvam telephony ready: ${conns.length} connection(s) (${providers}), ${numbers} number(s) onboarded.`
        : conns.length === 0
          ? 'No telephony connection in the Sarvam workspace.'
          : `Sarvam telephony connection (${providers}) exists, but no phone number is onboarded yet, so calls cannot be placed.`,
    };
  },

  /** Mirrors every Sarvam agent into voice_agents (matched by provider id, then by name). */
  /**
   * Keeps the CRM on the agent's newest published version without anyone pressing "Sync":
   * re-reads the agents when the last sync is older than `maxAgeMs`, and when a newer version was
   * published, moves the inbound line to it. Live calls pick the new version up by themselves.
   */
  async autoSync(admin: DB, maxAgeMs = 5 * 60_000): Promise<{ synced: boolean; changed: { agent: string; from: number | null; to: number }[]; inbound: { name: string; from: number | null; to: number }[] }> {
    const { data: before } = await admin.from('voice_agents').select('provider_agent_id, name, provider_committed_version, provider_synced_at').eq('provider', 'sarvam').not('provider_agent_id', 'is', null);
    const last = Math.max(0, ...(before ?? []).map((a) => (a.provider_synced_at ? new Date(a.provider_synced_at).getTime() : 0)));
    if (Date.now() - last < maxAgeMs) return { synced: false, changed: [], inbound: [] };
    await this.syncAgents(admin);
    const { data: after } = await admin.from('voice_agents').select('provider_agent_id, name, provider_committed_version').eq('provider', 'sarvam').not('provider_agent_id', 'is', null);
    const prev = new Map((before ?? []).map((a) => [a.provider_agent_id, a.provider_committed_version]));
    const changed = (after ?? [])
      .filter((a) => a.provider_committed_version && a.provider_committed_version !== prev.get(a.provider_agent_id))
      .map((a) => ({ agent: a.name, from: prev.get(a.provider_agent_id) ?? null, to: a.provider_committed_version as number }));
    let inbound: { name: string; from: number | null; to: number }[] = [];
    const { data: s } = await admin.from('app_settings').select('sarvam_inbound_webhook_at').maybeSingle();
    if (s?.sarvam_inbound_webhook_at) {
      const { SarvamCalling } = await import('@/server/providers/sarvam/calling');
      inbound = await SarvamCalling.followLatestVersion(admin);
    }
    if (changed.length) {
      // Prepare the fallback calling list for the new version now, so no customer waits for Sarvam's start delay.
      const { SarvamCalling } = await import('@/server/providers/sarvam/calling');
      await SarvamCalling.applyCallingHours(admin).catch((e) => console.error('[sarvam] pre-warm campaign', e));
    }
    return { synced: true, changed, inbound };
  },

  async syncAgents(admin: DB) {
    const c = await client(admin);
    const summaries = await listAll<SarvamAgentSummary>(c, 'agents', 'list');
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    for (const s of summaries) {
      const detail = await c.callTool<{ config?: SarvamAgentConfig; versions?: { app_version: number; status: string }[] }>('agents', { operation: 'get', id: s.app_id, params: { include: ['config', 'versions'] } });
      const committed = (detail.versions ?? []).filter((v) => v.status === 'committed').map((v) => v.app_version);
      const cfg = detail.config ?? (s as SarvamAgentConfig);
      const langs = cfg.language_config?.supported_languages ?? [];
      const initial = cfg.language_config?.initial_language_name ?? langs[0] ?? 'English';
      const row = {
        name: s.app_name.slice(0, 120),
        provider: 'sarvam' as const,
        provider_agent_id: s.app_id,
        language: LANGUAGE_CODES[initial] ?? 'en-IN',
        greeting: cfg.intro_message_config?.audio?.slice(0, 2000) ?? null,
        description: `Synced from Sarvam · ${s.channel_type} · languages: ${langs.join(', ') || initial}`.slice(0, 1000),
        provider_status: s.status,
        provider_version: s.app_version,
        provider_committed_version: committed.length ? Math.max(...committed) : null,
        provider_deployed: Boolean(s.is_deployed),
        provider_synced_at: now,
        connection_status: 'connected' as const,
      };
      const { data: byId } = await admin.from('voice_agents').select('id').eq('provider', 'sarvam').eq('provider_agent_id', s.app_id).maybeSingle();
      const { data: byName } = byId
        ? { data: null }
        : await admin.from('voice_agents').select('id').ilike('name', row.name.replace(/[%_]/g, '\\$&')).is('provider_agent_id', null).maybeSingle();
      const targetId = byId?.id ?? byName?.id;
      if (targetId) {
        const { error } = await admin.from('voice_agents').update(row).eq('id', targetId);
        if (error) throw error;
        updated++;
      } else {
        const { error } = await admin.from('voice_agents').insert({ ...row, status: 'draft' });
        if (error) throw error;
        created++;
      }
    }
    // Agents that were synced before but no longer exist in Sarvam.
    const ids = summaries.map((s) => s.app_id);
    let q = admin.from('voice_agents').update({ connection_status: 'error', provider_status: 'missing_in_sarvam', provider_synced_at: now }).eq('provider', 'sarvam').not('provider_synced_at', 'is', null);
    if (ids.length) q = q.not('provider_agent_id', 'in', `(${ids.map((i) => `"${i}"`).join(',')})`);
    const { data: missing } = await q.select('id');
    return { total: summaries.length, created, updated, missing: missing?.length ?? 0 };
  },

  /** Imports numbers onboarded in Sarvam telephony into phone_numbers. */
  async syncNumbers(admin: DB) {
    const c = await client(admin);
    const conns = await listAll<SarvamConnection>(c, 'telephony', 'list_connections');
    const now = new Date().toISOString();
    let imported = 0;
    let skipped = 0;
    for (const conn of conns) {
      const d = await c.callTool<{ endpoints?: Record<string, unknown>[] }>('telephony', { operation: 'get_connection', id: conn.connection_id, params: { include: ['endpoints'] } });
      for (const e of d.endpoints ?? []) {
        const phone = endpointNumber(e);
        if (!phone) {
          skipped++;
          continue;
        }
        const provider = (['vobiz', 'exotel', 'twilio', 'plivo', 'knowlarity'] as const).find((p) => p === conn.channel_provider) ?? 'sarvam';
        const row = {
          phone_e164: phone,
          provider,
          provider_number_id: String(e.endpoint_id ?? e.id ?? '').slice(0, 200) || null,
          provider_connection_id: conn.connection_id,
          provider_synced_at: now,
          connection_status: conn.status === 'connection_successful' ? ('connected' as const) : ('error' as const),
        };
        const { data: existing } = await admin.from('phone_numbers').select('id').eq('phone_e164', phone).maybeSingle();
        const { error } = existing
          ? await admin.from('phone_numbers').update(row).eq('id', existing.id)
          : await admin.from('phone_numbers').insert({ ...row, label: `Sarvam ${conn.channel_provider} ${phone.slice(-4)}`, can_inbound: true, can_outbound: true });
        if (error) throw error;
        imported++;
      }
    }
    return { connections: conns.length, connectionSummary: conns.map((x) => ({ provider: x.channel_provider, status: x.status })), imported, skipped };
  },

  /**
   * Looks up a call's recording in Sarvam analytics (the webhook can arrive before the audio exists,
   * or without it). Attaches it when Sarvam has one; never invents a URL.
   */
  async fetchRecording(admin: DB, callId: string): Promise<'attached' | 'already' | 'not_available' | 'not_applicable'> {
    const { data: call } = await admin
      .from('calls')
      .select('id, provider, provider_call_id, direction, started_at, ended_at, answered_at, is_simulated')
      .eq('id', callId)
      .maybeSingle();
    if (!call || call.is_simulated || call.provider !== 'sarvam' || !call.answered_at) return 'not_applicable';
    const { count } = await admin.from('call_recordings').select('id', { count: 'exact', head: true }).eq('call_id', callId);
    if (count) return 'already';
    // With a Sarvam API key every answered call's recording is available through the Analytics API.
    const { SarvamRecordings } = await import('@/server/services/sarvam-recordings');
    if (await SarvamRecordings.mark(admin, callId)) return 'attached';
    const { data: ev } = await admin
      .from('call_events')
      .select('payload')
      .eq('call_id', callId)
      .eq('source', 'provider_webhook')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const payload = (ev?.payload ?? {}) as { interaction_id?: string; app_id?: string };
    const interactionId = payload.interaction_id ?? (call.direction === 'inbound' ? call.provider_call_id : null);
    if (!interactionId || !payload.app_id) return 'not_applicable';
    const c = await client(admin);
    const from = new Date(new Date(call.started_at).getTime() - 15 * 60_000).toISOString();
    const to = new Date(new Date(call.ended_at ?? call.started_at).getTime() + 60 * 60_000).toISOString();
    const report = await c.callTool<{ items?: { interaction_id: string; audio_url?: string | null; duration_in_seconds?: number }[] }>('analytics', {
      operation: 'report',
      id: 'interactions',
      params: { start_datetime: from, end_datetime: to, app_id: payload.app_id },
    });
    const hit = (report.items ?? []).find((i) => i.interaction_id === interactionId);
    if (!hit?.audio_url || !/^https:\/\//.test(hit.audio_url)) return 'not_available';
    const { error } = await admin.from('call_recordings').insert({
      call_id: callId,
      source: 'provider',
      provider_recording_url: hit.audio_url.slice(0, 4000),
      provider_recording_id: interactionId.slice(0, 200),
      duration_seconds: hit.duration_in_seconds ? Math.round(hit.duration_in_seconds) : null,
    });
    if (error && error.code !== '23505') throw error;
    await admin.from('call_events').insert({ call_id: callId, event_type: 'recording_fetched', source: 'system', payload: { interaction_id: interactionId } });
    return 'attached';
  },

  /** Background sweep: recent answered Sarvam calls without a recording (bounded). */
  async sweepRecordings(admin: DB, limit = 5): Promise<number> {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data } = await admin
      .from('call_log_view')
      .select('id')
      .eq('provider', 'sarvam')
      .eq('has_recording', false)
      .not('answered_at', 'is', null)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(limit);
    let attached = 0;
    for (const r of data ?? []) {
      try {
        if ((await this.fetchRecording(admin, r.id!)) === 'attached') attached++;
      } catch (e) {
        console.error('[sarvam] recording sweep', e);
        break;
      }
    }
    return attached;
  },
};

