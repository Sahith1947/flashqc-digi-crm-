// Parses list-page search params (search, filters, sort, pagination) safely.
export type RawParams = Record<string, string | string[] | undefined>;

export function flatParams(sp: RawParams): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === 'string' && val !== '') out[k] = val.slice(0, 200);
  }
  return out;
}

export function parsePage(v: string | undefined): number {
  const n = Number.parseInt(v ?? '1', 10);
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : 1;
}

export function parseSort<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export function parseEnum<T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.includes(v as T) ? (v as T) : undefined;
}

/** Escapes a user search term for PostgREST `ilike` inside an `or()` filter. */
export function searchTerm(q: string | undefined): string | null {
  if (!q) return null;
  const cleaned = q.replace(/[%_\\(),."']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned ? `%${cleaned}%` : null;
}

export function isUuid(v: string | undefined | null): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
