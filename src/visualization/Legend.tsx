import type { LegendPosition } from '@/stores/viewStore';
import { formatNumber } from '@/utils/format';
import type { ColorMapping } from './common/colorMapping';
import { MARKER_SHAPES, sequentialGradientCss, type SequentialPaletteId } from './common/palettes';
import { cn } from '@/utils/misc';

const POSITION: Record<Exclude<LegendPosition, 'hidden'>, string> = {
  'top-right': 'top-3 right-3',
  'top-left': 'top-3 left-3',
  'bottom-right': 'bottom-10 right-3',
  'bottom-left': 'bottom-10 left-3',
};

export function MarkerGlyph({ shape, color, size = 10 }: { shape: number; color: string; size?: number }) {
  const s = size;
  const h = s / 2;
  const name = MARKER_SHAPES[shape] ?? 'circle';
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden className="shrink-0">
      {name === 'circle' && <circle cx={h} cy={h} r={h * 0.9} fill={color} />}
      {name === 'square' && (
        <rect x={s * 0.08} y={s * 0.08} width={s * 0.84} height={s * 0.84} fill={color} />
      )}
      {name === 'triangle' && (
        <polygon points={`${h},${s * 0.06} ${s * 0.95},${s * 0.92} ${s * 0.05},${s * 0.92}`} fill={color} />
      )}
      {name === 'diamond' && <polygon points={`${h},0 ${s},${h} ${h},${s} 0,${h}`} fill={color} />}
      {name === 'cross' && (
        <g fill={color}>
          <rect x={h - s * 0.15} y={0} width={s * 0.3} height={s} />
          <rect x={0} y={h - s * 0.15} width={s} height={s * 0.3} />
        </g>
      )}
      {name === 'ring' && (
        <circle cx={h} cy={h} r={h * 0.68} fill="none" stroke={color} strokeWidth={s * 0.22} />
      )}
    </svg>
  );
}

export function Legend({
  mapping,
  position,
  hidden,
  onToggle,
  onSolo,
  shapes,
  sequentialPalette,
  maxItems = 14,
}: {
  mapping: ColorMapping;
  position: LegendPosition;
  hidden: string[];
  onToggle?: (key: string) => void;
  onSolo?: (key: string) => void;
  shapes: boolean;
  sequentialPalette: SequentialPaletteId;
  maxItems?: number;
}) {
  if (position === 'hidden' || mapping.mode === 'uniform') return null;
  return (
    <div
      className={cn(
        'glass absolute z-10 max-w-[13rem] rounded-lg border border-line/80 px-3 py-2 shadow-panel',
        POSITION[position],
      )}
    >
      <p
        className="mb-1.5 truncate text-2xs font-semibold tracking-wide text-muted uppercase"
        title={mapping.title}
      >
        {mapping.title}
      </p>
      {mapping.mode === 'numeric' && mapping.numericRange && (
        <div className="w-36">
          <div className="h-2 rounded-sm" style={{ background: sequentialGradientCss(sequentialPalette) }} />
          <div className="num mt-1 flex justify-between text-2xs text-subtle">
            <span>{formatNumber(mapping.numericRange[0])}</span>
            <span>{formatNumber(mapping.numericRange[1])}</span>
          </div>
        </div>
      )}
      {mapping.mode === 'categorical' && (
        <ul className="scroll-thin max-h-60 space-y-px overflow-y-auto">
          {mapping.categories.slice(0, maxItems).map((c) => {
            const off = hidden.includes(c.key);
            return (
              <li key={c.key}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-white/5 disabled:cursor-default"
                  onClick={() => onToggle?.(c.key)}
                  onDoubleClick={() => onSolo?.(c.key)}
                  disabled={!onToggle}
                  aria-pressed={onToggle ? !off : undefined}
                  title={onToggle ? 'Click to hide/show · double-click to isolate' : undefined}
                >
                  <span style={{ opacity: off ? 0.3 : 1 }} className="flex">
                    {shapes ? (
                      <MarkerGlyph shape={c.shape} color={c.color} />
                    ) : (
                      <span className="size-2.5 rounded-full" style={{ background: c.color }} />
                    )}
                  </span>
                  <span className={cn('truncate', off ? 'text-subtle line-through' : 'text-fg/90')}>
                    {c.label}
                  </span>
                </button>
              </li>
            );
          })}
          {mapping.categories.length > maxItems && (
            <li className="px-1 text-2xs text-subtle">
              + {mapping.categories.length - maxItems} more (see sidebar)
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
