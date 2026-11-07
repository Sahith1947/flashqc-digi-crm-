'use client';
import { useState } from 'react';
import { ChartFrame, formatTick, niceMax, useMeasuredWidth, type SeriesDef } from './chart-frame';

export interface LineDatum {
  label: string;
  values: Record<string, number>;
}

const H = 220;
const PAD = { top: 14, right: 16, bottom: 28, left: 40 };

/** Multi-series line chart on one shared axis, with crosshair tooltip. */
export function LineChart({ data, series }: { data: LineDatum[]; series: SeriesDef[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [boxRef, W] = useMeasuredWidth<HTMLDivElement>();
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0))));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((W - PAD.left) / 56))));
  const empty = data.every((d) => series.every((s) => !d.values[s.key]));

  return (
    <ChartFrame
      series={series}
      empty={empty}
      table={{ headers: ['Period', ...series.map((s) => s.label)], rows: data.map((d) => [d.label, ...series.map((s) => d.values[s.key] ?? 0)]) }}
    >
      <div className="relative" ref={boxRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block h-[220px] w-full"
          role="img"
          aria-label="Line chart"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const idx = data.length <= 1 ? 0 : Math.round(((px - PAD.left) / innerW) * (data.length - 1));
            setHover(Math.max(0, Math.min(data.length - 1, idx)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-ink-3 text-[10px]">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-3 text-[10px]">
                {d.label}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--color-line-strong)" vectorEffect="non-scaling-stroke" />}
          {series.map((s) => (
            <g key={s.key}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                points={data.map((d, i) => `${x(i)},${y(d.values[s.key] ?? 0)}`).join(' ')}
              />
              {hover !== null && <circle cx={x(hover)} cy={y(data[hover].values[s.key] ?? 0)} r={4} fill={s.color} stroke="white" strokeWidth={2} />}
            </g>
          ))}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: `${Math.min(75, Math.max(0, (x(hover) / W) * 100 - 10))}%` }}
          >
            <p className="mb-1 font-semibold text-ink">{data[hover].label}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4 text-ink-2">
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="tabular font-medium text-ink">{(data[hover].values[s.key] ?? 0).toLocaleString('en-IN')}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
