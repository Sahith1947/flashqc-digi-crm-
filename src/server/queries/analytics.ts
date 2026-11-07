import 'server-only';
import type { DB } from '@/lib/supabase/types';
import type { DataScope } from '@/lib/constants';
import { addDays, istDateString, istStartOfDay } from '@/lib/dates';

export interface Summary {
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  failed: number;
  simulated: number;
  talk_time_seconds: number;
  avg_duration_seconds: number;
  status_distribution: Record<string, number>;
}

export async function getSummary(db: DB, from: Date, to: Date, scope: DataScope): Promise<Summary> {
  const { data, error } = await db.rpc('dashboard_summary', { p_from: from.toISOString(), p_to: to.toISOString(), p_scope: scope });
  if (error) throw error;
  return data as unknown as Summary;
}

export type Granularity = 'day' | 'week' | 'month';

export async function getTrends(db: DB, from: Date, to: Date, granularity: Granularity, scope: DataScope) {
  const { data, error } = await db.rpc('call_trends', {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_granularity: granularity,
    p_scope: scope,
  });
  if (error) throw error;
  return data ?? [];
}

/** Last 12 weeks / 12 months ending today (IST), independent of the selected range. */
export function trailingWindow(kind: 'week' | 'month'): { from: Date; to: Date } {
  const today = istDateString();
  const to = istStartOfDay(addDays(today, 1));
  if (kind === 'week') return { from: istStartOfDay(addDays(today, -7 * 11 - 6)), to };
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 11);
  return { from: istStartOfDay(d.toISOString().slice(0, 10)), to };
}

/** ISO timestamp N days before now (request-time helper). */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export function pct(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}
