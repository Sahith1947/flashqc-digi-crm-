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
  async syncAgents(admin: DB) {
    const c = await client(admin);
    const summaries = await listAll<SarvamAgentSummary>(c, 'agents', 'list');
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    for (const s of summaries) {
      const detail = await c.callTool<{ config?: SarvamAgentConfig }>('agents', { operation: 'get', id: s.app_id, params: { include: ['config'] } });
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
};
