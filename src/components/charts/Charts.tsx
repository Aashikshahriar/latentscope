import { useMemo, useState } from 'react';
import { useElementSize } from '@/hooks/useMediaQuery';
import { formatTick, niceTicks } from '@/visualization/common/geometry';

const AXIS = '#7d8aa0';
const GRID = '#273246';

function useWidth() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const { width } = useElementSize(el);
  return { ref: setEl, width };
}

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
  secondary?: number;
}

/** Horizontal bar chart with value labels — for class counts and per-component variance. */
export function HorizontalBars({
  data,
  format = (v) => String(v),
  maxBars = 30,
  ariaLabel,
}: {
  data: BarDatum[];
  format?: (v: number) => string;
  maxBars?: number;
  ariaLabel: string;
}) {
  const shown = data.slice(0, maxBars);
  const max = Math.max(...shown.map((d) => d.value), 0) || 1;
  return (
    <div role="list" aria-label={ariaLabel} className="space-y-1">
      {shown.map((d) => (
        <div
          role="listitem"
          key={d.label}
          className="grid grid-cols-[minmax(4rem,8rem)_1fr_auto] items-center gap-2 text-xs"
        >
          <span className="truncate text-muted" title={d.label}>
            {d.label}
          </span>
          <div className="h-2 rounded-full bg-line/60">
            <div
              className="h-full rounded-full"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? 'var(--color-accent)' }}
            />
          </div>
          <span className="num text-fg/90">{format(d.value)}</span>
        </div>
      ))}
      {data.length > maxBars && <p className="text-2xs text-subtle">+ {data.length - maxBars} more</p>}
    </div>
  );
}

export interface Series {
  name: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
  markers?: boolean;
}

export function LineChart({
  series,
  height = 160,
  xLabel,
  yLabel,
  yDomain,
  ariaLabel,
  bars,
}: {
  series: Series[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  yDomain?: [number, number];
  ariaLabel: string;
  /** Optional bars drawn under the lines (e.g. scree plot). */
  bars?: { x: number; y: number; color: string }[];
}) {
  const { ref, width } = useWidth();
  const m = { top: 10, right: 12, bottom: xLabel ? 32 : 20, left: 44 };
  const layout = useMemo(() => {
    const all = [...series.flatMap((s) => s.points), ...(bars ?? [])];
    if (all.length === 0 || width === 0) return null;
    let xmin = Math.min(...all.map((p) => p.x));
    let xmax = Math.max(...all.map((p) => p.x));
    if (bars?.length) {
      xmin -= 0.5;
      xmax += 0.5;
    }
    if (xmax === xmin) xmax = xmin + 1;
    const [ymin, ymax] = yDomain ?? [
      Math.min(0, ...all.map((p) => p.y)),
      Math.max(...all.map((p) => p.y)) * 1.05 || 1,
    ];
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;
    const sx = (x: number) => m.left + ((x - xmin) / (xmax - xmin)) * iw;
    const sy = (y: number) => m.top + ih - ((y - ymin) / (ymax - ymin || 1)) * ih;
    const yt = niceTicks(ymin, ymax, 4);
    const xt = bars?.length
      ? bars.map((b) => b.x).filter((_, i, arr) => arr.length <= 12 || i % Math.ceil(arr.length / 12) === 0)
      : niceTicks(xmin, xmax, 5);
    return { sx, sy, yt, xt, iw, ih, barWidth: bars?.length ? Math.max(2, (iw / (xmax - xmin)) * 0.7) : 0 };
  }, [series, bars, width, height, yDomain, m.left, m.right, m.top, m.bottom]);

  return (
    <div ref={ref} className="w-full">
      {layout && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
          {layout.yt.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={layout.sy(t)} y2={layout.sy(t)} stroke={GRID} />
              <text
                x={m.left - 6}
                y={layout.sy(t) + 3}
                textAnchor="end"
                fontSize={10}
                fill={AXIS}
                className="num"
              >
                {formatTick(t, layout.yt.length > 1 ? layout.yt[1]! - layout.yt[0]! : 1)}
              </text>
            </g>
          ))}
          {layout.xt.map((t) => (
            <text
              key={t}
              x={layout.sx(t)}
              y={height - m.bottom + 13}
              textAnchor="middle"
              fontSize={10}
              fill={AXIS}
              className="num"
            >
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          ))}
          {bars?.map((b) => (
            <rect
              key={b.x}
              x={layout.sx(b.x) - layout.barWidth / 2}
              y={layout.sy(b.y)}
              width={layout.barWidth}
              height={Math.max(0, layout.sy(0) - layout.sy(b.y))}
              fill={b.color}
              rx={1.5}
              opacity={0.85}
            />
          ))}
          {series.map((s) => (
            <g key={s.name}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={1.75}
                strokeDasharray={s.dashed ? '4 3' : undefined}
                points={s.points.map((p) => `${layout.sx(p.x)},${layout.sy(p.y)}`).join(' ')}
              />
              {s.markers &&
                s.points.map((p) => (
                  <circle key={p.x} cx={layout.sx(p.x)} cy={layout.sy(p.y)} r={2.5} fill={s.color} />
                ))}
            </g>
          ))}
          {xLabel && (
            <text
              x={m.left + layout.iw / 2}
              y={height - 4}
              textAnchor="middle"
              fontSize={10.5}
              fill="#9ca9bc"
            >
              {xLabel}
            </text>
          )}
          {yLabel && (
            <text
              transform={`translate(11 ${m.top + layout.ih / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize={10.5}
              fill="#9ca9bc"
            >
              {yLabel}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}

export function Histogram({
  values,
  groups,
  bins = 30,
  height = 150,
  ariaLabel,
  xLabel,
}: {
  values: ArrayLike<number>;
  /** Optional per-value group colours (stacked). */
  groups?: { colorOf: (i: number) => string | null; order: string[] };
  bins?: number;
  height?: number;
  ariaLabel: string;
  xLabel?: string;
}) {
  const { ref, width } = useWidth();
  const m = { top: 8, right: 10, bottom: xLabel ? 32 : 20, left: 40 };
  const data = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min)) return null;
    if (max === min) max = min + 1;
    const counts: Map<string, number>[] = Array.from({ length: bins }, () => new Map());
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      if (!Number.isFinite(v)) continue;
      const b = Math.min(bins - 1, Math.floor(((v - min) / (max - min)) * bins));
      const key = groups?.colorOf(i) ?? '#7C8CFF';
      counts[b]!.set(key, (counts[b]!.get(key) ?? 0) + 1);
    }
    const totals = counts.map((c) => [...c.values()].reduce((s, v) => s + v, 0));
    return { min, max, counts, maxCount: Math.max(...totals, 1) };
  }, [values, bins, groups]);

  return (
    <div ref={ref} className="w-full">
      {data && width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
          {(() => {
            const iw = width - m.left - m.right;
            const ih = height - m.top - m.bottom;
            const bw = iw / bins;
            const sy = (c: number) => (c / data.maxCount) * ih;
            const xt = niceTicks(data.min, data.max, 5);
            const yt = niceTicks(0, data.maxCount, 3);
            return (
              <>
                {yt.map((t) => (
                  <g key={t}>
                    <line
                      x1={m.left}
                      x2={width - m.right}
                      y1={m.top + ih - sy(t)}
                      y2={m.top + ih - sy(t)}
                      stroke={GRID}
                    />
                    <text
                      x={m.left - 6}
                      y={m.top + ih - sy(t) + 3}
                      fontSize={10}
                      textAnchor="end"
                      fill={AXIS}
                      className="num"
                    >
                      {t}
                    </text>
                  </g>
                ))}
                {data.counts.map((c, b) => {
                  let acc = 0;
                  const keys = groups
                    ? [
                        ...groups.order.filter((k) => c.has(k)),
                        ...[...c.keys()].filter((k) => !groups.order.includes(k)),
                      ]
                    : [...c.keys()];
                  return keys.map((k) => {
                    const h = sy(c.get(k)!);
                    const y = m.top + ih - acc - h;
                    acc += h;
                    return (
                      <rect
                        key={`${b}-${k}`}
                        x={m.left + b * bw + 0.5}
                        y={y}
                        width={Math.max(1, bw - 1)}
                        height={h}
                        fill={k}
                        opacity={0.85}
                      />
                    );
                  });
                })}
                {xt.map((t) => (
                  <text
                    key={t}
                    x={m.left + ((t - data.min) / (data.max - data.min)) * iw}
                    y={height - m.bottom + 13}
                    textAnchor="middle"
                    fontSize={10}
                    fill={AXIS}
                    className="num"
                  >
                    {formatTick(t, xt.length > 1 ? xt[1]! - xt[0]! : 1)}
                  </text>
                ))}
                {xLabel && (
                  <text x={m.left + iw / 2} y={height - 4} textAnchor="middle" fontSize={10.5} fill="#9ca9bc">
                    {xLabel}
                  </text>
                )}
              </>
            );
          })()}
        </svg>
      )}
    </div>
  );
}

export function ScatterPlot({
  points,
  height = 200,
  xLabel,
  yLabel,
  ariaLabel,
  color = '#7C8CFF',
  diagonal = false,
}: {
  points: { a: number; b: number }[];
  height?: number;
  xLabel: string;
  yLabel: string;
  ariaLabel: string;
  color?: string;
  diagonal?: boolean;
}) {
  const { ref, width } = useWidth();
  const m = { top: 10, right: 12, bottom: 32, left: 44 };
  const layout = useMemo(() => {
    if (points.length === 0 || width === 0) return null;
    const xmax = Math.max(...points.map((p) => p.a)) || 1;
    const ymax = Math.max(...points.map((p) => p.b)) || 1;
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;
    return {
      xmax,
      ymax,
      iw,
      ih,
      sx: (x: number) => m.left + (x / xmax) * iw,
      sy: (y: number) => m.top + ih - (y / ymax) * ih,
    };
  }, [points, width, height, m.left, m.right, m.top, m.bottom]);
  return (
    <div ref={ref} className="w-full">
      {layout && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
          {niceTicks(0, layout.ymax, 4).map((t) => (
            <g key={`y${t}`}>
              <line x1={m.left} x2={width - m.right} y1={layout.sy(t)} y2={layout.sy(t)} stroke={GRID} />
              <text
                x={m.left - 6}
                y={layout.sy(t) + 3}
                fontSize={10}
                textAnchor="end"
                fill={AXIS}
                className="num"
              >
                {formatTick(t, layout.ymax / 4)}
              </text>
            </g>
          ))}
          {niceTicks(0, layout.xmax, 5).map((t) => (
            <text
              key={`x${t}`}
              x={layout.sx(t)}
              y={height - m.bottom + 13}
              fontSize={10}
              textAnchor="middle"
              fill={AXIS}
              className="num"
            >
              {formatTick(t, layout.xmax / 5)}
            </text>
          ))}
          {diagonal && (
            <line
              x1={layout.sx(0)}
              y1={layout.sy(0)}
              x2={layout.sx(layout.xmax)}
              y2={layout.sy(layout.ymax)}
              stroke="#34425b"
              strokeDasharray="4 3"
            />
          )}
          {points.map((p, i) => (
            <circle key={i} cx={layout.sx(p.a)} cy={layout.sy(p.b)} r={1.6} fill={color} opacity={0.45} />
          ))}
          <text x={m.left + layout.iw / 2} y={height - 4} textAnchor="middle" fontSize={10.5} fill="#9ca9bc">
            {xLabel}
          </text>
          <text
            transform={`translate(11 ${m.top + layout.ih / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={10.5}
            fill="#9ca9bc"
          >
            {yLabel}
          </text>
        </svg>
      )}
    </div>
  );
}
