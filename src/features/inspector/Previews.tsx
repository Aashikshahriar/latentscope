import { useEffect, useRef, useState } from 'react';
import type { Dataset } from '@/types/dataset';

/** Renders feature values as a greyscale image (min–max scaled per observation). */
export function PixelPreview({
  dataset,
  row,
  side,
  size = 112,
}: {
  dataset: Dataset;
  row: number;
  side: number;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const values = dataset.values.subarray(row * dataset.d, (row + 1) * dataset.d);
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    const image = ctx.createImageData(side, side);
    for (let p = 0; p < side * side; p++) {
      const g = Math.round(((values[p]! - min) / span) * 255);
      image.data.set([g, g, g, 255], p * 4);
    }
    ctx.putImageData(image, 0, 0);
  }, [dataset, row, side]);
  return (
    <canvas
      ref={ref}
      width={side}
      height={side}
      className="rounded-md border border-line"
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      role="img"
      aria-label={`Feature values of ${dataset.ids[row]} rendered as a ${side}×${side} image`}
    />
  );
}

/**
 * Image referenced by a metadata URL. The browser fetches it from its host — this is the only
 * place LatentScope makes a network request derived from user data, so it is opt-in per image.
 */
export function UrlImagePreview({ url }: { url: string }) {
  const [show, setShow] = useState(url.startsWith('data:image/'));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setShow(url.startsWith('data:image/'));
    setFailed(false);
  }, [url]);
  const safe = /^(https?:|data:image\/)/i.test(url);
  if (!safe)
    return (
      <p className="text-2xs text-subtle">
        Image path “{url}” is not an http(s) or data URL and cannot be displayed.
      </p>
    );
  if (!show) {
    return (
      <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShow(true)}>
        Load image from {new URL(url, window.location.href).hostname}
      </button>
    );
  }
  if (failed) return <p className="text-2xs text-subtle">The image could not be loaded.</p>;
  return (
    <img
      src={url}
      alt="Observation preview from metadata"
      className="max-h-48 rounded-md border border-line object-contain"
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
    />
  );
}
