import { useRef, useState } from 'react';
import type { SelectionTool } from '@/stores/viewStore';

/**
 * Captures rectangle or lasso gestures over the canvas. Shift adds to the current selection,
 * Alt (Option) subtracts; otherwise the selection is replaced. Escape cancels a gesture.
 */
export function SelectionOverlay({
  tool,
  onComplete,
}: {
  tool: Exclude<SelectionTool, 'navigate'>;
  onComplete: (polygon: number[], mode: 'replace' | 'add' | 'subtract') => void;
}) {
  const [points, setPoints] = useState<number[]>([]);
  const start = useRef<{ x: number; y: number } | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const local = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const rectPolygon = (a: { x: number; y: number }, b: { x: number; y: number }) => [
    a.x,
    a.y,
    b.x,
    a.y,
    b.x,
    b.y,
    a.x,
    b.y,
  ];

  return (
    <svg
      ref={ref}
      className="absolute inset-0 h-full w-full touch-none"
      style={{ cursor: 'crosshair' }}
      aria-label={
        tool === 'lasso'
          ? 'Lasso selection area: drag to draw a freehand region'
          : 'Rectangle selection area: drag to draw a box'
      }
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          start.current = null;
          setPoints([]);
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        const p = local(e);
        start.current = p;
        setPoints([p.x, p.y]);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const p = local(e);
        if (tool === 'rectangle') setPoints(rectPolygon(start.current, p));
        else
          setPoints((prev) => {
            const lx = prev[prev.length - 2]!;
            const ly = prev[prev.length - 1]!;
            return Math.hypot(p.x - lx, p.y - ly) > 3 ? [...prev, p.x, p.y] : prev;
          });
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const mode = e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace';
        const polygon = points;
        start.current = null;
        setPoints([]);
        if (polygon.length >= 6) onComplete(polygon, mode);
      }}
    >
      {points.length >= 4 && (
        <polygon
          points={points.join(' ')}
          fill="rgb(124 140 255 / 0.12)"
          stroke="#7C8CFF"
          strokeWidth={1.5}
          strokeDasharray={tool === 'lasso' ? undefined : '5 4'}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
