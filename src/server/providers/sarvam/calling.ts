import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { serverEnv } from '@/server/env';
import { sarvamWebhookSecret } from '@/server/crypto';
import { AppError } from '@/server/providers/types';
import { SarvamAuth } from './auth';
import { SarvamMcpClient } from './mcp-client';

// Live calling through Sarvam (sarvam://playbooks/campaigns, sarvam://playbooks/telephony).
// Outbound dialling is a Sarvam campaign: CRM campaigns map 1:1 to Sarvam campaigns, and
// one always-on "direct" campaign carries one-off Live calls. Results come back through
// the call-end webhook, authenticated by a secret the CRM puts in the webhook metadata.

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface LiveAgent {
  id: string;
  name: string;
  appId: string;
  version: number;
}
export interface LiveLine {
  id: string;
  phone: string;
  connectionId: string;
}
export type Readiness = { ok: true; agent: LiveAgent; line: LiveLine; baseUrl: string } | { ok: false; reason: string };

export interface CohortUser {
  user_phone_number: string;
  user_identifier: string;
  app_variables?: Record<string, string>;
}

const hhmm = (t: string) => t.slice(0, 5);

/** Sarvam names must match ^[\w\- ]{1,50}$ (letters, digits, underscore, hyphen, space). */
export function sarvamName(raw: string, fallback = 'FlashQC CRM'): string {
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[\u2013\u2014\u00b7|/:.,]+/g, ' - ')
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(\s*-\s*)+/g, ' - ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .slice(0, 50)
    .trim();
  return cleaned || fallback;
}

async function client(admin: DB) {
  const c = await SarvamMcpClient.connect(admin);
  if (!c) throw new AppError('Sarvam is not connected. Connect it on the Integrations page.', 'sarvam_not_connected');
  return c;
}

function retryConfig(maxAttempts: number) {
  const n = Math.max(0, Math.min(4, maxAttempts - 1));
  return {
    max_retries: n,
    retry_interval_minutes: Array.from({ length: n }, () => 30),
    retry_on: {
      busy: { enabled: n > 0 },
      no_answer: { enabled: n > 0 },
      failed: { enabled: false },
      short_duration: { enabled: false, threshold_seconds: 10 },
      provider_error: { enabled: true, max_retries: 1, retry_interval_minutes: 5 },
      internal_error: { enabled: true, max_retries: 1, retry_interval_minutes: 5 },
    },
  };
}

export const SarvamCalling = {
  webhookConfig(baseUrl: string, extra: Record<string, string> = {}) {
    return { url: `${baseUrl}/api/webhooks/telephony/sarvam`, metadata: { crm_secret: sarvamWebhookSecret(), source: 'flashqc-crm', ...extra } };
  },

  /** Everything a live call needs, or the plain-language reason it cannot happen yet. */
  async readiness(admin: DB, opts: { voiceAgentId?: string | null; phoneNumberId?: string | null } = {}): Promise<Readiness> {
    let aq = admin
      .from('voice_agents')
      .select('id, name, provider_agent_id, provider_committed_version, status, connection_status')
      .eq('provider', 'sarvam')
      .not('provider_agent_id', 'is', null);
    if (opts.voiceAgentId) aq = aq.eq('id', opts.voiceAgentId);
    let lq = admin.from('phone_numbers').select('id, phone_e164, provider_connection_id, can_outbound, enabled').not('provider_connection_id', 'is', null);
    if (opts.phoneNumberId) lq = lq.eq('id', opts.phoneNumberId);
    // The three lookups are independent: run them together.
    const [auth, { data: agents }, { data: lines }] = await Promise.all([SarvamAuth.status(admin), aq.order('created_at'), lq.order('created_at')]);
    if (!auth.connected) return { ok: false, reason: 'Sarvam is not connected (Integrations → Connect Sarvam).' };
    const baseUrl = serverEnv.publicBaseUrl;
    if (!baseUrl) return { ok: false, reason: 'Live calls run on the deployed site (call results need a public web address).' };

    const agent = (agents ?? []).find((a) => a.connection_status === 'connected' && a.status !== 'disabled' && a.provider_committed_version);
    if (!agent) {
      return {
        ok: false,
        reason: opts.voiceAgentId
          ? 'The selected voice agent is not a synced Sarvam agent with a published version.'
          : 'No synced Sarvam agent with a published version. Publish the agent in Sarvam, then Voice Agents → Sync from Sarvam.',
      };
    }

    const line = (lines ?? []).find((l) => l.enabled && l.can_outbound);
    if (!line) {
      return {
        ok: false,
        reason: opts.phoneNumberId
          ? 'The selected business number is not a Sarvam number that can make outbound calls.'
          : 'No Sarvam phone number in the CRM. Phone Numbers → Sync from Sarvam.',
      };
    }
    return {
      ok: true,
      baseUrl,
      agent: { id: agent.id, name: agent.name, appId: agent.provider_agent_id!, version: agent.provider_committed_version! },
      line: { id: line.id, phone: line.phone_e164, connectionId: line.provider_connection_id! },
    };
  },

  async createCampaign(
    admin: DB,
    input: { name: string; description?: string; agent: LiveAgent; line: LiveLine; baseUrl: string; maxAttempts: number; windowStart: string; windowEnd: string; days?: number; metadata?: Record<string, string> },
  ): Promise<string> {
    const c = await client(admin);
    // Sarvam requires the start to be at least 120 s in the future.
    const start = new Date(Date.now() + 130_000); // Sarvam requires a start at least 120 s ahead
    // Sarvam caps a campaign's duration at 90 days.
    const end = new Date(start.getTime() + Math.min(input.days ?? 30, 85) * 86400_000);
    const res = await c.callTool<{ id?: string | null; campaign_id?: string }>('configure_campaign', {
      name: sarvamName(input.name),
      description: (input.description ?? 'Created by FlashQC Digi CRM').slice(0, 150),
      start_timestamp: start.toISOString(),
      end_timestamp: end.toISOString(),
      allowed_schedule: { timezone: 'Asia/Kolkata', allowed_start_time: hhmm(input.windowStart), allowed_end_time: hhmm(input.windowEnd), allowed_days: ALL_DAYS },
      app_config: this.campaignAppConfig(input),
    });
    const id = res.id ?? res.campaign_id;
    if (!id) throw new AppError('Sarvam did not return a campaign id.', 'sarvam_tool');
    return id;
  },

  campaignAppConfig(input: { agent: LiveAgent; line: LiveLine; baseUrl: string; maxAttempts: number; metadata?: Record<string, string> }) {
    return {
      app_type: 'agent',
      app_id: input.agent.appId,
      app_version: input.agent.version,
      attempts_per_second: 1.0,
      connection_configs: [{ connection_id: input.line.connectionId, phone_numbers: [input.line.phone], weight: 1 }],
      retry_config: retryConfig(input.maxAttempts),
      webhook_config: this.webhookConfig(input.baseUrl, input.metadata),
    };
  },

  /** While a campaign is paused: move it to the agent's newest published version (and current line). */
  async patchCampaignAgent(admin: DB, campaignId: string, input: { agent: LiveAgent; line: LiveLine; baseUrl: string; maxAttempts: number; metadata?: Record<string, string> }) {
    const c = await client(admin);
    await c.callTool('configure_campaign', { campaign_id: campaignId, app_config: this.campaignAppConfig(input) });
  },

  async streamUsers(admin: DB, campaignId: string, name: string, users: CohortUser[]): Promise<string[]> {
    const c = await client(admin);
    const cohorts: string[] = [];
    for (let i = 0; i < users.length; i += 1000) {
      const res = await c.callTool<{ id?: string; cohort_id?: string }>('stream_cohort_users', {
        parent: 'campaign',
        parent_id: campaignId,
        name: sarvamName(`${name}${users.length > 1000 ? ` part ${i / 1000 + 1}` : ''}`, 'FlashQC CRM contacts'),
        users: users.slice(i, i + 1000),
      });
      const id = res.id ?? res.cohort_id;
      if (id) cohorts.push(id);
    }
    return cohorts;
  },

  async control(admin: DB, campaignId: string, operation: 'pause' | 'resume' | 'cancel') {
    const c = await client(admin);
    await c.callTool('campaigns', { operation, id: campaignId });
  },

  async campaignStatus(admin: DB, campaignId: string): Promise<string | null> {
    const c = await client(admin);
    try {
      const res = await c.callTool<{ status?: string; campaign?: { status?: string } }>('campaigns', { operation: 'get', id: campaignId });
      return res.status ?? res.campaign?.status ?? null;
    } catch {
      return null;
    }
  },

  /**
   * The always-on campaign used for one-off Live calls.
   * - Calling hours changed → the same campaign's schedule is updated in place (queued calls keep their place).
   * - Agent version, number or site address changed → a new campaign replaces it, the old one is cancelled,
   *   and calls still waiting in the old one are moved to the new one.
   */
  async directCampaign(admin: DB, r: Extract<Readiness, { ok: true }>): Promise<string> {
    const { data: s } = await admin
      .from('app_settings')
      .select('sarvam_direct_campaign_id, sarvam_direct_campaign_key, default_calling_window_start, default_calling_window_end')
      .maybeSingle();
    const windowStart = s?.default_calling_window_start ?? '09:00';
    const windowEnd = s?.default_calling_window_end ?? '21:00';
    const base = `${r.agent.appId}@v${r.agent.version}|${r.line.phone}|${r.baseUrl}`;
    const win = `${hhmm(windowStart)}-${hhmm(windowEnd)}`;
    const key = `${base}#${win}`;
    const [storedBase, storedWin] = (s?.sarvam_direct_campaign_key ?? '').split('#');
    const currentId = s?.sarvam_direct_campaign_id ?? null;

    if (currentId && storedBase === base) {
      const status = (await this.campaignStatus(admin, currentId))?.toLowerCase() ?? '';
      if (!/cancel|complete|expired|fail/.test(status)) {
        if (storedWin !== win) {
          await this.updateSchedule(admin, currentId, windowStart, windowEnd, status);
          await admin.from('app_settings').update({ sarvam_direct_campaign_key: key }).eq('id', true);
        }
        return currentId;
      }
    }

    const id = await this.createCampaign(admin, {
      name: 'FlashQC CRM Live calls',
      description: 'One-off live calls placed from the FlashQC Digi CRM',
      agent: r.agent,
      line: r.line,
      baseUrl: r.baseUrl,
      maxAttempts: 1,
      windowStart,
      windowEnd,
      days: 85,
      metadata: { crm_kind: 'direct' },
    });
    await admin.from('app_settings').update({ sarvam_direct_campaign_id: id, sarvam_direct_campaign_key: key }).eq('id', true);
    if (currentId && currentId !== id) {
      // Retire the old campaign so it never dials with outdated settings, then move its waiting calls.
      await this.control(admin, currentId, 'cancel').catch((e) => console.error('[sarvam] cancel old direct campaign', e));
      await this.restreamQueued(admin, currentId, id).catch((e) => console.error('[sarvam] restream queued calls', e));
    }
    return id;
  },

  /** Sarvam edits only paused or scheduled campaigns: pause (if active), patch the hours, resume. */
  async updateSchedule(admin: DB, campaignId: string, windowStart: string, windowEnd: string, status: string) {
    const c = await client(admin);
    const active = status === 'active' || status === 'running';
    if (active) await c.callTool('campaigns', { operation: 'pause', id: campaignId });
    try {
      await c.callTool('configure_campaign', {
        campaign_id: campaignId,
        allowed_schedule: { timezone: 'Asia/Kolkata', allowed_start_time: hhmm(windowStart), allowed_end_time: hhmm(windowEnd), allowed_days: ALL_DAYS },
      });
    } finally {
      if (active) await c.callTool('campaigns', { operation: 'resume', id: campaignId });
    }
  },

  /** Re-submits CRM live calls that were still waiting in a replaced campaign. */
  async restreamQueued(admin: DB, oldCampaignId: string, newCampaignId: string): Promise<number> {
    const { data: events } = await admin
      .from('call_events')
      .select('call_id')
      .in('event_type', ['submitted_to_sarvam', 'resubmitted_to_sarvam'])
      .eq('payload->>sarvam_campaign_id', oldCampaignId);
    const ids = [...new Set((events ?? []).map((e) => e.call_id))];
    if (!ids.length) return 0;
    const { data: calls } = await admin
      .from('calls')
      .select('id, phone_e164, contacts(full_name, business_name, business_category, city)')
      .in('id', ids)
      .eq('status', 'queued')
      .is('provider_call_id', null);
    type Row = { id: string; phone_e164: string; contacts: { full_name: string | null; business_name: string | null; business_category: string | null; city: string | null } | null };
    const rows = (calls ?? []) as unknown as Row[];
    if (!rows.length) return 0;
    const users = rows.map((r) => {
      const v: Record<string, string> = {};
      if (r.contacts?.full_name) v.user_name = r.contacts.full_name;
      if (r.contacts?.business_name) v.business_name = r.contacts.business_name;
      if (r.contacts?.business_category) v.business_category = r.contacts.business_category;
      if (r.contacts?.city) v.location = r.contacts.city;
      return { user_phone_number: r.phone_e164, user_identifier: `call:${r.id}`, app_variables: v };
    });
    const cohorts = await this.streamUsers(admin, newCampaignId, 'CRM resubmitted calls', users);
    await admin.from('call_events').insert(
      rows.map((r) => ({
        call_id: r.id,
        event_type: 'resubmitted_to_sarvam',
        status: 'queued',
        source: 'system' as const,
        payload: { sarvam_campaign_id: newCampaignId, replaced_campaign_id: oldCampaignId, cohort_ids: cohorts },
      })),
    );
    return rows.length;
  },

  /** Applies the current calling hours to the live-call campaign right away (called after Settings change). */
  async applyCallingHours(admin: DB): Promise<string | null> {
    const r = await this.readiness(admin);
    if (!r.ok) return null;
    const { data: s } = await admin.from('app_settings').select('sarvam_direct_campaign_id').maybeSingle();
    if (!s?.sarvam_direct_campaign_id) return null; // created with the right hours on the first live call
    return this.directCampaign(admin, r);
  },

  /** Publishes (commits) an agent's current draft in Sarvam, so deployments and campaigns may use it. */
  async publishAgentDraft(admin: DB, appId: string): Promise<void> {
    const c = await client(admin);
    await c.callTool('agents', { operation: 'commit', id: appId, params: { app_version_description: 'Published from FlashQC Digi CRM' } });
  },

  /**
   * Moves the inbound deployments on the CRM's numbers to the agent's newest committed (published)
   * version. Sarvam edits only paused deployments: pause, patch app_version, and always resume.
   */
  async followLatestVersion(admin: DB): Promise<{ name: string; from: number | null; to: number }[]> {
    const c = await client(admin);
    const [{ data: lines }, { data: agents }] = await Promise.all([
      admin.from('phone_numbers').select('phone_e164').not('provider_connection_id', 'is', null),
      admin.from('voice_agents').select('provider_agent_id, provider_committed_version').eq('provider', 'sarvam').not('provider_committed_version', 'is', null),
    ]);
    const ours = new Set((lines ?? []).map((l) => l.phone_e164));
    const latest = new Map((agents ?? []).map((a) => [a.provider_agent_id, a.provider_committed_version as number]));
    const list = await c.callTool<{ items?: { deployment_id: string; name: string; app_id?: string; app_version?: number; phone_numbers?: string[]; status?: string }[] }>('telephony', { operation: 'list_deployments', params: { limit: 50 } });
    const moved: { name: string; from: number | null; to: number }[] = [];
    for (const d of list.items ?? []) {
      if (!(d.phone_numbers ?? []).some((p) => ours.has(p))) continue;
      const to = d.app_id ? latest.get(d.app_id) : undefined;
      if (!to || (d.app_version ?? 0) >= to) continue;
      const wasActive = (d.status ?? '').toLowerCase() === 'active';
      try {
        if (wasActive) await c.callTool('telephony', { operation: 'pause_deployment', id: d.deployment_id });
        await c.callTool('configure_deployment', { deployment_id: d.deployment_id, app_version: to });
        moved.push({ name: d.name, from: d.app_version ?? null, to });
      } finally {
        if (wasActive) {
          await c.callTool('telephony', { operation: 'resume_deployment', id: d.deployment_id }).catch(async () => {
            await c.callTool('telephony', { operation: 'resume_deployment', id: d.deployment_id });
          });
        }
      }
    }
    return moved;
  },

  /** Points Sarvam's inbound deployments for the CRM's numbers at the CRM webhook. */
  async enableInboundSync(admin: DB): Promise<{ deployments: string[] }> {
    const baseUrl = serverEnv.publicBaseUrl;
    if (!baseUrl) throw new AppError('Inbound sync needs the deployed site (a public web address for call results).');
    const c = await client(admin);
    const { data: lines } = await admin.from('phone_numbers').select('phone_e164').not('provider_connection_id', 'is', null);
    const ours = new Set((lines ?? []).map((l) => l.phone_e164));
    const list = await c.callTool<{ items?: { deployment_id: string; name: string; app_id?: string; app_version?: number; phone_numbers?: string[]; status?: string }[] }>('telephony', { operation: 'list_deployments', params: { limit: 50 } });
    const targets = (list.items ?? []).filter((d) => (d.phone_numbers ?? []).some((p) => ours.has(p)));
    if (!targets.length) throw new AppError('No Sarvam inbound deployment uses the CRM’s numbers. Sync numbers first, or create an inbound deployment in Sarvam.');
    for (const d of targets) {
      // Sarvam only edits paused deployments: pause, apply, and always resume (a few seconds offline).
      const wasActive = (d.status ?? '').toLowerCase() === 'active';
      try {
        if (wasActive) await c.callTool('telephony', { operation: 'pause_deployment', id: d.deployment_id });
        await c.callTool('configure_deployment', { deployment_id: d.deployment_id, webhook_config: this.webhookConfig(baseUrl, { crm_kind: 'inbound' }) });
      } catch (e) {
        // Only blame a draft version when Sarvam's own version list says so.
        const info = await c.callTool<{ versions?: { app_version: number; status: string }[] }>('agents', { operation: 'get', id: d.app_id ?? '', params: { include: ['versions'] } }).catch(() => null);
        const committed = new Set((info?.versions ?? []).filter((v) => v.status === 'committed').map((v) => v.app_version));
        if (info && d.app_version && !committed.has(d.app_version)) {
          throw new AppError(
            `Sarvam would not update the inbound deployment "${d.name}": it answers with draft version ${d.app_version}. Publish that version in Sarvam, then click "Enable inbound call sync" again.`,
            'sarvam_deployment_draft',
          );
        }
        throw e;
      } finally {
        if (wasActive) {
          await c.callTool('telephony', { operation: 'resume_deployment', id: d.deployment_id }).catch(async () => {
            // One retry; never leave the line paused silently.
            await c.callTool('telephony', { operation: 'resume_deployment', id: d.deployment_id });
          });
        }
      }
    }
    await admin.from('app_settings').update({ sarvam_inbound_webhook_at: new Date().toISOString() }).eq('id', true);
    return { deployments: targets.map((d) => d.name) };
  },
};
