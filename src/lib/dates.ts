// Date helpers. Storage is UTC; display and day boundaries use Asia/Kolkata (UTC+05:30, no DST).
// Pure module (no imports).

export const APP_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;

/** YYYY-MM-DD of the given instant in IST. */
export function istDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant for 00:00 IST on the given YYYY-MM-DD. */
export function istStartOfDay(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidDateString(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'month' | 'custom';

export interface DateRange {
  preset: RangePreset;
  /** inclusive IST start date */
  fromDate: string;
  /** inclusive IST end date */
  toDate: string;
  /** UTC instant, inclusive */
  from: Date;
  /** UTC instant, exclusive */
  to: Date;
  label: string;
}

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];

/** Resolves a date range from URL params, in IST. Invalid input falls back to the default preset. */
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  fallback: RangePreset = '30d',
  now: Date = new Date(),
): DateRange {
  const today = istDateString(now);
  const preset = (RANGE_PRESETS.some((p) => p.value === params.range) ? params.range : fallback) as RangePreset;
  let fromDate: string;
  let toDate = today;

  switch (preset) {
    case 'today':
      fromDate = today;
      break;
    case '7d':
      fromDate = addDays(today, -6);
      break;
    case '90d':
      fromDate = addDays(today, -89);
      break;
    case 'month':
      fromDate = today.slice(0, 8) + '01';
      break;
    case 'custom':
      if (isValidDateString(params.from) && isValidDateString(params.to) && params.from <= params.to) {
        fromDate = params.from;
        toDate = params.to;
        // Cap custom ranges at ~3 years to keep queries bounded.
        if (istStartOfDay(toDate).getTime() - istStartOfDay(fromDate).getTime() > 1100 * 86400000) {
          fromDate = addDays(toDate, -1099);
        }
      } else {
        // Custom selected but no (valid) dates yet: default to the last 30 days.
        fromDate = addDays(today, -29);
      }
      break;
    case '30d':
    default:
      fromDate = addDays(today, -29);
  }

  const label =
    preset === 'custom'
      ? `${fromDate} → ${toDate}`
      : (RANGE_PRESETS.find((p) => p.value === preset)?.label ?? '');
  return {
    preset,
    fromDate,
    toDate,
    from: istStartOfDay(fromDate),
    to: istStartOfDay(addDays(toDate, 1)),
    label,
  };
}

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: APP_TIME_ZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: 'numeric' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

/** Formats a bucket date (YYYY-MM-DD, already an IST calendar date) for chart axes. */
export function formatBucket(date: string, granularity: 'day' | 'week' | 'month'): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (granularity === 'month') return monthFmt.format(d);
  return shortDateFmt.format(d);
}

/** 125 → "2m 05s"; 3725 → "1h 02m" */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

/** Current HH:MM in IST. */
export function istTimeOfDay(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** True if HH:MM(:SS) `now` lies inside [start, end). */
export function isWithinWindow(nowHHMM: string, start: string, end: string): boolean {
  const n = nowHHMM.slice(0, 5);
  return n >= start.slice(0, 5) && n < end.slice(0, 5);
}
