import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { MathTex } from '@/components/common/MathTex';
import { cn } from '@/utils/misc';

export type Level = 'beginner' | 'intermediate' | 'mathematical';

export interface TutorialStep {
  title: string;
  /** Text per level; mathematical text may include display formulas via `math`. */
  text: Record<Level, ReactNode>;
  math?: string[];
}

export function TutorialShell({
  steps,
  step,
  setStep,
  level,
  visual,
  controls,
}: {
  steps: TutorialStep[];
  step: number;
  setStep: (s: number) => void;
  level: Level;
  visual: ReactNode;
  controls?: ReactNode;
}) {
  const current = steps[step]!;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <ol className="flex flex-wrap gap-1.5" aria-label="Tutorial steps">
          {steps.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={i === step ? 'step' : undefined}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  i === step
                    ? 'border-accent/60 bg-accent/15 text-fg'
                    : i < step
                      ? 'border-teal/30 text-teal'
                      : 'border-line text-subtle hover:text-fg',
                )}
              >
                {i + 1}. {s.title}
              </button>
            </li>
          ))}
        </ol>
        <article className="rounded-xl border border-line bg-card p-5" aria-live="polite">
          <p className="text-2xs font-medium tracking-wide text-accent uppercase">
            Step {step + 1} of {steps.length}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-fg">{current.title}</h3>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted [&_strong]:text-fg">
            {current.text[level]}
          </div>
          {level !== 'beginner' && current.math && (
            <div className="mt-3 space-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-fg">
              {current.math.map((m) => (
                <MathTex key={m} tex={m} display />
              ))}
            </div>
          )}
          <div className="mt-5 flex justify-between">
            <Button
              variant="ghost"
              size="sm"
              icon={<ChevronLeft className="size-4" />}
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              Previous
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={step === steps.length - 1}
              onClick={() => setStep(step + 1)}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </article>
        {controls && <div className="space-y-3 rounded-xl border border-line bg-card p-4">{controls}</div>}
      </div>
      <div className="min-w-0">{visual}</div>
    </div>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  color: string;
  r?: number;
  opacity?: number;
  ring?: boolean;
}

/** Small SVG scatter with optional edges, arrows and overlays, in data coordinates. */
export function MiniScatter({
  points,
  edges = [],
  arrows = [],
  lines = [],
  domain,
  size = 420,
  ariaLabel,
  onPick,
  children,
}: {
  points: ScatterPoint[];
  edges?: { a: number; b: number; opacity: number; color?: string; width?: number }[];
  arrows?: { x1: number; y1: number; x2: number; y2: number; color: string; label?: string }[];
  lines?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    dashed?: boolean;
    opacity?: number;
  }[];
  domain: [number, number, number, number];
  size?: number;
  ariaLabel: string;
  onPick?: (index: number) => void;
  children?: (sx: (x: number) => number, sy: (y: number) => number) => ReactNode;
}) {
  const [xmin, xmax, ymin, ymax] = domain;
  const span = Math.max(xmax - xmin, ymax - ymin);
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  const sx = (x: number) => ((x - (cx - span / 2)) / span) * size;
  const sy = (y: number) => size - ((y - (cy - span / 2)) / span) * size;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="w-full rounded-xl border border-line bg-surface"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
        </marker>
      </defs>
      {lines.map((l, i) => (
        <line
          key={`l${i}`}
          x1={sx(l.x1)}
          y1={sy(l.y1)}
          x2={sx(l.x2)}
          y2={sy(l.y2)}
          stroke={l.color}
          strokeOpacity={l.opacity ?? 0.6}
          strokeDasharray={l.dashed ? '5 4' : undefined}
        />
      ))}
      {edges.map((e, i) => (
        <line
          key={`e${i}`}
          x1={sx(points[e.a]!.x)}
          y1={sy(points[e.a]!.y)}
          x2={sx(points[e.b]!.x)}
          y2={sy(points[e.b]!.y)}
          stroke={e.color ?? '#7C8CFF'}
          strokeOpacity={e.opacity}
          strokeWidth={e.width ?? 1.2}
        />
      ))}
      {children?.(sx, sy)}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={sx(p.x)}
          cy={sy(p.y)}
          r={p.r ?? 4}
          fill={p.ring ? 'none' : p.color}
          stroke={p.ring ? p.color : undefined}
          strokeWidth={p.ring ? 2 : undefined}
          opacity={p.opacity ?? 0.9}
          onClick={onPick ? () => onPick(i) : undefined}
          className={onPick ? 'cursor-pointer' : undefined}
        />
      ))}
      {arrows.map((a, i) => (
        <g key={`a${i}`}>
          <line
            x1={sx(a.x1)}
            y1={sy(a.y1)}
            x2={sx(a.x2)}
            y2={sy(a.y2)}
            stroke={a.color}
            strokeWidth={2.5}
            markerEnd="url(#arrowhead)"
          />
          {a.label && (
            <text x={sx(a.x2) + 6} y={sy(a.y2) - 6} fill={a.color} fontSize={13} fontWeight={600}>
              {a.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
