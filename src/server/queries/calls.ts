import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { CALL_OUTCOMES, CALL_STATUSES, MISSED_STATUSES } from '@/lib/constants';
import { addDays, isValidDateString, istStartOfDay } from '@/lib/dates';
import { isUuid, parseEnum, parsePage, parseSort, searchTerm } from '@/lib/list-params';
import { CALL_SORTS } from '@/components/calls/calls-table';
import { normalizePhone } from '@/lib/phone';

export const CALLS_PAGE_SIZE = 25;

export interface CallFilters {
  q?: string;
  direction?: 'inbound' | 'outbound';
  status?: string; // a CALL_STATUS or the virtual 'missed_any' / 'answered'
  outcome?: string;
  campaign?: string;
  contact?: string;
  scope?: 'live' | 'simulated';
  from?: string;
  to?: string;
  recording?: 'yes' | 'no';
}

export function parseCallFilters(p: Record<string, string | undefined>, forced: Partial<CallFilters> = {}): CallFilters {
  const status = p.status && ([...CALL_STATUSES, 'missed_any', 'answered'] as string[]).includes(p.status) ? p.status : undefined;
  return {
    q: p.q,
    direction: forced.direction ?? parseEnum(p.direction, ['inbound', 'outbound'] as const),
    status,
    outcome: p.outcome && ([...CALL_OUTCOMES, 'not_set'] as string[]).includes(p.outcome) ? p.outcome : undefined,
    campaign: isUuid(p.campaign) ? p.campaign : undefined,
    contact: isUuid(p.contact) ? p.contact : undefined,
    scope: parseEnum(p.scope, ['live', 'simulated'] as const),
    from: isValidDateString(p.from) ? p.from : undefined,
    to: isValidDateString(p.to) ? p.to : undefined,
    recording: parseEnum(p.recording, ['yes', 'no'] as const),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCallFilters<Q extends { eq: any; in: any; is: any; not: any; gte: any; lt: any; or: any }>(query: Q, f: CallFilters): Q {
  let q = query;
  if (f.direction) q = q.eq('direction', f.direction);
  if (f.status === 'missed_any') q = q.in('status', MISSED_STATUSES);
  else if (f.status === 'answered') q = q.eq('is_answered', true);
  else if (f.status) q = q.eq('status', f.status);
  if (f.outcome === 'not_set') q = q.is('outcome', null);
  else if (f.outcome) q = q.eq('outcome', f.outcome);
  if (f.campaign) q = q.eq('campaign_id', f.campaign);
  if (f.contact) q = q.eq('contact_id', f.contact);
  if (f.scope === 'live') q = q.eq('is_simulated', false);
  if (f.scope === 'simulated') q = q.eq('is_simulated', true);
  if (f.from) q = q.gte('started_at', istStartOfDay(f.from).toISOString());
  if (f.to) q = q.lt('started_at', istStartOfDay(addDays(f.to, 1)).toISOString());
  if (f.recording === 'yes') q = q.eq('has_recording', true);
  if (f.recording === 'no') q = q.eq('has_recording', false);
  const term = searchTerm(f.q);
  if (term) {
    const phone = normalizePhone(f.q);
    const digits = (f.q ?? '').replace(/\D/g, '');
    const parts = [`contact_name.ilike.${term}`, `business_name.ilike.${term}`];
    if (phone.ok) parts.push(`phone_e164.eq.${phone.e164}`);
    else if (digits.length >= 3) parts.push(`phone_e164.ilike.%${digits}%`);
    if (/^cl-?\d+$/i.test((f.q ?? '').trim())) parts.push(`call_number.eq.${Number((f.q ?? '').replace(/\D/g, ''))}`);
    q = q.or(parts.join(','));
  }
  return q;
}

export async function listCalls(db: DB, params: Record<string, string | undefined>, forced: Partial<CallFilters> = {}) {
  const filters = parseCallFilters(params, forced);
  const page = parsePage(params.page);
  const sort = parseSort(params.sort, CALL_SORTS, 'started_at');
  const ascending = params.dir === 'asc';
  let q = db.from('call_log_view').select('*', { count: 'exact' });
  q = applyCallFilters(q, filters);
  q = q.order(sort, { ascending }).order('id', { ascending: true });
  const fromIdx = (page - 1) * CALLS_PAGE_SIZE;
  const { data, count, error } = await q.range(fromIdx, fromIdx + CALLS_PAGE_SIZE - 1);
  if (error) {
    // Out-of-range page → PostgREST 416. Treat as empty page instead of an error.
    if (error.code === 'PGRST103') return { rows: [], total: count ?? 0, page, filters };
    throw error;
  }
  return { rows: data ?? [], total: count ?? 0, page, filters };
}

export async function campaignOptions(db: DB) {
  const { data } = await db.from('campaigns').select('id, name').order('created_at', { ascending: false }).limit(200);
  return (data ?? []).map((c) => ({ value: c.id, label: c.name }));
}
