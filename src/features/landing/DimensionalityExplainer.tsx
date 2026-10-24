import { useMemo, useState } from 'react';
import { MathTex } from '@/components/common/MathTex';
import { Slider } from '@/components/ui/Form';
import { LineChart } from '@/components/charts/Charts';
import { createGaussian, createRng } from '@/utils/rng';
import { formatPercent } from '@/utils/format';

/** A correlated 2-D sample (seeded) used to show that projection direction controls retained variance. */
function sample() {
  const gauss = createGaussian(createRng(17));
  const pts: [number, number][] = [];
  for (let i = 0; i < 160; i++) {
    const a = gauss() * 1.6;
    const b = gauss() * 0.45;
    const angle = 0.55;
    pts.push([a * Math.cos(angle) - b * Math.sin(angle), a * Math.sin(angle) + b * Math.cos(angle)]);
  }
  return pts;
}

function ProjectionDemo() {
  const points = useMemo(sample, []);
  const [angleDeg, setAngleDeg] = useState(0);
  const stats = useMemo(() => {
    const n = points.length;
    const mx = points.reduce((s, p) => s + p[0], 0) / n;
    const my = points.reduce((s, p) => s + p[1], 0) / n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const [x, y] of points) {
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
      sxy += (x - mx) * (y - my);
    }
    const total = (sxx + syy) / (n - 1);
    const best = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
    return { mx, my, sxx: sxx / (n - 1), syy: syy / (n - 1), sxy: sxy / (n - 1), total, best };
  }, [points]);
  const theta = (angleDeg * Math.PI) / 180;
  const u: [number, number] = [Math.cos(theta), Math.sin(theta)];
  const retained =
    (u[0] ** 2 * stats.sxx + u[1] ** 2 * stats.syy + 2 * u[0] * u[1] * stats.sxy) / stats.total;
  const size = 260;
  const scale = size / 9;
  const sx = (x: number) => size / 2 + x * scale;
  const sy = (y: number) => size / 2 - y * scale;
  return (
    <div className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto rounded-xl border border-line bg-surface"
        role="img"
        aria-label={`Points projected onto a line at ${angleDeg.toFixed(0)} degrees, retaining ${formatPercent(retained)} of the variance`}
      >
        <line
          x1={sx(-u[0] * 6)}
          y1={sy(-u[1] * 6)}
          x2={sx(u[0] * 6)}
          y2={sy(u[1] * 6)}
          stroke="#7C8CFF"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        {points.map(([x, y], i) => {
          const t = (x - stats.mx) * u[0] + (y - stats.my) * u[1];
          const px = stats.mx + t * u[0];
          const py = stats.my + t * u[1];
          return (
            <g key={i}>
              <line x1={sx(x)} y1={sy(y)} x2={sx(px)} y2={sy(py)} stroke="#38D9C5" strokeOpacity={0.15} />
              <circle cx={sx(x)} cy={sy(y)} r={2.3} fill="#9CA9BC" opacity={0.75} />
              <circle cx={sx(px)} cy={sy(py)} r={2} fill="#38D9C5" />
            </g>
          );
        })}
      </svg>
      <div className="space-y-4">
        <Slider
          label="Projection direction"
          value={angleDeg}
          min={-90}
          max={90}
          step={1}
          onChange={setAngleDeg}
          format={(v) => `${v.toFixed(0)}°`}
        />
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted">Variance retained by this 1-D projection</span>
            <span className="num text-fg">{formatPercent(retained)}</span>
          </div>
          <div className="h-2 rounded-full bg-line">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-teal"
              style={{ width: `${retained * 100}%` }}
            />
          </div>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          Projecting onto a line keeps the spread along that line and discards the rest. The direction that
          keeps the most — here about <span className="num text-fg">{stats.best.toFixed(0)}°</span> — is the
          first principal component.{' '}
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => setAngleDeg(Math.round(stats.best))}
          >
            Snap to it
          </button>
          .
        </p>
      </div>
    </div>
  );
}

/** Relative contrast (d_max − d_min) / d_min of distances from one point, for uniform random data. */
function ConcentrationDemo() {
  const series = useMemo(() => {
    const rng = createRng(5);
    const dims = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
    return dims.map((d) => {
      const n = 200;
      const pts = Array.from({ length: n }, () => Array.from({ length: d }, () => rng()));
      let contrast = 0;
      for (let q = 0; q < 10; q++) {
        let min = Infinity;
        let max = 0;
        for (let j = 0; j < n; j++) {
          if (j === q) continue;
          let s = 0;
          for (let t = 0; t < d; t++) s += (pts[q]![t]! - pts[j]![t]!) ** 2;
          const dist = Math.sqrt(s);
          min = Math.min(min, dist);
          max = Math.max(max, dist);
        }
        contrast += (max - min) / min;
      }
      return { x: Math.log2(d), y: contrast / 10 };
    });
  }, []);
  return (
    <div className="space-y-3">
      <LineChart
        series={[{ name: 'contrast', color: '#C084FC', points: series, markers: true }]}
        xLabel="log₂(dimensions)"
        yLabel="relative contrast"
        ariaLabel="Distance contrast shrinks as dimensionality grows"
        height={180}
      />
      <p className="text-sm leading-relaxed text-muted">
        Computed live for 200 uniformly random points: as dimensionality grows, the nearest and farthest
        neighbours become almost equally far away, <MathTex tex="\tfrac{d_{\max}-d_{\min}}{d_{\min}} \to 0" />
        . Geometry in hundreds of dimensions is unintuitive — projections give us a window into it, at the
        cost of distortion.
      </p>
    </div>
  );
}

export function DimensionalityExplainer() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-line bg-card p-6 shadow-panel">
        <h3 className="text-base font-semibold text-fg">Projections choose what to keep</h3>
        <p className="mt-1 mb-5 text-sm text-muted">
          Every 2-D view of high-dimensional data discards information. Linear methods like PCA keep the
          directions of greatest variance.
        </p>
        <ProjectionDemo />
      </div>
      <div className="rounded-2xl border border-line bg-card p-6 shadow-panel">
        <h3 className="text-base font-semibold text-fg">Why we cannot just look</h3>
        <p className="mt-1 mb-5 text-sm text-muted">
          Model embeddings live in 128 to 4 096 dimensions, where intuitions about distance break down.
        </p>
        <ConcentrationDemo />
      </div>
    </div>
  );
}
