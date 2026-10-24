import { useMemo } from 'react';
import type { OrthographicCamera } from 'three';
import { formatTick, niceTicks, type NormalizedPositions } from '../common/geometry';

/**
 * SVG axes and grid for the 2D view, labelled in the projection's own units. Rendered as two
 * layers: the grid sits behind the (transparent) WebGL canvas and the axes in front of it.
 */
export function Axes2D({
  camera,
  normalized,
  size,
  version,
  layer,
  titles,
  compact,
}: {
  camera: OrthographicCamera;
  normalized: NormalizedPositions;
  size: { width: number; height: number };
  version: number;
  layer: 'grid' | 'axes';
  titles: [string, string, string];
  compact?: boolean;
}) {
  const { width, height } = size;
  const geometry = useMemo(() => {
    void version;
    if (width === 0 || height === 0) return null;
    const toData = (v: number, k: 0 | 1) => v * normalized.scale + normalized.center[k];
    const xmin = toData(camera.position.x + camera.left / camera.zoom, 0);
    const xmax = toData(camera.position.x + camera.right / camera.zoom, 0);
    const ymin = toData(camera.position.y + camera.bottom / camera.zoom, 1);
    const ymax = toData(camera.position.y + camera.top / camera.zoom, 1);
    const target = compact ? 4 : Math.max(3, Math.round(width / 110));
    const xt = niceTicks(xmin, xmax, target);
    const yt = niceTicks(ymin, ymax, compact ? 4 : Math.max(3, Math.round(height / 90)));
    const sx = (v: number) => ((v - xmin) / (xmax - xmin)) * width;
    const sy = (v: number) => height - ((v - ymin) / (ymax - ymin)) * height;
    const stepX = xt.length > 1 ? xt[1]! - xt[0]! : 1;
    const stepY = yt.length > 1 ? yt[1]! - yt[0]! : 1;
    return {
      x: xt.map((v) => ({ v, p: sx(v), label: formatTick(v, stepX) })),
      y: yt.map((v) => ({ v, p: sy(v), label: formatTick(v, stepY) })),
      origin: { x: xmin <= 0 && xmax >= 0 ? sx(0) : null, y: ymin <= 0 && ymax >= 0 ? sy(0) : null },
    };
  }, [camera, normalized, width, height, version, compact]);

  if (!geometry) return null;
  if (layer === 'grid') {
    return (
      <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
        {geometry.x.map((t) => (
          <line key={`gx${t.v}`} x1={t.p} x2={t.p} y1={0} y2={height} stroke="#273246" strokeOpacity={0.45} />
        ))}
        {geometry.y.map((t) => (
          <line key={`gy${t.v}`} y1={t.p} y2={t.p} x1={0} x2={width} stroke="#273246" strokeOpacity={0.45} />
        ))}
        {geometry.origin.x !== null && (
          <line
            x1={geometry.origin.x}
            x2={geometry.origin.x}
            y1={0}
            y2={height}
            stroke="#34425b"
            strokeOpacity={0.9}
          />
        )}
        {geometry.origin.y !== null && (
          <line
            y1={geometry.origin.y}
            y2={geometry.origin.y}
            x1={0}
            x2={width}
            stroke="#34425b"
            strokeOpacity={0.9}
          />
        )}
      </svg>
    );
  }
  return (
    <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
      <g className="num" fontSize={10} fill="#7d8aa0">
        {geometry.x.map((t) =>
          t.p > 28 && t.p < width - 16 ? (
            <text key={`tx${t.v}`} x={t.p} y={height - 6} textAnchor="middle">
              {t.label}
            </text>
          ) : null,
        )}
        {geometry.y.map((t) =>
          t.p > 12 && t.p < height - 22 ? (
            <text key={`ty${t.v}`} x={6} y={t.p + 3}>
              {t.label}
            </text>
          ) : null,
        )}
      </g>
      {!compact && (
        <g fontSize={11} fill="#9ca9bc" fontWeight={500}>
          <text x={width - 12} y={height - 20} textAnchor="end">
            {titles[0]} →
          </text>
          <text transform={`translate(${46} ${height - 44}) rotate(-90)`} textAnchor="start">
            {titles[1]} →
          </text>
        </g>
      )}
    </svg>
  );
}
