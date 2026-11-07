import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { isE164 } from '@/lib/phone';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTelephonyProvider } from '@/server/providers/registry';
import { AppError, ProviderNotConfiguredError } from '@/server/providers/types';
import { simulateCall } from '@/server/providers/simulator';
import { SarvamCalling } from '@/server/providers/sarvam/calling';
import { CallEventService } from './call-event-service';
import { checkCallable } from './compliance';

export type CallMode = 'simulated' | 'live';

export interface StartOutboundInput {
  phoneE164: string;
  contactId: string | null;
  phoneNumberId: string | null;
  voiceAgentId: string | null;
  campaignId?: string | null;
  mode: CallMode;
  /** skip compliance re-check when the caller (campaign batch) already did it */
  skipComplianceCheck?: boolean;
}

export interface StartCallResult {
  callId: string;
  simulated: boolean;
  status: string;
  outcome: string | null;
}

async function resolveContactId(db: DB, phoneE164: string, contactId: string | null) {
  if (contactId) return contactId;
  const { data } = await db.from('contacts').select('id').eq('phone_e164', phoneE164).maybeSingle();
  return data?.id ?? null;
}

export const TelephonyService = {
  /** Whether live calls can be placed right now, and why not. */
  async liveStatus(opts: { voiceAgentId?: string | null; phoneNumberId?: string | null } = {}): Promise<{ available: boolean; via: 'sarvam' | 'adapter' | null; reason: string | null }> {
    if (getTelephonyProvider().configured) return { available: true, via: 'adapter', reason: null };
    const admin = createAdminClient();
    if (!admin) return { available: false, via: null, reason: 'SUPABASE_SECRET_KEY is not set on the server.' };
    try {
      const r = await SarvamCalling.readiness(admin, opts);
      return r.ok ? { available: true, via: 'sarvam', reason: null } : { available: false, via: null, reason: r.reason };
    } catch (e) {
      return { available: false, via: null, reason: e instanceof Error ? e.message : 'Sarvam check failed.' };
    }
  },

  /** Live call through Sarvam: queue the CRM call, then hand it to the always-on direct campaign. */
  async startSarvamCall(db: DB, input: StartOutboundInput & { contactId: string | null }): Promise<StartCallResult> {
    const admin = createAdminClient();
    if (!admin) throw new AppError('SUPABASE_SECRET_KEY is required for live calling', 'backend_not_configured');
    const r = await SarvamCalling.readiness(admin, { voiceAgentId: input.voiceAgentId, phoneNumberId: input.phoneNumberId });
    if (!r.ok) throw new AppError(`Live calling is not ready: ${r.reason}`, 'live_not_ready');
    const { data: contact } = input.contactId
      ? await db.from('contacts').select('full_name, business_name, business_category, city').eq('id', input.contactId).maybeSingle()
      : { data: null };
    const { data: call, error } = await db
      .from('calls')
      .insert({
        direction: 'outbound',
        status: 'queued',
        phone_e164: input.phoneE164,
        contact_id: input.contactId,
        phone_number_id: r.line.id,
        voice_agent_id: r.agent.id,
        campaign_id: input.campaignId ?? null,
        is_simulated: false,
      })
      .select('id')
      .single();
    if (error) throw error;
    await CallEventService.record(db, call.id, { type: 'initiated', status: 'queued', source: 'user', payload: { via: 'sarvam' } });
    try {
      const campaignId = await SarvamCalling.directCampaign(admin, r);
      const vars: Record<string, string> = {};
      if (contact?.full_name) vars.user_name = contact.full_name;
      if (contact?.business_name) vars.business_name = contact.business_name;
      if (contact?.business_category) vars.business_category = contact.business_category;
      if (contact?.city) vars.location = contact.city;
      const cohorts = await SarvamCalling.streamUsers(admin, campaignId, `CRM call ${call.id.slice(0, 8)}`, [
        { user_phone_number: input.phoneE164, user_identifier: `call:${call.id}`, app_variables: vars },
      ]);
      await CallEventService.record(admin, call.id, {
        type: 'submitted_to_sarvam',
        status: 'queued',
        source: 'system',
        payload: { sarvam_campaign_id: campaignId, cohort_ids: cohorts, agent: r.agent.appId, agent_version: r.agent.version, from: r.line.phone },
      });
      return { callId: call.id, simulated: false, status: 'queued', outcome: null };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Sarvam error';
      await db.from('calls').update({ status: 'failed', failure_reason: reason.slice(0, 500) }).eq('id', call.id);
      await CallEventService.record(db, call.id, { type: 'failed', status: 'failed', source: 'system', payload: { reason } });
      throw err instanceof AppError ? err : new AppError(`Sarvam rejected the call: ${reason}`, 'provider_error');
    }
  },

  async startOutboundCall(db: DB, input: StartOutboundInput): Promise<StartCallResult> {
    if (!isE164(input.phoneE164)) throw new AppError('Invalid phone number', 'invalid_phone');
    const contactId = await resolveContactId(db, input.phoneE164, input.contactId);

    if (!input.skipComplianceCheck) {
      const check = await checkCallable(db, input.phoneE164, contactId);
      if (!check.allowed) throw new AppError(`Call blocked: ${check.reason}`, 'compliance_blocked');
    }

    if (input.mode === 'simulated') {
      return this.recordSimulatedCall(db, { ...input, contactId, direction: 'outbound' });
    }

    // ---- LIVE ----
    const provider = getTelephonyProvider();
    if (!provider.configured) {
      const live = await this.liveStatus({ voiceAgentId: input.voiceAgentId, phoneNumberId: input.phoneNumberId });
      if (live.via === 'sarvam') return this.startSarvamCall(db, { ...input, contactId });
      throw new ProviderNotConfiguredError('Live outbound calling');
    }
    const admin = createAdminClient();
    if (!admin) throw new AppError('SUPABASE_SECRET_KEY is required for live calling', 'backend_not_configured');

    let fromNumber: string | null = null;
    if (input.phoneNumberId) {
      const { data: line } = await db
        .from('phone_numbers')
        .select('phone_e164, can_outbound, enabled')
        .eq('id', input.phoneNumberId)
        .single();
      if (!line?.enabled || !line.can_outbound) throw new AppError('Selected business number cannot place outbound calls');
      fromNumber = line.phone_e164;
    }
    let providerAgentId: string | null = null;
    if (input.voiceAgentId) {
      const { data: agent } = await db.from('voice_agents').select('provider_agent_id').eq('id', input.voiceAgentId).single();
      providerAgentId = agent?.provider_agent_id ?? null;
    }

    // Queue the call first (a user may only create real calls as 'queued').
    const { data: call, error } = await db
      .from('calls')
      .insert({
        direction: 'outbound',
        status: 'queued',
        phone_e164: input.phoneE164,
        contact_id: contactId,
        phone_number_id: input.phoneNumberId,
        voice_agent_id: input.voiceAgentId,
        campaign_id: input.campaignId ?? null,
        is_simulated: false,
      })
      .select('id')
      .single();
    if (error) throw error;
    await CallEventService.record(db, call.id, { type: 'initiated', status: 'queued', source: 'user' });

    try {
      const res = await provider.placeOutboundCall({
        callId: call.id,
        to: input.phoneE164,
        from: fromNumber,
        providerAgentId,
      });
      // Provider accepted the request: record its id with the backend client.
      const { error: upErr } = await admin
        .from('calls')
        .update({ provider: provider.id, provider_call_id: res.providerCallId, status: res.initialStatus })
        .eq('id', call.id);
      if (upErr) throw upErr;
      await CallEventService.record(admin, call.id, {
        type: 'provider_accepted',
        status: res.initialStatus,
        source: 'system',
        payload: { provider: provider.id, provider_call_id: res.providerCallId },
      });
      return { callId: call.id, simulated: false, status: res.initialStatus, outcome: null };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Provider error';
      await db.from('calls').update({ status: 'failed', failure_reason: reason.slice(0, 500) }).eq('id', call.id);
      await CallEventService.record(db, call.id, { type: 'failed', status: 'failed', source: 'system', payload: { reason } });
      throw err instanceof AppError ? err : new AppError(`Provider rejected the call: ${reason}`, 'provider_error');
    }
  },

  /** Creates a clearly labelled SIMULATED call (inbound or outbound). */
  async recordSimulatedCall(
    db: DB,
    input: {
      direction: 'inbound' | 'outbound';
      phoneE164: string;
      contactId: string | null;
      phoneNumberId: string | null;
      voiceAgentId: string | null;
      campaignId?: string | null;
    },
  ): Promise<StartCallResult> {
    const { data: settings, error: settingsErr } = await db.from('app_settings').select('simulation_mode_enabled').maybeSingle();
    if (settingsErr) throw settingsErr;
    if (!settings?.simulation_mode_enabled) throw new AppError('Simulation mode is disabled in Settings.', 'simulation_disabled');
    const sim = simulateCall(input.direction);
    const { data: call, error } = await db
      .from('calls')
      .insert({
        direction: input.direction,
        status: sim.status,
        phone_e164: input.phoneE164,
        contact_id: input.contactId,
        phone_number_id: input.phoneNumberId,
        voice_agent_id: input.voiceAgentId,
        campaign_id: input.campaignId ?? null,
        started_at: sim.startedAt.toISOString(),
        answered_at: sim.answeredAt?.toISOString() ?? null,
        ended_at: sim.endedAt.toISOString(),
        duration_seconds: sim.durationSeconds,
        outcome: sim.outcome,
        failure_reason: sim.failureReason,
        is_simulated: true,
        provider: 'simulator',
      })
      .select('id')
      .single();
    if (error) throw error;
    await CallEventService.recordMany(
      db,
      call.id,
      sim.events.map((e) => ({ type: e.type, status: e.status, source: 'simulator' as const, occurredAt: e.at })),
    );
    return { callId: call.id, simulated: true, status: sim.status, outcome: sim.outcome };
  },

  async simulateInboundCall(db: DB, input: { phoneE164: string; phoneNumberId: string | null }): Promise<StartCallResult> {
    if (!isE164(input.phoneE164)) throw new AppError('Invalid phone number', 'invalid_phone');
    const contactId = await resolveContactId(db, input.phoneE164, null);
    let voiceAgentId: string | null = null;
    if (input.phoneNumberId) {
      const { data: line } = await db.from('phone_numbers').select('voice_agent_id, can_inbound').eq('id', input.phoneNumberId).single();
      if (line && !line.can_inbound) throw new AppError('Selected business number does not accept inbound calls');
      voiceAgentId = line?.voice_agent_id ?? null;
    }
    return this.recordSimulatedCall(db, {
      direction: 'inbound',
      phoneE164: input.phoneE164,
      contactId,
      phoneNumberId: input.phoneNumberId,
      voiceAgentId,
    });
  },
};
