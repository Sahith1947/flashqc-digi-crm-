'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';

export interface SeriesDef {
  key: string;
  label: string;
  color: string; // CSS color / var
}

export function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Wraps a chart with a legend and a chart/table toggle (the table is the accessible view). */
export function ChartFrame({
  series,
  table,
  children,
  empty,
}: {
  series: SeriesDef[];
  table: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
  empty?: boolean;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Legend series={series} />
        <button
          type="button"
          onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-canvas hover:text-ink"
          aria-pressed={view === 'table'}
        >
          {view === 'chart' ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
          {view === 'chart' ? 'Table' : 'Chart'}
        </button>
      </div>
      {empty ? (
        <p className="flex h-48 items-center justify-center text-sm text-ink-3">No calls in this period.</p>
      ) : view === 'chart' ? (
        children
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {table.headers.map((h) => (
                  <th key={h} className="sticky top-0 border-b border-line bg-surface px-2 py-1.5 text-left font-semibold text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="border-b border-line px-2 py-1.5 text-ink">
                      {typeof c === 'number' ? c.toLocaleString('en-IN') : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

export function formatTick(v: number): string {
  if (v >= 10000) return `${Math.round(v / 1000)}K`;
  return v.toLocaleString('en-IN');
}

/** Measures an element's width so charts draw at 1:1 scale (no stretched text). */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
