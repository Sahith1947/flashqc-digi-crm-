'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { CALL_OUTCOMES } from '@/lib/constants';
import { assertRole } from '@/server/auth';
import { formOptional, formString, runAction } from '@/server/action-utils';
import { AppError } from '@/server/providers/types';
import { CallEventService } from '@/server/services/call-event-service';
import { RecordingService } from '@/server/services/recording-service';
import { TranscriptService } from '@/server/services/transcript-service';

const uuid = z.string().uuid('Invalid id');

function refreshCall(callId: string) {
  revalidatePath(`/calls/${callId}`);
  revalidatePath('/calls');
  revalidatePath('/recordings');
}

export async function updateCallOutcome(callId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const id = uuid.parse(callId);
    const outcomeRaw = formString(fd, 'outcome');
    const outcome = outcomeRaw === '' ? null : z.enum(CALL_OUTCOMES).parse(outcomeRaw);
    const notes = formOptional(fd, 'notes');
    if (notes && notes.length > 5000) return { ok: false, error: 'Notes are too long (max 5000 characters).' };

    const { data: call, error } = await db.from('calls').update({ outcome, notes }).eq('id', id).select('id, phone_e164, contact_id').single();
    if (error) throw error;
    await CallEventService.record(db, id, { type: 'outcome_updated', source: 'user', payload: { outcome } });

    let extra = '';
    if (outcome === 'do_not_call') {
      const { error: supErr } = await db
        .from('suppression_list')
        .upsert({ phone_e164: call.phone_e164, source: 'opt_out', reason: 'Marked "Do not call" on a call' }, { onConflict: 'phone_e164', ignoreDuplicates: true });
      if (supErr) throw supErr;
      if (call.contact_id) await db.from('contacts').update({ consent_status: 'revoked' }).eq('id', call.contact_id);
      extra = ' Number added to the suppression list.';
      revalidatePath('/settings');
    }
    refreshCall(id);
    return { ok: true, message: `Call outcome saved.${extra}` };
  });
}

export async function saveTranscript(callId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const id = uuid.parse(callId);
    await TranscriptService.saveManualTranscript(db, id, { content: formString(fd, 'content'), language: formOptional(fd, 'language') });
    refreshCall(id);
    return { ok: true, message: 'Transcript saved.' };
  });
}

export async function saveSummary(callId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const id = uuid.parse(callId);
    const sentimentRaw = formString(fd, 'sentiment');
    const sentiment = sentimentRaw ? z.enum(['positive', 'neutral', 'negative']).parse(sentimentRaw) : null;
    await TranscriptService.saveManualSummary(db, id, { summary: formString(fd, 'summary'), sentiment });
    refreshCall(id);
    return { ok: true, message: 'Summary saved.' };
  });
}

export async function deleteTranscript(callId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const id = uuid.parse(callId);
    const { data, error } = await db.from('call_transcripts').delete().eq('call_id', id).select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'No transcript to delete.' };
    refreshCall(id);
    return { ok: true, message: 'Transcript deleted.' };
  });
}

export async function deleteSummary(callId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    const id = uuid.parse(callId);
    const { data, error } = await db.from('call_summaries').delete().eq('call_id', id).select('id');
    if (error) throw error;
    if (!data?.length) return { ok: false, error: 'No summary to delete.' };
    refreshCall(id);
    return { ok: true, message: 'Summary deleted.' };
  });
}

const recordingInput = z.object({
  callId: uuid,
  path: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  durationSeconds: z.number().nonnegative().max(86400).nullable(),
});

export async function registerRecording(input: z.input<typeof recordingInput>): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const data = recordingInput.parse(input);
    await RecordingService.registerUpload(db, data);
    await CallEventService.record(db, data.callId, { type: 'recording_uploaded', source: 'user', payload: { path: data.path } });
    refreshCall(data.callId);
    return { ok: true, message: 'Recording uploaded.' };
  });
}

export async function deleteRecording(recordingId: string, callId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('manager');
    await RecordingService.remove(db, uuid.parse(recordingId));
    refreshCall(uuid.parse(callId));
    return { ok: true, message: 'Recording deleted.' };
  });
}

export async function saveCallerAsContact(callId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('agent');
    const id = uuid.parse(callId);
    const name = formString(fd, 'full_name').slice(0, 200);
    const business = formOptional(fd, 'business_name');
    const { data: call, error } = await db.from('calls').select('phone_e164, contact_id, direction').eq('id', id).single();
    if (error) throw error;
    if (call.contact_id) return { ok: false, error: 'This call is already linked to a contact.' };
    let { data: contact } = await db.from('contacts').select('id').eq('phone_e164', call.phone_e164).maybeSingle();
    if (!contact) {
      const ins = await db
        .from('contacts')
        .insert({ phone_e164: call.phone_e164, full_name: name || null, business_name: business, source: call.direction === 'inbound' ? 'inbound_call' : 'manual' })
        .select('id')
        .single();
      if (ins.error) throw ins.error;
      contact = ins.data;
    }
    // Link every unlinked call from this number to the contact.
    const { error: linkErr } = await db.from('calls').update({ contact_id: contact.id }).eq('phone_e164', call.phone_e164).is('contact_id', null);
    if (linkErr) throw linkErr;
    refreshCall(id);
    revalidatePath('/contacts');
    return { ok: true, message: 'Contact saved and linked to calls from this number.' };
  });
}

export async function deleteCall(callId: string): Promise<ActionResult> {
  const res = await runAction<undefined>(async () => {
    const { db } = await assertRole('admin');
    const id = uuid.parse(callId);
    const { data: recs } = await db.from('call_recordings').select('id').eq('call_id', id);
    for (const r of recs ?? []) await RecordingService.remove(db, r.id);
    const { data, error } = await db.from('calls').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new AppError('Call not found or you lack permission.');
    revalidatePath('/', 'layout'); // dashboard, analytics, contacts, recordings… all recalculate
    return { ok: true, message: 'Call deleted. Call IDs were renumbered.' };
  });
  if (res.ok) redirect('/calls?deleted=1');
  return res;
}

/** Deletes several calls (Call Logs bulk action). Remaining Call IDs are renumbered by the database. */
export async function deleteCalls(callIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const { db } = await assertRole('admin');
    const ids = z.array(uuid).min(1, 'Select at least one call.').max(500, 'Delete at most 500 calls at a time.').parse(callIds);
    const { data: recs } = await db.from('call_recordings').select('id').in('call_id', ids);
    for (const r of recs ?? []) await RecordingService.remove(db, r.id);
    const { data, error } = await db.from('calls').delete().in('id', ids).select('id');
    if (error) throw error;
    if (!data?.length) throw new AppError('Those calls were not found or you lack permission.');
    revalidatePath('/', 'layout'); // dashboard, analytics, contacts, recordings… all recalculate
    const n = data.length;
    return { ok: true, message: `${n} call${n === 1 ? '' : 's'} deleted. Call IDs were renumbered so there are no gaps.` };
  });
}

export async function checkSarvamRecording(callId: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertRole('agent');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const { SarvamService } = await import('@/server/services/sarvam-service');
    const admin = createAdminClient();
    if (!admin) return { ok: false, error: 'SUPABASE_SECRET_KEY is not set on the server.' };
    const id = uuid.parse(callId);
    const res = await SarvamService.fetchRecording(admin, id);
    refreshCall(id);
    if (res === 'attached') return { ok: true, message: 'Recording found in Sarvam and attached.' };
    if (res === 'already') return { ok: true, message: 'This call already has a recording.' };
    if (res === 'not_applicable') return { ok: false, error: 'Only answered Sarvam calls have recordings.' };
    return {
      ok: false,
      error: 'Sarvam has no recording for this call. Call recording appears to be switched off for your Sarvam workspace or phone number — ask Sarvam support to enable it; new calls will then show recordings automatically.',
    };
  });
}

export async function getCallPlayback(callId: string): Promise<{ url: string | null; error: string | null }> {
  const { db } = await assertRole('viewer');
  const { data: rec } = await db
    .from('call_recordings')
    .select('storage_bucket, storage_path, provider_recording_id, provider_recording_url')
    .eq('call_id', uuid.parse(callId))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rec) return { url: null, error: 'No recording for this call.' };
  return RecordingService.getPlaybackUrl(db, rec);
}
