import 'server-only';
import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/supabase/types';
import { decryptSecret, encryptSecret, encryptionAvailable } from '@/server/crypto';
import { AppError } from '@/server/providers/types';
import { SarvamAuth } from '@/server/providers/sarvam/auth';
import { RECORDINGS_BUCKET } from '@/server/services/recording-service';
import { stereoToMono, wavDurationSeconds } from '@/lib/wav';

// Sarvam keeps every call's audio, served by the Analytics API:
//   GET https://apps.sarvam.ai/api/analytics/v1/{org}/{workspace}/{app}/recordings/{interaction_id}  (audio/wav, X-API-Key)
// The CRM records a reference per answered call ("sarvam:<app>|<interaction>"). On first playback it downloads the
// WAV once, mixes it to mono (half the size) and keeps it in the private recordings bucket; later plays are instant.

const KEY = 'sarvam_api_key';
const AAD = 'integration:sarvam_api_key';
const BASE = () => (process.env.SARVAM_ANALYTICS_URL || 'https://apps.sarvam.ai/api/analytics/v1').replace(/\/$/, '');

interface Stored {
  apiKey: string;
  orgId: string;
  workspaceId: string;
}

async function read(admin: DB): Promise<{ s: Stored; meta: Record<string, unknown> } | null> {
  const { data } = await admin.from('integration_credentials').select('ciphertext, metadata').eq('key', KEY).maybeSingle();
  if (!data) return null;
  try {
    return { s: JSON.parse(decryptSecret(data.ciphertext, AAD)) as Stored, meta: (data.metadata ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

const enc = (s: string) => encodeURIComponent(s);
const url = (s: Stored, appId: string, path: string) => `${BASE()}/${enc(s.orgId)}/${enc(s.workspaceId)}/${enc(appId)}${path}`;

/** The Sarvam agent and interaction a call belongs to (from its verified webhook). */
async function callRef(admin: DB, callId: string): Promise<{ appId: string; interactionId: string } | null> {
  const { data: call } = await admin
    .from('calls')
    .select('provider, provider_call_id, direction, answered_at, is_simulated, voice_agents(provider_agent_id)')
    .eq('id', callId)
    .maybeSingle();
  if (!call || call.is_simulated || call.provider !== 'sarvam' || !call.answered_at) return null;
  const { data: ev } = await admin
    .from('call_events')
    .select('payload')
    .eq('call_id', callId)
    .eq('source', 'provider_webhook')
    .neq('event_type', 'superseded_attempt')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const p = (ev?.payload ?? {}) as { interaction_id?: string; app_id?: string };
  const interactionId = p.interaction_id ?? (call.direction === 'inbound' ? call.provider_call_id : null);
  const appId = p.app_id ?? (call.voice_agents as { provider_agent_id: string | null } | null)?.provider_agent_id ?? null;
  if (!interactionId || !interactionId.includes('/') || !appId) return null;
  return { appId, interactionId };
}

export const SarvamRecordings = {
  async status(admin: DB) {
    const cur = await read(admin);
    const { count } = await admin.from('call_recordings').select('id', { count: 'exact', head: true }).like('provider_recording_id', 'sarvam:%');
    return {
      configured: Boolean(cur),
      keyHint: cur ? `${cur.s.apiKey.slice(0, 11)}••••${cur.s.apiKey.slice(-4)}` : null,
      savedAt: (cur?.meta.saved_at as string) ?? null,
      recordings: count ?? 0,
    };
  },

  /** Verifies the key with Sarvam, stores it encrypted, then marks every answered Sarvam call as recorded. */
  async saveKey(admin: DB, apiKey: string): Promise<number> {
    if (!encryptionAvailable()) throw new AppError('The server cannot encrypt secrets (missing server key).');
    const key = apiKey.trim();
    if (!/^[A-Za-z0-9_\-.]{16,200}$/.test(key)) throw new AppError('That does not look like a Sarvam API key (it starts with "sk_").');
    const ws = await SarvamAuth.workspace(admin);
    if (!ws) throw new AppError('Connect Sarvam on this page first, so the CRM knows your Sarvam workspace.');
    const { data: agent } = await admin.from('voice_agents').select('provider_agent_id').eq('provider', 'sarvam').not('provider_agent_id', 'is', null).limit(1).maybeSingle();
    if (!agent?.provider_agent_id) throw new AppError('Sync your Sarvam voice agents first.');
    const s: Stored = { apiKey: key, ...ws };
    const end = new Date();
    const start = new Date(end.getTime() - 86400_000);
    let res: Response;
    try {
      res = await fetch(`${url(s, agent.provider_agent_id, '/interactions')}?start_datetime=${enc(start.toISOString())}&end_datetime=${enc(end.toISOString())}&limit=1`, {
        headers: { 'X-API-Key': key },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new AppError('Could not reach Sarvam. Please try again in a minute.');
    }
    if (res.status === 401 || res.status === 403) throw new AppError('Sarvam rejected this API key. Copy it again from the Sarvam dashboard (API keys).');
    if (!res.ok) throw new AppError(`Sarvam returned an error (HTTP ${res.status}). Please try again.`);
    const { error } = await admin
      .from('integration_credentials')
      .upsert({ key: KEY, ciphertext: encryptSecret(JSON.stringify(s), AAD), metadata: { saved_at: new Date().toISOString() } }, { onConflict: 'key' });
    if (error) throw error;
    return this.backfill(admin, 3650);
  },

  async removeKey(admin: DB) {
    await admin.from('integration_credentials').delete().eq('key', KEY);
  },

  /** Records that an answered Sarvam call has a recording (no download yet). */
  async mark(admin: DB, callId: string): Promise<boolean> {
    if (!(await read(admin))) return false;
    const ref = await callRef(admin, callId);
    if (!ref) return false;
    const { count } = await admin.from('call_recordings').select('id', { count: 'exact', head: true }).eq('call_id', callId);
    if (count) return false;
    // Sarvam already said it has no recording for this call: don't ask again.
    const { count: none } = await admin.from('call_events').select('id', { count: 'exact', head: true }).eq('call_id', callId).eq('event_type', 'recording_unavailable');
    if (none) return false;
    const { error } = await admin.from('call_recordings').insert({
      call_id: callId,
      source: 'provider',
      provider_recording_id: `sarvam:${ref.appId}|${ref.interactionId}`.slice(0, 200),
    });
    if (error && error.code !== '23505') throw error;
    return !error;
  },

  /** Marks answered Sarvam calls from the last `days` days that have no recording yet. */
  async backfill(admin: DB, days = 7, limit = 500): Promise<number> {
    if (!(await read(admin))) return 0;
    const { data } = await admin
      .from('call_log_view')
      .select('id')
      .eq('provider', 'sarvam')
      .eq('is_simulated', false)
      .eq('has_recording', false)
      .not('answered_at', 'is', null)
      .gte('started_at', new Date(Date.now() - days * 86400_000).toISOString())
      .order('started_at', { ascending: false })
      .limit(limit);
    let n = 0;
    for (const r of data ?? []) if (await this.mark(admin, r.id!)) n++;
    return n;
  },

  /** Downloads a marked recording into private storage (first playback). Returns an error message or null. */
  async materialize(admin: DB, recordingId: string): Promise<string | null> {
    const { data: rec } = await admin.from('call_recordings').select('id, call_id, provider_recording_id, storage_path').eq('id', recordingId).maybeSingle();
    if (!rec?.provider_recording_id?.startsWith('sarvam:')) return 'Not a Sarvam recording.';
    if (rec.storage_path) return null;
    const cur = await read(admin);
    if (!cur) return 'Add your Sarvam API key on the Integrations page to play recordings.';
    const [appId, interactionId] = rec.provider_recording_id.slice(7).split('|');
    let res: Response;
    try {
      res = await fetch(url(cur.s, appId, `/recordings/${enc(interactionId)}`), { headers: { 'X-API-Key': cur.s.apiKey }, cache: 'no-store', signal: AbortSignal.timeout(90_000) });
    } catch {
      return 'Could not reach Sarvam. Please try again.';
    }
    if (res.status === 404) {
      await admin.from('call_recordings').delete().eq('id', rec.id);
      await admin.from('call_events').insert({ call_id: rec.call_id, event_type: 'recording_unavailable', source: 'system', payload: { provider: 'sarvam' } });
      return 'Sarvam has no recording for this call.';
    }
    if (res.status === 401 || res.status === 403) return 'Sarvam rejected the saved API key. Save a new key on the Integrations page.';
    if (!res.ok) return `Sarvam returned an error (HTTP ${res.status}). Please try again.`;
    const raw = new Uint8Array(await res.arrayBuffer());
    const audio = stereoToMono(raw);
    const duration = wavDurationSeconds(audio);
    const path = `calls/${rec.call_id}/${randomUUID()}.wav`;
    const up = await admin.storage.from(RECORDINGS_BUCKET).upload(path, audio, { contentType: 'audio/wav', upsert: false });
    if (up.error) return 'The recording could not be saved. Please try again.';
    const { data: done } = await admin
      .from('call_recordings')
      .update({ storage_bucket: RECORDINGS_BUCKET, storage_path: path, mime_type: 'audio/wav', size_bytes: audio.length, duration_seconds: duration ? Math.round(duration) : null })
      .eq('id', rec.id)
      .is('storage_path', null)
      .select('id');
    if (!done?.length) await admin.storage.from(RECORDINGS_BUCKET).remove([path]); // another request saved it first
    return null;
  },

  /** Downloads recordings that are marked but not saved yet, newest first, within a time budget. */
  async materializePending(admin: DB, opts: { limit?: number; budgetMs?: number } = {}): Promise<{ saved: number; failed: number; remaining: number }> {
    const started = Date.now();
    const budget = opts.budgetMs ?? 40_000;
    const { data } = await admin
      .from('recording_library_view')
      .select('id')
      .like('provider_recording_id', 'sarvam:%')
      .is('storage_path', null)
      .order('call_started_at', { ascending: false })
      .limit(opts.limit ?? 200);
    let saved = 0;
    let failed = 0;
    for (const r of data ?? []) {
      if (Date.now() - started > budget) break;
      const err = await this.materialize(admin, r.id!);
      if (err) failed++;
      else saved++;
    }
    const { count } = await admin.from('call_recordings').select('id', { count: 'exact', head: true }).like('provider_recording_id', 'sarvam:%').is('storage_path', null);
    return { saved, failed, remaining: count ?? 0 };
  },

  async counts(admin: DB): Promise<{ ready: number; waiting: number }> {
    const [a, b] = await Promise.all([
      admin.from('call_recordings').select('id', { count: 'exact', head: true }).not('storage_path', 'is', null),
      admin.from('call_recordings').select('id', { count: 'exact', head: true }).like('provider_recording_id', 'sarvam:%').is('storage_path', null),
    ]);
    return { ready: a.count ?? 0, waiting: b.count ?? 0 };
  },

  /** API key and workspace for Sarvam's REST APIs (instant calls, analytics), or null when no key is saved. */
  async apiCreds(admin: DB): Promise<Stored | null> {
    return (await read(admin))?.s ?? null;
  },
};
