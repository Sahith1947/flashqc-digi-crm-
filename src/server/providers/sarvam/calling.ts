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
    if (!(await SarvamAuth.status(admin)).connected) return { ok: false, reason: 'Sarvam is not connected (Integrations → Connect Sarvam).' };
    const baseUrl = serverEnv.publicBaseUrl;
    if (!baseUrl) return { ok: false, reason: 'Live calls run on the deployed site (call results need a public web address).' };

    let aq = admin
      .from('voice_agents')
      .select('id, name, provider_agent_id, provider_committed_version, status, connection_status')
      .eq('provider', 'sarvam')
      .not('provider_agent_id', 'is', null);
    if (opts.voiceAgentId) aq = aq.eq('id', opts.voiceAgentId);
    const { data: agents } = await aq.order('created_at');
    const agent = (agents ?? []).find((a) => a.connection_status === 'connected' && a.status !== 'disabled' && a.provider_committed_version);
    if (!agent) {
      return {
        ok: false,
        reason: opts.voiceAgentId
          ? 'The selected voice agent is not a synced Sarvam agent with a published version.'
          : 'No synced Sarvam agent with a published version. Publish the agent in Sarvam, then Voice Agents → Sync from Sarvam.',
      };
    }

    let lq = admin.from('phone_numbers').select('id, phone_e164, provider_connection_id, can_outbound, enabled').not('provider_connection_id', 'is', null);
    if (opts.phoneNumberId) lq = lq.eq('id', opts.phoneNumberId);
    const { data: lines } = await lq.order('created_at');
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
    const start = new Date(Date.now() + 60_000);
    // Sarvam caps a campaign's duration at 90 days.
    const end = new Date(start.getTime() + Math.min(input.days ?? 30, 85) * 86400_000);
    const res = await c.callTool<{ id?: string | null; campaign_id?: string }>('configure_campaign', {
      name: sarvamName(input.name),
      description: (input.description ?? 'Created by FlashQC Digi CRM').slice(0, 150),
      start_timestamp: start.toISOString(),
      end_timestamp: end.toISOString(),
      allowed_schedule: { timezone: 'Asia/Kolkata', allowed_start_time: hhmm(input.windowStart), allowed_end_time: hhmm(input.windowEnd), allowed_days: ALL_DAYS },
      app_config: {
        app_type: 'agent',
        app_id: input.agent.appId,
        app_version: input.agent.version,
        attempts_per_second: 1.0,
        connection_configs: [{ connection_id: input.line.connectionId, phone_numbers: [input.line.phone], weight: 1 }],
        retry_config: retryConfig(input.maxAttempts),
        webhook_config: this.webhookConfig(input.baseUrl, input.metadata),
      },
    });
    const id = res.id ?? res.campaign_id;
    if (!id) throw new AppError('Sarvam did not return a campaign id.', 'sarvam_tool');
    return id;
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

  /** The always-on campaign used for one-off Live calls, recreated if the agent version or number changes. */
  async directCampaign(admin: DB, r: Extract<Readiness, { ok: true }>): Promise<string> {
    const { data: s } = await admin
      .from('app_settings')
      .select('sarvam_direct_campaign_id, sarvam_direct_campaign_key, default_calling_window_start, default_calling_window_end')
      .maybeSingle();
    const windowStart = s?.default_calling_window_start ?? '09:00';
    const windowEnd = s?.default_calling_window_end ?? '21:00';
    // The calling hours are part of the key: changing them in Settings replaces the campaign.
    const key = `${r.agent.appId}@v${r.agent.version}|${r.line.phone}|${r.baseUrl}|${hhmm(windowStart)}-${hhmm(windowEnd)}`;
    if (s?.sarvam_direct_campaign_id && s.sarvam_direct_campaign_key === key) {
      const status = (await this.campaignStatus(admin, s.sarvam_direct_campaign_id))?.toLowerCase() ?? '';
      if (!/cancel|complete|expired|fail/.test(status)) return s.sarvam_direct_campaign_id;
    }
    if (s?.sarvam_direct_campaign_id && s.sarvam_direct_campaign_key !== key) {
      // Retire the previous one so it can never dial with outdated settings (e.g. wider hours).
      await this.control(admin, s.sarvam_direct_campaign_id, 'cancel').catch((e) => console.error('[sarvam] cancel old direct campaign', e));
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
    return id;
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
      try {
        await c.callTool('configure_deployment', { deployment_id: d.deployment_id, webhook_config: this.webhookConfig(baseUrl, { crm_kind: 'inbound' }) });
      } catch (e) {
        const { data: agent } = await admin
          .from('voice_agents')
          .select('name, provider_committed_version')
          .eq('provider', 'sarvam')
          .eq('provider_agent_id', d.app_id ?? '')
          .maybeSingle();
        const published = agent?.provider_committed_version ?? null;
        if (d.app_version && published !== null && d.app_version > published) {
          throw new AppError(
            `Sarvam would not update the inbound deployment "${d.name}". It answers calls with draft version ${d.app_version} of "${agent?.name ?? 'your agent'}", but the latest published version is ${published}. In Sarvam, publish the agent (so version ${d.app_version} is committed) or move the deployment to a published version, then click "Enable inbound call sync" again.`,
            'sarvam_deployment_draft',
          );
        }
        throw e;
      }
    }
    await admin.from('app_settings').update({ sarvam_inbound_webhook_at: new Date().toISOString() }).eq('id', true);
    return { deployments: targets.map((d) => d.name) };
  },
};
