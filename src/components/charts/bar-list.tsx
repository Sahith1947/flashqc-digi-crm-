import { CheckCircle2, CircleDashed, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { Tone } from '@/lib/constants';

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  tone?: Tone;
}

const toneColor: Record<Tone, string> = {
  good: 'var(--color-status-good)',
  warning: 'var(--color-status-warning)',
  serious: 'var(--color-status-serious)',
  critical: 'var(--color-status-critical)',
  neutral: '#a3a29c',
  info: 'var(--color-series-inbound)',
  brand: 'var(--color-series-outbound)',
};
const toneIcon: Partial<Record<Tone, typeof CheckCircle2>> = {
  good: CheckCircle2,
  warning: TriangleAlert,
  serious: TriangleAlert,
  critical: OctagonAlert,
  neutral: CircleDashed,
  info: Info,
};

/** Horizontal bars with label + value text (identity never by color alone). */
export function BarList({ items, emptyText = 'No data in this period.' }: { items: BarListItem[]; emptyText?: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));
  if (total === 0) return <p className="flex h-32 items-center justify-center text-sm text-ink-3">{emptyText}</p>;
  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const Icon = it.tone ? toneIcon[it.tone] : undefined;
        const pct = total ? Math.round((it.value / total) * 100) : 0;
        return (
          <li key={it.key} title={`${it.label}: ${it.value} (${pct}%)`}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-ink-2">
                {Icon && <Icon className="size-3.5 text-ink-3" aria-hidden />}
                {it.label}
              </span>
              <span className="tabular font-medium text-ink">
                {it.value.toLocaleString('en-IN')} <span className="font-normal text-ink-3">· {pct}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-canvas">
              <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: toneColor[it.tone ?? 'brand'] }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
