import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { CONSENT_STATUSES, DND_STATUSES } from '@/lib/constants';
import { parseEnum, parsePage, parseSort, searchTerm } from '@/lib/list-params';
import { normalizePhone } from '@/lib/phone';
import { LEAD_STAGES, LEAD_TEMPERATURES } from '@/lib/leads';

export const CONTACTS_PAGE_SIZE = 25;
export const CONTACT_SORTS = ['full_name', 'created_at', 'total_calls', 'last_call_at', 'city', 'lead_updated_at'] as const;

export interface ContactFilters {
  q?: string;
  city?: string;
  category?: string;
  source?: string;
  consent?: (typeof CONSENT_STATUSES)[number];
  dnd?: (typeof DND_STATUSES)[number];
  suppressed?: 'yes' | 'no';
  stage?: (typeof LEAD_STAGES)[number];
  temperature?: (typeof LEAD_TEMPERATURES)[number];
}

export function parseContactFilters(p: Record<string, string | undefined>): ContactFilters {
  return {
    q: p.q,
    city: p.city?.slice(0, 120),
    category: p.category?.slice(0, 120),
    source: p.source?.slice(0, 60),
    consent: parseEnum(p.consent, CONSENT_STATUSES),
    dnd: parseEnum(p.dnd, DND_STATUSES),
    suppressed: parseEnum(p.suppressed, ['yes', 'no'] as const),
    stage: parseEnum(p.stage, LEAD_STAGES),
    temperature: parseEnum(p.temperature, LEAD_TEMPERATURES),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyContactFilters<Q extends { eq: any; or: any; ilike: any }>(query: Q, f: ContactFilters): Q {
  let q = query;
  if (f.city) q = q.ilike('city', f.city.replace(/[%_]/g, ''));
  if (f.category) q = q.ilike('business_category', f.category.replace(/[%_]/g, ''));
  if (f.source) q = q.eq('source', f.source);
  if (f.consent) q = q.eq('consent_status', f.consent);
  if (f.dnd) q = q.eq('dnd_status', f.dnd);
  if (f.suppressed) q = q.eq('is_suppressed', f.suppressed === 'yes');
  if (f.stage) q = q.eq('lead_stage', f.stage);
  if (f.temperature) q = q.eq('lead_temperature', f.temperature);
  const term = searchTerm(f.q);
  if (term) {
    const phone = normalizePhone(f.q);
    const digits = (f.q ?? '').replace(/\D/g, '');
    const parts = [`full_name.ilike.${term}`, `business_name.ilike.${term}`, `notes.ilike.${term}`];
    if (phone.ok) parts.push(`phone_e164.eq.${phone.e164}`);
    else if (digits.length >= 3) parts.push(`phone_e164.ilike.%${digits}%`);
    q = q.or(parts.join(','));
  }
  return q;
}

export async function listContacts(db: DB, params: Record<string, string | undefined>) {
  const filters = parseContactFilters(params);
  const page = parsePage(params.page);
  const sort = parseSort(params.sort, CONTACT_SORTS, 'created_at');
  const ascending = params.dir ? params.dir === 'asc' : sort === 'full_name' || sort === 'city';
  let q = db.from('contacts_with_stats').select('*', { count: 'exact' });
  q = applyContactFilters(q, filters).order(sort, { ascending, nullsFirst: false }).order('id');
  const from = (page - 1) * CONTACTS_PAGE_SIZE;
  const { data, count, error } = await q.range(from, from + CONTACTS_PAGE_SIZE - 1);
  if (error) {
    if (error.code === 'PGRST103') return { rows: [], total: count ?? 0, page, filters };
    throw error;
  }
  return { rows: data ?? [], total: count ?? 0, page, filters };
}

/** Distinct values for filter dropdowns (bounded). */
export async function contactFacets(db: DB) {
  const { data } = await db.from('contacts').select('city, business_category, source').limit(5000);
  const uniq = (vals: (string | null)[]) =>
    [...new Map(vals.filter((v): v is string => Boolean(v && v.trim())).map((v) => [v.toLowerCase(), v])).values()].sort((a, b) => a.localeCompare(b)).slice(0, 200);
  return {
    cities: uniq((data ?? []).map((d) => d.city)),
    categories: uniq((data ?? []).map((d) => d.business_category)),
    sources: uniq((data ?? []).map((d) => d.source)),
  };
}
