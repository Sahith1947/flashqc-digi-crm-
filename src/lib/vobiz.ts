// Vobiz recording parsing and call matching. Pure module (no imports) so it can be unit-tested.

export interface VobizRecording {
  id: string;
  url: string;
  callUuid: string | null;
  numbers: string[]; // last 10 digits of every phone number on the record
  at: number | null; // epoch ms
  durationSeconds: number | null;
  format: string | null;
}
export const MATCH_WINDOW_MS = 10 * 60_000;
export const last10 = (s: string) => s.replace(/\D/g, '').slice(-10);

/** Vobiz timestamps: epoch (s or ms) or a date string; strings without a zone are India time. */
export function parseVobizTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  if (/^\d{10,13}$/.test(s)) return parseVobizTime(Number(s));
  const iso = s.replace(' ', 'T');
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
  const t = Date.parse(hasZone ? iso : `${iso}+05:30`);
  return Number.isFinite(t) ? t : null;
}

/** Normalises one recording as Vobiz returns it (field names vary between API versions). */
export function normalizeRecording(r: Record<string, unknown>, opts: { allowLocalHttp?: boolean } = {}): VobizRecording | null {
  const id = String(r.recording_id ?? r.id ?? '').trim();
  const url = String(r.recording_url ?? r.url ?? '').trim();
  const okUrl = /^https:\/\//.test(url) || (opts.allowLocalHttp === true && /^http:\/\/127\.0\.0\.1:\d+\//.test(url));
  if (!id || !okUrl) return null;
  const numbers: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    if (/(^|_)(from|to|caller|callee|number|destination|source)(_|$)/i.test(k)) {
      const d = last10(String(v));
      if (d.length === 10) numbers.push(d);
    }
  }
  const at =
    parseVobizTime(r.recording_start_ms) ??
    parseVobizTime(r.add_time) ??
    parseVobizTime(r.recording_start_time) ??
    parseVobizTime(r.start_time) ??
    parseVobizTime(r.created_at) ??
    parseVobizTime(r.recording_end_ms);
  const durMs = Number(r.recording_duration_ms);
  const dur = Number.isFinite(durMs) && durMs > 0 ? durMs / 1000 : Number(r.recording_duration ?? r.duration);
  return {
    id,
    url,
    callUuid: typeof r.call_uuid === 'string' ? r.call_uuid : null,
    numbers: [...new Set(numbers)],
    at,
    durationSeconds: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
    format: typeof r.recording_format === 'string' ? r.recording_format.toLowerCase() : null,
  };
}

/** Picks the CRM call a recording belongs to: same customer number, closest in time (within 10 minutes). */
export function matchRecording<T extends { phone: string; startedAt: number; endedAt: number }>(rec: VobizRecording, calls: T[]): T | null {
  if (!rec.at || !rec.numbers.length) return null;
  let best: T | null = null;
  let bestGap = Infinity;
  for (const c of calls) {
    if (!rec.numbers.includes(last10(c.phone))) continue;
    const gap = Math.min(Math.abs(rec.at - c.startedAt), Math.abs(rec.at - c.endedAt));
    if (gap <= MATCH_WINDOW_MS && gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

