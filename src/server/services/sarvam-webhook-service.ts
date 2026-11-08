import 'server-only';
import { SarvamRecordings } from '@/server/services/sarvam-recordings';
import { z } from 'zod';
import type { Json, TablesInsert, TablesUpdate } from '@/lib/supabase/database.types';
import type { DB } from '@/lib/supabase/types';
import type { CallOutcome, CallStatus } from '@/lib/constants';
import { normalizePhone } from '@/lib/phone';
import { detectEmotion, nextStage, stageFromCall, type LeadStage } from '@/lib/leads';

// Turns Sarvam call-end webhooks (sarvam://schemas/webhook-payload) into CRM records.
// Called only after the shared secret was verified; always with the backend client,
// because these are provider-confirmed facts the database refuses from users.
// Idempotent: a redelivered attempt updates the same call instead of duplicating it.

const turn = z.object({ role: z.string(), en_text: z.string().nullish(), indic_text: z.string().nullish() });
const common = {
  app_id: z.string(),
  app_version: z.number().nullish(),
  interaction_id: z.string().nullish(),
  user_phone_number: z.string(),
  agent_phone_number: z.string().nullish(),
  duration: z.number().nullish(),
  recording_url: z.string().nullish(),
  start_datetime: z.string().nullish(),
  end_datetime: z.string().nullish(),
  final_agent_variables: z.record(z.string(), z.unknown()).nullish(),
  output_agent_variables: z.record(z.string(), z.unknown()).nullish(),
  interaction_transcript: z.array(turn).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
};
export const outboundSchema = z.object({
  ...common,
  attempt_id: z.string(),
  campaign_id: z.string(),
  cohort_id: z.string().nullish(),
  completion_status: z.string(),
  connectivity_status: z.string().nullish(),
  next_action_status: z.string().nullish(),
  failure_reason: z.string().nullish(),
  user_identifier: z.string().nullish(),
  retry_attempt: z.number().nullish(),
  executed_at: z.string().nullish(),
});
export const inboundSchema = z.object({ ...common, deployment_id: z.string() });
// Instant outbound call result (sarvam docs: instant-outbound/webhook-payload).
export const instantSchema = z.object({
  attempt_id: z.string(),
  status: z.string(),
  channel_info: z.object({ agent_phone_number: z.string().nullish() }).passthrough().nullish(),
  duration: z.number().nullish(),
  interaction_id: z.string().nullish(),
  failure_reason: z.string().nullish(),
  final_agent_variables: z.record(z.string(), z.unknown()).nullish(),
  interaction_transcript: z.array(turn).nullish(),
  recording_url: z.string().nullish(),
  webhook_config: z.object({ url: z.string().nullish(), metadata: z.record(z.string(), z.unknown()).nullish() }).nullish(),
});
type Outbound = z.infer<typeof outboundSchema>;
type Inbound = z.infer<typeof inboundSchema>;

const OUTCOME_MAP: Record<string, CallOutcome> = {
  meeting_booked: 'converted',
  callback_requested: 'callback_requested',
  whatsapp_details_requested: 'interested',
  not_interested: 'not_interested',
  no_booking: 'other',
};
const LEAD_LABELS: Record<string, string> = {
  lead_temperature: 'Lead temperature',
  consultation_outcome: 'Outcome',
  monthly_budget: 'Monthly budget',
  required_services: 'Required services',
  follow_up_preference: 'Follow-up preference',
  expected_start_date: 'Expected start',
  current_marketing_situation: 'Current marketing',
};

const iso = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function variables(p: Outbound | Inbound): Record<string, unknown> {
  return { ...(p.final_agent_variables ?? {}), ...(p.output_agent_variables ?? {}) };
}

function outboundStatus(p: Outbound): CallStatus {
  switch (p.connectivity_status) {
    case 'connected':
      return 'completed';
    case 'no_answer':
      return 'no_answer';
    case 'busy':
      return 'busy';
    case 'failed':
      return 'failed';
    default:
      return p.completion_status === 'completed' || p.completion_status === 'partial' ? 'completed' : 'failed';
  }
}

async function lookups(admin: DB, userPhone: string, agentPhone: string | null | undefined, appId: string) {
  const user = normalizePhone(userPhone);
  const agent = agentPhone ? normalizePhone(agentPhone) : null;
  const [contact, line, voiceAgent] = await Promise.all([
    user.ok ? admin.from('contacts').select('id').eq('phone_e164', user.e164).maybeSingle() : Promise.resolve({ data: null }),
    agent?.ok ? admin.from('phone_numbers').select('id').eq('phone_e164', agent.e164).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('voice_agents').select('id').eq('provider', 'sarvam').eq('provider_agent_id', appId).maybeSingle(),
  ]);
  return {
    phone: user.ok ? user.e164 : null,
    contactId: contact.data?.id ?? null,
    phoneNumberId: line.data?.id ?? null,
    voiceAgentId: voiceAgent.data?.id ?? null,
  };
}

/** Transcript, AI summary, recording and outcome for a call that has a conversation. */
async function attachConversation(admin: DB, callId: string, p: Outbound | Inbound, connected: boolean) {
  const vars = variables(p);
  const turns = (p.interaction_transcript ?? []).filter((t) => (t.indic_text || t.en_text || '').trim());
  if (connected && turns.length) {
    const content = turns
      .map((t) => `${t.role === 'agent' ? 'Agent' : 'Customer'}: ${(t.indic_text || t.en_text || '').trim()}${t.indic_text && t.en_text && t.indic_text !== t.en_text ? `\n   (${t.en_text.trim()})` : ''}`)
      .join('\n')
      .slice(0, 200000);
    const { error } = await admin
      .from('call_transcripts')
      .upsert({ call_id: callId, content, segments: turns as unknown as Json, source: 'provider', provider: 'sarvam' }, { onConflict: 'call_id' });
    if (error) throw error;
  }
  const emotion = detectEmotion({
    connected,
    temperature: str(vars.lead_temperature),
    outcome: str(vars.consultation_outcome),
    customerText: turns.filter((t) => t.role !== 'agent').map((t) => t.en_text || t.indic_text || '').join(' \n '),
  });
  const summary = str(vars.call_summary);
  if (connected && summary) {
    const keyPoints = Object.entries(LEAD_LABELS)
      .map(([k, label]) => (str(vars[k]) ? `${label}: ${str(vars[k]).replace(/_/g, ' ')}` : null))
      .filter(Boolean);
    const temp = str(vars.lead_temperature).toUpperCase();
    const { error } = await admin.from('call_summaries').upsert(
      {
        call_id: callId,
        summary: summary.slice(0, 20000),
        key_points: keyPoints as unknown as Json,
        sentiment: emotion?.sentiment ?? (temp === 'HOT' ? 'positive' : temp === 'COLD' ? 'negative' : temp === 'WARM' ? 'neutral' : null),
        emotion: emotion?.label ?? null,
        suggested_outcome: str(vars.consultation_outcome) || null,
        source: 'ai',
        model: `sarvam:${p.app_id}${p.app_version ? `@v${p.app_version}` : ''}`,
      },
      { onConflict: 'call_id' },
    );
    if (error) throw error;
  }
  if (p.recording_url && /^https:\/\//.test(p.recording_url)) {
    const url = p.recording_url.slice(0, 4000);
    const { data: have } = await admin.from('call_recordings').select('id').eq('call_id', callId).eq('provider_recording_url', url).maybeSingle();
    if (!have) {
      const { error } = await admin.from('call_recordings').insert({
        call_id: callId,
        source: 'provider',
        provider_recording_url: url,
        provider_recording_id: p.interaction_id?.slice(0, 200) ?? null,
        duration_seconds: p.duration ? Math.round(p.duration) : null,
      });
      // A concurrent redelivery may have inserted it first; the unique index keeps one copy.
      if (error && error.code !== '23505') throw error;
    }
  }
  const outcome = OUTCOME_MAP[str(vars.consultation_outcome)];
  if (connected && outcome) {
    // Only fill the outcome if a person has not set one already.
    await admin.from('calls').update({ outcome }).eq('id', callId).is('outcome', null);
  }
  return { outcome: outcome ?? null, emotion };
}

/**
 * Creates the lead for a new caller (connected calls only) or updates the existing contact:
 * stage (forward-only), temperature, emotion, AI lead details, and blank profile fields from
 * what the agent captured. Returns the contact id.
 */
async function upsertLead(
  admin: DB,
  callId: string,
  phone: string,
  contactId: string | null,
  p: Outbound | Inbound,
  connected: boolean,
  emotion: ReturnType<typeof detectEmotion>,
  source: string,
): Promise<string | null> {
  const vars = variables(p);
  const v = (k: string) => {
    const x = str(vars[k]);
    return x && !/^(not_shared|none|unknown|n\/a)$/i.test(x) ? x : null;
  };
  let id = contactId;
  if (!id) {
    if (!connected) return null;
    const { data, error } = await admin
      .from('contacts')
      .insert({
        phone_e164: phone,
        full_name: v('user_name')?.slice(0, 200) ?? null,
        business_name: v('business_name')?.slice(0, 200) ?? null,
        business_category: v('business_category')?.slice(0, 120) ?? null,
        city: v('location')?.slice(0, 120) ?? null,
        source,
      })
      .select('id')
      .single();
    if (error && error.code !== '23505') throw error;
    id = data?.id ?? (await admin.from('contacts').select('id').eq('phone_e164', phone).maybeSingle()).data?.id ?? null;
    if (!id) return null;
    await admin.from('calls').update({ contact_id: id }).eq('id', callId).is('contact_id', null);
  }
  const { data: c } = await admin
    .from('contacts')
    .select('full_name, business_name, business_category, city, lead_stage, lead_details')
    .eq('id', id)
    .maybeSingle();
  if (!c) return id;
  const temp = (v('lead_temperature') ?? '').toLowerCase();
  const suggested = stageFromCall({ connected, outcome: v('consultation_outcome'), temperature: temp });
  const stage = nextStage((c.lead_stage as LeadStage) ?? 'new', suggested);
  const details: Record<string, string> = { ...((c.lead_details as Record<string, string> | null) ?? {}) };
  for (const [k, label] of Object.entries(LEAD_LABELS)) {
    const val = v(k);
    if (val) details[label] = val.replace(/_/g, ' ');
  }
  const patch: TablesUpdate<'contacts'> = { lead_stage: stage };
  if (connected) {
    patch.lead_updated_at = new Date().toISOString();
    patch.lead_details = details as Json;
    if (temp === 'hot' || temp === 'warm' || temp === 'cold') patch.lead_temperature = temp;
    if (emotion) patch.last_emotion = emotion.label;
    if (!c.full_name && v('user_name')) patch.full_name = v('user_name')!.slice(0, 200);
    if (!c.business_name && v('business_name')) patch.business_name = v('business_name')!.slice(0, 200);
    if (!c.business_category && v('business_category')) patch.business_category = v('business_category')!.slice(0, 120);
    if (!c.city && v('location')) patch.city = v('location')!.slice(0, 120);
  }
  const { error } = await admin.from('contacts').update(patch).eq('id', id);
  if (error) throw error;
  return id;
}

async function recordEvent(admin: DB, callId: string, type: string, status: string | null, at: string | null, payload: Record<string, unknown>) {
  const { interaction_transcript: _t, metadata, ...rest } = payload;
  void _t;
  // Keep the echoed metadata for traceability, but never the shared secret.
  if (metadata && typeof metadata === 'object') {
    const { crm_secret: _s, ...safeMeta } = metadata as Record<string, unknown>;
    void _s;
    (rest as Record<string, unknown>).metadata = safeMeta;
  }
  await admin.from('call_events').insert({
    call_id: callId,
    event_type: type,
    status,
    source: 'provider_webhook',
    payload: rest as { [key: string]: Json },
    occurred_at: at ?? new Date().toISOString(),
  });
}

async function completeCampaignIfDone(admin: DB, campaignId: string) {
  const { count } = await admin
    .from('campaign_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'in_progress']);
  if (!count) {
    await admin.from('campaigns').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', campaignId).eq('status', 'running');
  }
}

export const SarvamWebhookService = {
  async handleOutbound(admin: DB, p: Outbound) {
    const status = outboundStatus(p);
    const connected = status === 'completed';
    const startedAt = iso(p.start_datetime) ?? iso(p.executed_at) ?? new Date().toISOString();
    const endedAt = iso(p.end_datetime) ?? iso(p.executed_at) ?? startedAt;
    const duration = connected ? Math.max(0, Math.round(p.duration ?? 0)) : 0;
    const telephony = {
      status,
      provider: 'sarvam',
      provider_call_id: p.attempt_id,
      started_at: startedAt,
      answered_at: connected ? startedAt : null,
      ended_at: endedAt < startedAt ? startedAt : endedAt,
      duration_seconds: duration,
      failure_reason: p.failure_reason?.slice(0, 500) ?? null,
    };
    const ident = p.user_identifier ?? '';
    const ref = /^(call|cc):([0-9a-f-]{36})$/.exec(ident);
    const look = await lookups(admin, p.user_phone_number, p.agent_phone_number, p.app_id);
    if (!look.phone) throw new Error(`Invalid phone in webhook: ${p.user_phone_number}`);

    // Redelivery of an attempt we already stored → update in place.
    const { data: existing } = await admin.from('calls').select('id').eq('provider', 'sarvam').eq('provider_call_id', p.attempt_id).maybeSingle();
    let callId = existing?.id ?? null;
    let campaignId: string | null = null;
    let campaignContactId: string | null = null;

    if (ref?.[1] === 'call' && !callId) {
      // A one-off "Live call" placed from the CRM: the queued call row is waiting for this result.
      const { data: queued } = await admin.from('calls').select('id, provider_call_id').eq('id', ref[2]).maybeSingle();
      if (queued) {
        // The call may have been moved to a newer Sarvam campaign (e.g. after a calling-hours change).
        // An attempt from the replaced campaign (typically "Campaign Cancelled") must not decide the result.
        const { data: sub } = await admin
          .from('call_events')
          .select('payload')
          .eq('call_id', queued.id)
          .in('event_type', ['submitted_to_sarvam', 'resubmitted_to_sarvam'])
          .order('occurred_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const current = (sub?.payload as { sarvam_campaign_id?: string } | null)?.sarvam_campaign_id;
        if (current && current !== p.campaign_id) {
          await recordEvent(admin, queued.id, 'superseded_attempt', null, iso(p.executed_at) ?? endedAt, p as unknown as Record<string, unknown>);
          return { callId: queued.id, status: 'superseded' as const };
        }
        if (!queued.provider_call_id) callId = queued.id;
      }
    }
    if (ref?.[1] === 'cc') {
      const { data: cc } = await admin.from('campaign_contacts').select('id, campaign_id, contact_id').eq('id', ref[2]).maybeSingle();
      if (cc) {
        campaignId = cc.campaign_id;
        campaignContactId = cc.id;
        look.contactId = cc.contact_id;
      }
    }
    if (!campaignId) {
      const { data: cp } = await admin.from('campaigns').select('id').eq('provider', 'sarvam').eq('provider_campaign_id', p.campaign_id).maybeSingle();
      campaignId = cp?.id ?? null;
    }

    if (callId) {
      const { error } = await admin.from('calls').update(telephony).eq('id', callId);
      if (error) throw error;
    } else {
      const row: TablesInsert<'calls'> = {
        ...telephony,
        direction: 'outbound',
        phone_e164: look.phone,
        contact_id: look.contactId,
        phone_number_id: look.phoneNumberId,
        voice_agent_id: look.voiceAgentId,
        campaign_id: campaignId,
        is_simulated: false,
      };
      const { data, error } = await admin.from('calls').insert(row).select('id').single();
      if (error) throw error;
      callId = data.id;
    }

    await recordEvent(admin, callId, connected ? 'completed' : status, status, endedAt, p as unknown as Record<string, unknown>);
    const { outcome, emotion } = await attachConversation(admin, callId, p, connected);
    if (connected) await SarvamRecordings.mark(admin, callId).catch((e) => console.error('[sarvam] mark recording', e));
    await upsertLead(admin, callId, look.phone, look.contactId, p, connected, emotion, 'live_call');

    if (campaignContactId) {
      const terminal = !p.next_action_status;
      await admin
        .from('campaign_contacts')
        .update({
          attempts: (p.retry_attempt ?? 0) + 1,
          last_call_id: callId,
          last_attempt_at: startedAt,
          status: terminal ? (connected ? 'completed' : 'failed') : 'in_progress',
          outcome: outcome ?? (connected ? 'completed' : status),
          skip_reason: terminal && !connected ? (p.failure_reason?.slice(0, 300) ?? null) : null,
        })
        .eq('id', campaignContactId);
      if (terminal && campaignId) await completeCampaignIfDone(admin, campaignId);
    }
    return { callId, status };
  },

  async handleInbound(admin: DB, p: Inbound) {
    const look = await lookups(admin, p.user_phone_number, p.agent_phone_number, p.app_id);
    if (!look.phone) throw new Error(`Invalid phone in webhook: ${p.user_phone_number}`);
    const providerCallId = p.interaction_id ?? `${p.deployment_id}:${p.start_datetime ?? Date.now()}`;
    const startedAt = iso(p.start_datetime) ?? new Date().toISOString();
    const endedAt = iso(p.end_datetime) ?? startedAt;
    const row = {
      direction: 'inbound' as const,
      status: 'completed' as const,
      phone_e164: look.phone,
      contact_id: look.contactId,
      phone_number_id: look.phoneNumberId,
      voice_agent_id: look.voiceAgentId,
      provider: 'sarvam',
      provider_call_id: providerCallId,
      started_at: startedAt,
      answered_at: startedAt,
      ended_at: endedAt < startedAt ? startedAt : endedAt,
      duration_seconds: Math.max(0, Math.round(p.duration ?? 0)),
      is_simulated: false,
    };
    const { data: existing } = await admin.from('calls').select('id').eq('provider', 'sarvam').eq('provider_call_id', providerCallId).maybeSingle();
    let callId = existing?.id;
    if (callId) {
      const { error } = await admin.from('calls').update(row).eq('id', callId);
      if (error) throw error;
    } else {
      const { data, error } = await admin.from('calls').insert(row).select('id').single();
      if (error) throw error;
      callId = data.id;
    }
    await recordEvent(admin, callId, 'completed', 'completed', endedAt, p as unknown as Record<string, unknown>);
    const { emotion } = await attachConversation(admin, callId, p, true);
    await SarvamRecordings.mark(admin, callId).catch((e) => console.error('[sarvam] mark recording', e));
    await upsertLead(admin, callId, look.phone, look.contactId, p, true, emotion, 'inbound_call');
    return { callId, status: 'completed' as const };
  },

  /** Rebuilds leads and emotion from past Sarvam calls (their stored webhook payloads), oldest first. */
  async backfillLeads(admin: DB): Promise<{ calls: number; created: number }> {
    const { count: before } = await admin.from('contacts').select('id', { count: 'exact', head: true });
    const { data: calls } = await admin
      .from('calls')
      .select('id, phone_e164, contact_id, answered_at, direction')
      .eq('provider', 'sarvam')
      .eq('is_simulated', false)
      .neq('status', 'queued')
      .order('started_at', { ascending: true })
      .limit(2000);
    let processed = 0;
    for (const call of calls ?? []) {
      const { data: ev } = await admin
        .from('call_events')
        .select('payload')
        .eq('call_id', call.id)
        .eq('source', 'provider_webhook')
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!ev?.payload) continue;
      const p = ev.payload as unknown as Outbound & Inbound;
      const connected = Boolean(call.answered_at);
      const { data: tr } = await admin.from('call_transcripts').select('segments').eq('call_id', call.id).maybeSingle();
      const turns = (Array.isArray(tr?.segments) ? tr!.segments : []) as { role: string; en_text?: string; indic_text?: string }[];
      const vars = variables(p);
      const emotion = detectEmotion({
        connected,
        temperature: str(vars.lead_temperature),
        outcome: str(vars.consultation_outcome),
        customerText: turns.filter((t) => t.role !== 'agent').map((t) => t.en_text || t.indic_text || '').join(' \n '),
      });
      if (emotion) await admin.from('call_summaries').update({ emotion: emotion.label, sentiment: emotion.sentiment }).eq('call_id', call.id);
      await upsertLead(admin, call.id, call.phone_e164, call.contact_id, p, connected, emotion, call.direction === 'inbound' ? 'inbound_call' : 'live_call');
      processed++;
    }
    const { count: after } = await admin.from('contacts').select('id', { count: 'exact', head: true });
    return { calls: processed, created: Math.max(0, (after ?? 0) - (before ?? 0)) };
  },

  /** Instant call result: reuse the outbound pipeline with the CRM call it belongs to. */
  async handleInstant(admin: DB, p: z.infer<typeof instantSchema>) {
    const meta = (p.webhook_config?.metadata ?? {}) as Record<string, unknown>;
    const metaCallId = typeof meta.call_id === 'string' && /^[0-9a-f-]{36}$/.test(meta.call_id) ? meta.call_id : null;
    const { data: byAttempt } = await admin.from('calls').select('id, phone_e164').eq('provider', 'sarvam').eq('provider_call_id', p.attempt_id).maybeSingle();
    const { data: byMeta } = byAttempt || !metaCallId ? { data: null } : await admin.from('calls').select('id, phone_e164').eq('id', metaCallId).maybeSingle();
    const call = byAttempt ?? byMeta;
    if (!call) throw new Error(`Instant call result for unknown attempt ${p.attempt_id}`);
    const end = new Date();
    const start = new Date(end.getTime() - Math.round((p.duration ?? 0) * 1000));
    return this.handleOutbound(admin, {
      attempt_id: p.attempt_id,
      campaign_id: 'instant',
      completion_status: p.status === 'connected' ? 'completed' : 'failed',
      connectivity_status: p.status,
      failure_reason: p.failure_reason ?? null,
      // Campaign kickoff calls carry their campaign contact, so the campaign row is updated too.
      user_identifier: typeof meta.cc_id === 'string' && /^[0-9a-f-]{36}$/.test(meta.cc_id) ? `cc:${meta.cc_id}` : `call:${call.id}`,
      user_phone_number: call.phone_e164,
      agent_phone_number: p.channel_info?.agent_phone_number ?? null,
      app_id: typeof meta.app_id === 'string' ? meta.app_id : '',
      interaction_id: p.interaction_id ?? null,
      duration: p.duration ?? null,
      recording_url: p.recording_url ?? null,
      start_datetime: start.toISOString(),
      end_datetime: end.toISOString(),
      final_agent_variables: p.final_agent_variables ?? null,
      interaction_transcript: p.interaction_transcript ?? null,
      metadata: meta, // recordEvent drops crm_secret before storing
    });
  },

  async handle(admin: DB, body: unknown) {
    const obj = (body ?? {}) as Record<string, unknown>;
    if (typeof obj.attempt_id === 'string' && typeof obj.status === 'string' && obj.campaign_id === undefined && obj.deployment_id === undefined)
      return this.handleInstant(admin, instantSchema.parse(body));
    if (typeof obj.campaign_id === 'string') return this.handleOutbound(admin, outboundSchema.parse(body));
    if (typeof obj.deployment_id === 'string') return this.handleInbound(admin, inboundSchema.parse(body));
    throw new Error('Unrecognised Sarvam webhook payload');
  },
};
