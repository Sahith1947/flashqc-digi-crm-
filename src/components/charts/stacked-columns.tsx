'use client';
import { useState } from 'react';
import { ChartFrame, formatTick, niceMax, useMeasuredWidth, type SeriesDef } from './chart-frame';

export interface ColumnDatum {
  label: string;
  values: Record<string, number>;
}

const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 40 };

/** Stacked columns (e.g. inbound vs outbound per day). 2px surface gap between segments. */
export function StackedColumns({ data, series }: { data: ColumnDatum[]; series: SeriesDef[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useMeasuredWidth<HTMLDivElement>();
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(24, band * 0.7);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((W - PAD.left) / 48))));

  return (
    <ChartFrame
      series={series}
      empty={totals.every((t) => t === 0)}
      table={{ headers: ['Period', ...series.map((s) => s.label), 'Total'], rows: data.map((d, i) => [d.label, ...series.map((s) => d.values[s.key] ?? 0), totals[i]]) }}
    >
      <div className="relative" ref={boxRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block h-[220px] w-full" role="img" aria-label="Column chart">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-ink-3 text-[10px]">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            let acc = 0;
            const segs = series.map((s, si) => {
              const v = d.values[s.key] ?? 0;
              const y0 = y(acc);
              acc += v;
              const y1 = y(acc);
              const isTop = series.slice(si + 1).every((n) => (d.values[n.key] ?? 0) === 0);
              const h = Math.max(0, y0 - y1 - (isTop ? 0 : 2));
              if (v === 0 || h <= 0) return null;
              const r = isTop ? Math.min(4, h, barW / 2) : 0;
              const x0 = cx - barW / 2;
              const top = y1 + (isTop ? 0 : 2);
              const path = r
                ? `M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${top + h} Z`
                : `M${x0},${top + h} V${top} H${x0 + barW} V${top + h} Z`;
              return <path key={s.key} d={path} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
            });
            return (
              <g key={i}>
                {segs}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`${d.label}: ${series.map((s) => `${s.label} ${d.values[s.key] ?? 0}`).join(', ')}`}
                />
                {i % labelEvery === 0 && (
                  <text x={cx} y={H - 8} textAnchor="middle" className="fill-ink-3 text-[10px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: `${Math.min(80, Math.max(0, ((PAD.left + band * hover + band / 2) / W) * 100 - 10))}%` }}
          >
            <p className="mb-1 font-semibold text-ink">{data[hover].label}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4 text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="tabular font-medium text-ink">{(data[hover].values[s.key] ?? 0).toLocaleString('en-IN')}</span>
              </p>
            ))}
            <p className="mt-1 flex justify-between border-t border-line pt-1 text-ink-2">
              Total <span className="tabular font-semibold text-ink">{totals[hover].toLocaleString('en-IN')}</span>
            </p>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
