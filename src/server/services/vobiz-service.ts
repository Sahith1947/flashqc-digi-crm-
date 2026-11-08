import 'server-only';
import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/supabase/types';
import { decryptSecret, encryptSecret, encryptionAvailable } from '@/server/crypto';
import { AppError } from '@/server/providers/types';
import { RECORDINGS_BUCKET } from '@/server/services/recording-service';
import { matchRecording, normalizeRecording, type VobizRecording } from '@/lib/vobiz';

// Vobiz (the SIP trunk behind the Sarvam phone number) keeps the call recordings that Sarvam does not.
// REST: https://api.vobiz.ai/api/v1/Account/{auth_id}/Recording/ with X-Auth-ID / X-Auth-Token headers.
// The keys are stored AES-GCM encrypted in integration_credentials (service role only).

const KEY = 'vobiz';
const AAD = 'integration:vobiz';
const BASE = () => (process.env.VOBIZ_BASE_URL || 'https://api.vobiz.ai').replace(/\/$/, '');
/** Only for automated tests against a local fake Vobiz: allows http audio links on 127.0.0.1. */
const LOCAL_TEST = () => /^http:\/\/127\.0\.0\.1:\d+$/.test(BASE());
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const mask = (id: string) => (id.length <= 6 ? '••••' : `${id.slice(0, 4)}••••${id.slice(-3)}`);

interface Creds {
  authId: string;
  authToken: string;
}
export interface VobizStatus {
  connected: boolean;
  authIdMasked: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  attached: number;
  trunkRecording: 'on' | 'off' | 'unknown';
}

async function readCreds(admin: DB): Promise<{ creds: Creds; metadata: Record<string, unknown> } | null> {
  const { data } = await admin.from('integration_credentials').select('ciphertext, metadata').eq('key', KEY).maybeSingle();
  if (!data) return null;
  try {
    return { creds: JSON.parse(decryptSecret(data.ciphertext, AAD)) as Creds, metadata: (data.metadata ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

async function saveMeta(admin: DB, patch: Record<string, unknown>) {
  const cur = await readCreds(admin);
  if (!cur) return;
  await admin.from('integration_credentials').update({ metadata: { ...cur.metadata, ...patch } as never }).eq('key', KEY);
}

async function api<T>(creds: Creds, path: string, query: Record<string, string | number | undefined> = {}): Promise<{ status: number; data: T | null }> {
  const url = new URL(`${BASE()}/api/v1/Account/${encodeURIComponent(creds.authId)}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { 'X-Auth-ID': creds.authId, 'X-Auth-Token': creds.authToken, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

const objectsOf = (d: unknown): Record<string, unknown>[] => {
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  if (d && typeof d === 'object') {
    for (const k of ['objects', 'data', 'recordings', 'items', 'trunks', 'results']) {
      const v = (d as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
};

const ymd = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10); // India date

export const VobizService = {
  async status(admin: DB): Promise<VobizStatus> {
    const cur = await readCreds(admin);
    const { count } = await admin.from('call_recordings').select('id', { count: 'exact', head: true }).like('provider_recording_id', 'vobiz:%');
    if (!cur) return { connected: false, authIdMasked: null, connectedAt: null, lastSyncAt: null, lastError: null, attached: count ?? 0, trunkRecording: 'unknown' };
    const m = cur.metadata;
    return {
      connected: true,
      authIdMasked: mask(cur.creds.authId),
      connectedAt: (m.connected_at as string) ?? null,
      lastSyncAt: (m.last_sync_at as string) ?? null,
      lastError: (m.last_error as string) ?? null,
      attached: count ?? 0,
      trunkRecording: (m.trunk_recording as VobizStatus['trunkRecording']) ?? 'unknown',
    };
  },

  /** Checks the keys against Vobiz, then stores them encrypted. */
  async connect(admin: DB, authId: string, authToken: string): Promise<void> {
    if (!encryptionAvailable()) throw new AppError('The server cannot encrypt secrets (missing server key).');
    const creds = { authId: authId.trim(), authToken: authToken.trim() };
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(creds.authId)) throw new AppError('That does not look like a Vobiz Auth ID.');
    if (creds.authToken.length < 8 || creds.authToken.length > 200) throw new AppError('That does not look like a Vobiz Auth Token.');
    let res;
    try {
      res = await api(creds, '/Recording/', { limit: 1, offset: 0 });
    } catch {
      throw new AppError('Could not reach Vobiz. Please try again in a minute.');
    }
    if (res.status === 401 || res.status === 403) throw new AppError('Vobiz rejected these keys. Copy the Auth ID and Auth Token again from your Vobiz console.');
    if (res.status >= 400) throw new AppError(`Vobiz returned an error (HTTP ${res.status}). Please try again.`);
    const trunk = await this.trunkRecording(creds).catch(() => 'unknown' as const);
    const row = {
      key: KEY,
      ciphertext: encryptSecret(JSON.stringify(creds), AAD),
      metadata: { connected_at: new Date().toISOString(), trunk_recording: trunk },
    };
    const { error } = await admin.from('integration_credentials').upsert(row, { onConflict: 'key' });
    if (error) throw error;
  },

  async disconnect(admin: DB) {
    await admin.from('integration_credentials').delete().eq('key', KEY);
  },

  /** Whether call recording is switched on for the Vobiz SIP trunk(s). */
  async trunkRecording(creds: Creds): Promise<'on' | 'off' | 'unknown'> {
    const res = await api<unknown>(creds, '/trunks/');
    const trunks = objectsOf(res.data);
    if (res.status >= 400 || !trunks.length) return 'unknown';
    const flags = trunks.map((t) => t.recording ?? t.recording_enabled ?? t.record);
    if (flags.some((f) => f === true || f === 'true')) return 'on';
    if (flags.every((f) => f === false || f === 'false')) return 'off';
    return 'unknown';
  },

  /** Recordings Vobiz holds between two India dates (newest first, bounded). */
  async listRecordings(creds: Creds, fromDate: string, toDate: string, maxPages = 10): Promise<VobizRecording[]> {
    const out: VobizRecording[] = [];
    for (let page = 0; page < maxPages; page++) {
      const res = await api<unknown>(creds, '/Recording/', { limit: 20, offset: page * 20, from_date: fromDate, to_date: toDate });
      if (res.status === 401 || res.status === 403) throw new AppError('Vobiz rejected the saved keys. Reconnect Vobiz on the Integrations page.');
      if (res.status >= 400) throw new AppError(`Vobiz returned an error (HTTP ${res.status}).`);
      const items = objectsOf(res.data);
      for (const it of items) {
        const n = normalizeRecording(it, { allowLocalHttp: LOCAL_TEST() });
        if (n) out.push(n);
      }
      if (items.length < 20) break;
    }
    return out;
  },

  /** Downloads the audio into private storage; falls back to the Vobiz link if the download fails. */
  async attach(admin: DB, callId: string, rec: VobizRecording, creds: Creds): Promise<boolean> {
    const providerId = `vobiz:${rec.id}`.slice(0, 200);
    let storage: { path: string; mime: string; size: number } | null = null;
    try {
      const host = new URL(rec.url).hostname;
      const headers: Record<string, string> = host.endsWith('vobiz.ai') ? { 'X-Auth-ID': creds.authId, 'X-Auth-Token': creds.authToken } : {};
      const res = await fetch(rec.url, { headers, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const ctype = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const ext = rec.format === 'wav' || ctype.includes('wav') ? 'wav' : 'mp3';
      const mime = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
      if (res.ok && buf.length > 0 && buf.length <= MAX_AUDIO_BYTES && (!ctype || ctype.startsWith('audio/') || ctype === 'application/octet-stream')) {
        const path = `calls/${callId}/${randomUUID()}.${ext}`;
        const up = await admin.storage.from(RECORDINGS_BUCKET).upload(path, buf, { contentType: mime, upsert: false });
        if (!up.error) storage = { path, mime, size: buf.length };
      }
    } catch (e) {
      console.error('[vobiz] download', e);
    }
    const { error } = await admin.from('call_recordings').insert({
      call_id: callId,
      source: 'provider',
      provider_recording_id: providerId,
      provider_recording_url: storage ? null : rec.url.slice(0, 4000),
      storage_bucket: storage ? RECORDINGS_BUCKET : null,
      storage_path: storage?.path ?? null,
      mime_type: storage?.mime ?? null,
      size_bytes: storage?.size ?? null,
      duration_seconds: rec.durationSeconds,
    });
    if (error) {
      if (storage) await admin.storage.from(RECORDINGS_BUCKET).remove([storage.path]);
      if (error.code === '23505') return false; // already attached
      throw error;
    }
    await admin.from('call_events').insert({
      call_id: callId,
      event_type: 'recording_fetched',
      source: 'system',
      payload: { provider: 'vobiz', recording_id: rec.id, stored: Boolean(storage) },
    });
    return true;
  },

  /**
   * Matches Vobiz recordings to answered real calls that have none yet (last `days` days).
   * Returns how many recordings were attached, or null when Vobiz is not connected.
   */
  async sync(admin: DB, opts: { days?: number; callId?: string } = {}): Promise<number | null> {
    const cur = await readCreds(admin);
    if (!cur) return null;
    const since = new Date(Date.now() - (opts.days ?? 7) * 86400_000).toISOString();
    let q = admin
      .from('call_log_view')
      .select('id, phone_e164, started_at, ended_at')
      .eq('is_simulated', false)
      .eq('has_recording', false)
      .not('answered_at', 'is', null)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(200);
    if (opts.callId) q = q.eq('id', opts.callId);
    const { data: rows, error } = await q;
    if (error) throw error;
    const calls = (rows ?? []).map((r) => ({
      id: r.id!,
      phone: r.phone_e164 ?? '',
      startedAt: new Date(r.started_at!).getTime(),
      endedAt: new Date(r.ended_at ?? r.started_at!).getTime(),
    }));
    if (!calls.length) {
      await saveMeta(admin, { last_sync_at: new Date().toISOString(), last_error: null });
      return 0;
    }
    const oldest = Math.min(...calls.map((c) => c.startedAt)) - 86400_000;
    let attached = 0;
    try {
      const recs = await this.listRecordings(cur.creds, ymd(oldest), ymd(Date.now() + 86400_000));
      const { data: used } = await admin.from('call_recordings').select('provider_recording_id').like('provider_recording_id', 'vobiz:%');
      const usedIds = new Set((used ?? []).map((u) => u.provider_recording_id));
      const taken = new Set<string>();
      for (const rec of recs) {
        if (usedIds.has(`vobiz:${rec.id}`)) continue;
        const call = matchRecording(rec, calls.filter((c) => !taken.has(c.id)));
        if (!call) continue;
        if (await this.attach(admin, call.id, rec, cur.creds)) {
          attached++;
          taken.add(call.id);
        }
        if (attached >= 20) break;
      }
      const trunk = await this.trunkRecording(cur.creds).catch(() => 'unknown' as const);
      await saveMeta(admin, { last_sync_at: new Date().toISOString(), last_error: null, trunk_recording: trunk });
    } catch (e) {
      await saveMeta(admin, { last_sync_at: new Date().toISOString(), last_error: e instanceof Error ? e.message.slice(0, 300) : 'Sync failed' });
      throw e;
    }
    return attached;
  },
};
