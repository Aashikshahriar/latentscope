import { useEffect, useRef } from 'react';
import { sequentialColor } from '@/visualization/common/palettes';

/** Square matrix heatmap drawn on a canvas; values are square-root scaled to reveal small entries. */
export function Heatmap({
  values,
  n,
  highlightRow,
  label,
  size = 200,
}: {
  values: Float64Array;
  n: number;
  highlightRow?: number | null;
  label: string;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let max = 0;
    for (let t = 0; t < n * n; t++) if (values[t]! > max) max = values[t]!;
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = max > 0 ? Math.sqrt(values[i * n + j]! / max) : 0;
        const [r, g, b] = sequentialColor('magma', v);
        const dim = highlightRow !== undefined && highlightRow !== null && i !== highlightRow ? 0.55 : 1;
        img.data.set([r * 255 * dim, g * 255 * dim, b * 255 * dim, 255], (i * n + j) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [values, n, highlightRow]);
  return (
    <figure className="space-y-1">
      <canvas
        ref={ref}
        width={n}
        height={n}
        style={{ width: size, height: size, imageRendering: 'pixelated' }}
        className="rounded-md border border-line"
        role="img"
        aria-label={label}
      />
      <figcaption className="text-2xs text-subtle">{label}</figcaption>
    </figure>
  );
}
