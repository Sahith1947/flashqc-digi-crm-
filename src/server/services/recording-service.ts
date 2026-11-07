import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { getRecordingSourceProvider } from '@/server/providers/registry';
import { AppError } from '@/server/providers/types';

export const RECORDINGS_BUCKET = 'call-recordings';
export const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
export const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
];

/** Storage path convention: calls/<callId>/<uuid>.<ext> */
export function isValidRecordingPath(callId: string, path: string): boolean {
  return new RegExp(`^calls/${callId}/[0-9a-f-]{36}\\.(mp3|wav|ogg|webm|m4a|mp4|aac)$`).test(path);
}

export type PlaybackResult = { url: string; error: null } | { url: null; error: string };

export const RecordingService = {
  /** Registers a file the user already uploaded to private storage. Verifies the object exists. */
  async registerUpload(
    db: DB,
    input: { callId: string; path: string; mimeType: string; sizeBytes: number; durationSeconds: number | null },
  ) {
    if (!isValidRecordingPath(input.callId, input.path)) throw new AppError('Invalid recording path');
    if (!ALLOWED_AUDIO_TYPES.includes(input.mimeType)) throw new AppError('Unsupported audio format');
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_RECORDING_BYTES) throw new AppError('Recording must be under 100 MB');

    const folder = input.path.slice(0, input.path.lastIndexOf('/'));
    const name = input.path.slice(input.path.lastIndexOf('/') + 1);
    const { data: listed, error: listErr } = await db.storage.from(RECORDINGS_BUCKET).list(folder, { search: name });
    if (listErr) throw listErr;
    if (!listed?.some((o) => o.name === name)) throw new AppError('Uploaded file was not found in storage');

    const { data, error } = await db
      .from('call_recordings')
      .insert({
        call_id: input.callId,
        source: 'upload',
        storage_bucket: RECORDINGS_BUCKET,
        storage_path: input.path,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        duration_seconds: input.durationSeconds !== null ? Math.round(input.durationSeconds) : null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data;
  },

  /** Short-lived signed URL for private storage, or a provider-resolved URL. Never invents URLs. */
  async getPlaybackUrl(
    db: DB,
    rec: { storage_bucket: string | null; storage_path: string | null; provider_recording_id: string | null; provider_recording_url?: string | null },
  ): Promise<PlaybackResult> {
    if (rec.storage_bucket && rec.storage_path) {
      const { data, error } = await db.storage.from(rec.storage_bucket).createSignedUrl(rec.storage_path, 60 * 60);
      if (error || !data) return { url: null, error: 'Recording file could not be loaded from storage' };
      return { url: data.signedUrl, error: null };
    }
    if (rec.provider_recording_url && /^https:\/\//.test(rec.provider_recording_url)) {
      // Recording link delivered by Sarvam in the verified call webhook.
      return { url: rec.provider_recording_url, error: null };
    }
    if (rec.provider_recording_id) {
      const provider = getRecordingSourceProvider();
      if (!provider.configured) return { url: null, error: 'Provider recording playback is not connected yet (Phase 2)' };
      try {
        return { url: await provider.getPlaybackUrl(rec.provider_recording_id), error: null };
      } catch (e) {
        return { url: null, error: e instanceof Error ? e.message : 'Provider error' };
      }
    }
    return { url: null, error: 'No playable source' };
  },

  async remove(db: DB, recordingId: string) {
    const { data: rec, error } = await db
      .from('call_recordings')
      .select('id, storage_bucket, storage_path')
      .eq('id', recordingId)
      .maybeSingle();
    if (error) throw error;
    if (!rec) throw new AppError('Recording not found', 'not_found');
    const { data: deleted, error: delErr } = await db.from('call_recordings').delete().eq('id', recordingId).select('id');
    if (delErr) throw delErr;
    if (!deleted?.length) throw new AppError('You do not have permission to delete recordings', 'forbidden');
    if (rec.storage_bucket && rec.storage_path) {
      await db.storage.from(rec.storage_bucket).remove([rec.storage_path]);
    }
  },
};
