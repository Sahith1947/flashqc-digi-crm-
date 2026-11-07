import 'server-only';
import type { Json, TablesUpdate } from '@/lib/supabase/database.types';
import type { DB } from '@/lib/supabase/types';
import type { CallStatus } from '@/lib/constants';
import type { NormalizedCallEvent } from '@/server/providers/types';

export type EventSource = 'simulator' | 'provider_webhook' | 'user' | 'system';

export const CallEventService = {
  async record(
    db: DB,
    callId: string,
    e: { type: string; status?: string | null; source: EventSource; payload?: Json; occurredAt?: Date | string },
  ) {
    const { error } = await db.from('call_events').insert({
      call_id: callId,
      event_type: e.type,
      status: e.status ?? null,
      source: e.source,
      payload: e.payload ?? {},
      occurred_at: e.occurredAt ? new Date(e.occurredAt).toISOString() : new Date().toISOString(),
    });
    if (error) throw error;
  },

  async recordMany(
    db: DB,
    callId: string,
    events: { type: string; status?: string | null; source: EventSource; payload?: Json; occurredAt: Date | string }[],
  ) {
    if (events.length === 0) return;
    const { error } = await db.from('call_events').insert(
      events.map((e) => ({
        call_id: callId,
        event_type: e.type,
        status: e.status ?? null,
        source: e.source,
        payload: e.payload ?? {},
        occurred_at: new Date(e.occurredAt).toISOString(),
      })),
    );
    if (error) throw error;
  },

  async list(db: DB, callId: string) {
    const { data, error } = await db
      .from('call_events')
      .select('id, event_type, status, source, payload, occurred_at')
      .eq('call_id', callId)
      .order('occurred_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Applies a VERIFIED provider event (called only after the adapter verified
   * the webhook signature). Must be given the backend (service role) client:
   * only the backend may write provider-confirmed call state.
   *
   * Idempotent per (provider, providerCallId, type, occurredAt).
   */
  async ingestProviderEvent(adminDb: DB, provider: string, evt: NormalizedCallEvent): Promise<{ callId: string }> {
    const found = await adminDb
      .from('calls')
      .select('id, status, started_at, answered_at, direction')
      .eq('provider', provider)
      .eq('provider_call_id', evt.providerCallId)
      .maybeSingle();
    if (found.error) throw found.error;
    let call = found.data;

    if (!call) {
      // First event for a call we did not originate → real inbound call.
      if (evt.direction !== 'inbound' || !evt.remoteNumber) {
        throw new Error(`Unknown provider call ${evt.providerCallId}`);
      }
      const [{ data: contact }, { data: line }] = await Promise.all([
        adminDb.from('contacts').select('id').eq('phone_e164', evt.remoteNumber).maybeSingle(),
        evt.businessNumber
          ? adminDb.from('phone_numbers').select('id, voice_agent_id').eq('phone_e164', evt.businessNumber).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const inserted = await adminDb
        .from('calls')
        .insert({
          direction: 'inbound',
          status: 'ringing',
          phone_e164: evt.remoteNumber,
          contact_id: contact?.id ?? null,
          phone_number_id: line?.id ?? null,
          voice_agent_id: line?.voice_agent_id ?? null,
          provider,
          provider_call_id: evt.providerCallId,
          started_at: evt.occurredAt,
          is_simulated: false,
        })
        .select('id, status, started_at, answered_at, direction')
        .single();
      if (inserted.error) throw inserted.error;
      call = inserted.data;
    }

    // Duplicate delivery guard.
    const dup = await adminDb
      .from('call_events')
      .select('id')
      .eq('call_id', call.id)
      .eq('event_type', evt.type)
      .eq('occurred_at', new Date(evt.occurredAt).toISOString())
      .eq('source', 'provider_webhook')
      .maybeSingle();
    if (dup.data) return { callId: call.id };

    const statusMap: Partial<Record<NormalizedCallEvent['type'], CallStatus>> = {
      initiated: 'queued',
      ringing: 'ringing',
      answered: 'in_progress',
      completed: 'completed',
      no_answer: 'no_answer',
      busy: 'busy',
      failed: 'failed',
      canceled: 'canceled',
      missed: 'missed',
    };
    const nextStatus = statusMap[evt.type];
    const update: TablesUpdate<'calls'> = {};
    if (nextStatus) update.status = nextStatus;
    if (evt.type === 'answered' && !call.answered_at) update.answered_at = evt.occurredAt;
    if (['completed', 'no_answer', 'busy', 'failed', 'canceled', 'missed'].includes(evt.type)) {
      update.ended_at = evt.occurredAt;
      if (typeof evt.durationSeconds === 'number') update.duration_seconds = Math.max(0, Math.round(evt.durationSeconds));
    }
    if (evt.failureReason) update.failure_reason = evt.failureReason.slice(0, 500);

    if (Object.keys(update).length) {
      const { error: upErr } = await adminDb.from('calls').update(update).eq('id', call.id);
      if (upErr) throw upErr;
    }

    if (evt.type === 'recording_ready' && evt.providerRecordingId) {
      const { error: recErr } = await adminDb.from('call_recordings').insert({
        call_id: call.id,
        source: 'provider',
        provider_recording_id: evt.providerRecordingId,
        duration_seconds: evt.durationSeconds ?? null,
      });
      if (recErr) throw recErr;
    }

    await this.record(adminDb, call.id, {
      type: evt.type,
      status: nextStatus ?? null,
      source: 'provider_webhook',
      payload: (evt.raw ?? {}) as Json,
      occurredAt: evt.occurredAt,
    });

    // Keep campaign contact state in sync with the verified result.
    if (nextStatus && ['completed', 'no_answer', 'busy', 'failed', 'canceled'].includes(nextStatus)) {
      await adminDb
        .from('campaign_contacts')
        .update({ status: nextStatus === 'completed' ? 'completed' : 'failed', outcome: nextStatus })
        .eq('last_call_id', call.id);
    }
    return { callId: call.id };
  },
};
