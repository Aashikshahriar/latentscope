import { useMemo, useState } from 'react';
import { MathTex } from '@/components/common/MathTex';
import { Slider } from '@/components/ui/Form';
import { Button } from '@/components/ui/Button';
import { HorizontalBars } from '@/components/charts/Charts';
import { pcaCentered } from '@/algorithms/pca/pca';
import { createGaussian, createRng } from '@/utils/rng';
import { formatPercent } from '@/utils/format';
import { MiniScatter, TutorialShell, type Level, type TutorialStep } from './TutorialShell';

const STEPS: TutorialStep[] = [
  {
    title: 'Original data',
    text: {
      beginner: (
        <p>
          Each dot is one observation described by two measurements. The cloud is stretched along a diagonal:
          when one measurement is large, the other tends to be large too.
        </p>
      ),
      intermediate: (
        <p>
          We have N observations x₁…x_N in ℝ². The points are correlated, so a single well-chosen direction
          captures most of how they differ. The white cross marks the mean.
        </p>
      ),
      mathematical: (
        <p>
          Data matrix <MathTex tex="X \in \mathbb{R}^{N\times D}" /> with D = 2 and column mean μ. PCA seeks
          an orthonormal basis ordered by the variance of the data along each basis vector.
        </p>
      ),
    },
    math: [
      'X = \\begin{bmatrix} x_1^\\top \\\\ \\vdots \\\\ x_N^\\top \\end{bmatrix}, \\qquad \\mu = \\tfrac{1}{N}\\textstyle\\sum_i x_i',
    ],
  },
  {
    title: 'Centering',
    text: {
      beginner: (
        <p>
          We slide the whole cloud so its centre sits at the origin. Its shape does not change — only its
          position.
        </p>
      ),
      intermediate: (
        <p>
          Subtracting the mean removes location from the problem: variance is measured around the centre, and
          principal directions pass through it.
        </p>
      ),
      mathematical: (
        <p>
          All subsequent quantities use the centred matrix. Without centring, the first "component" would
          largely point at the mean rather than along the spread.
        </p>
      ),
    },
    math: ['X_c = X - \\mathbf{1}\\mu^\\top'],
  },
  {
    title: 'Covariance structure',
    text: {
      beginner: (
        <p>
          The ellipse summarises the cloud’s shape: how spread out it is in each direction and how strongly
          the two measurements move together.
        </p>
      ),
      intermediate: (
        <p>
          The covariance matrix holds each variable’s variance on the diagonal and their covariance off the
          diagonal. The ellipse is the set of points at Mahalanobis distance 2 from the mean.
        </p>
      ),
      mathematical: (
        <p>
          The sample covariance is symmetric positive semi-definite, so it has real non-negative eigenvalues
          and orthogonal eigenvectors. The values on the right are computed from the current data.
        </p>
      ),
    },
    math: ['C = \\frac{1}{N-1} X_c^\\top X_c'],
  },
  {
    title: 'Principal directions',
    text: {
      beginner: (
        <p>
          The arrows show the two most important directions: the first along which the points are most spread,
          the second perpendicular to it.
        </p>
      ),
      intermediate: (
        <p>
          The principal directions are eigenvectors of C, scaled here by the standard deviation along each
          (√λ). Try the angle slider: no other direction captures more variance than PC1.
        </p>
      ),
      mathematical: (
        <p>
          Equivalently, from the singular value decomposition X_c = UΣVᵀ, the columns of V are the principal
          directions and λ_i = σ_i² / (N − 1). LatentScope computes PCA through the SVD for numerical
          stability.
        </p>
      ),
    },
    math: [
      'C\\,w_i = \\lambda_i w_i,\\quad \\lambda_1 \\ge \\lambda_2 \\ge 0',
      'w_1 = \\arg\\max_{\\lVert w\\rVert = 1} \\; w^\\top C\\, w',
    ],
  },
  {
    title: 'Projection',
    text: {
      beginner: (
        <p>
          Each point drops perpendicularly onto the first arrow. Reading positions along that line turns two
          numbers per observation into one.
        </p>
      ),
      intermediate: (
        <p>
          The projection keeps each point’s coordinate along PC1 and discards the perpendicular part (the
          residual). Distances along PC1 are preserved exactly; distances perpendicular to it are lost.
        </p>
      ),
      mathematical: (
        <p>
          Keeping k components gives scores Z = X_c W_k. The orthogonal projection minimises the total squared
          reconstruction error among all rank-k linear projections (Eckart–Young).
        </p>
      ),
    },
    math: ['Z = X_c W_k, \\qquad \\hat X_c = Z W_k^\\top = X_c W_k W_k^\\top'],
  },
  {
    title: 'Explained variance',
    text: {
      beginner: (
        <p>
          The bars show how much of the total spread each direction captures. If the first bar is large, one
          number per point describes the data well.
        </p>
      ),
      intermediate: (
        <p>
          The explained variance ratio of component i is its eigenvalue divided by the total variance. A scree
          plot of these ratios guides how many components to keep.
        </p>
      ),
      mathematical: (
        <p>
          Total variance equals the trace of C, i.e. the sum of all eigenvalues, so the ratios sum to one.
          They describe variance, not class separation or any downstream usefulness.
        </p>
      ),
    },
    math: [
      '\\mathrm{EVR}_i = \\frac{\\lambda_i}{\\sum_j \\lambda_j} = \\frac{\\lambda_i}{\\operatorname{tr}(C)}',
    ],
  },
];

function generate(correlation: number, seed: number) {
  const gauss = createGaussian(createRng(seed));
  const sx = 1.6;
  const sy = 0.9;
  const pts: [number, number][] = [];
  for (let i = 0; i < 140; i++) {
    const z1 = gauss();
    const z2 = gauss();
    pts.push([3 + sx * z1, 2 + sy * (correlation * z1 + Math.sqrt(1 - correlation ** 2) * z2)]);
  }
  return pts;
}

export function PcaTutorial({ level }: { level: Level }) {
  const [step, setStep] = useState(0);
  const [correlation, setCorrelation] = useState(0.8);
  const [seed, setSeed] = useState(1);
  const [angle, setAngle] = useState<number | null>(null);
  const raw = useMemo(() => generate(correlation, seed), [correlation, seed]);
  const pca = useMemo(() => {
    const n = raw.length;
    const mean = [raw.reduce((s, p) => s + p[0], 0) / n, raw.reduce((s, p) => s + p[1], 0) / n] as const;
    const xc = new Float64Array(n * 2);
    raw.forEach((p, i) => {
      xc[i * 2] = p[0] - mean[0];
      xc[i * 2 + 1] = p[1] - mean[1];
    });
    let cxx = 0;
    let cyy = 0;
    let cxy = 0;
    for (let i = 0; i < n; i++) {
      cxx += xc[i * 2]! ** 2;
      cyy += xc[i * 2 + 1]! ** 2;
      cxy += xc[i * 2]! * xc[i * 2 + 1]!;
    }
    const cov = [cxx / (n - 1), cxy / (n - 1), cyy / (n - 1)] as const;
    const { scores, diagnostics } = pcaCentered(xc, n, 2, { outputDims: 2, maxComponents: 2 });
    return {
      mean,
      xc,
      cov,
      scores,
      w: diagnostics.components,
      lambda: diagnostics.explainedVariance,
      ratio: diagnostics.explainedVarianceRatio,
    };
  }, [raw]);

  const centred = step >= 1;
  const pts = raw.map((p, i) =>
    centred ? { x: pca.xc[i * 2]!, y: pca.xc[i * 2 + 1]! } : { x: p[0], y: p[1] },
  );
  const w1 = pca.w[0]!;
  const w2 = pca.w[1]!;
  const custom =
    angle === null ? null : [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
  const customVar = custom
    ? custom[0]! ** 2 * pca.cov[0] + 2 * custom[0]! * custom[1]! * pca.cov[1] + custom[1]! ** 2 * pca.cov[2]
    : null;
  const domain: [number, number, number, number] = [-5, 8, -5, 8];

  const visual = (
    <div className="space-y-3">
      <MiniScatter
        ariaLabel="PCA tutorial scatter plot"
        domain={centred ? [-5.5, 5.5, -5.5, 5.5] : domain}
        points={pts.map((p) => ({ ...p, color: '#9CA9BC', r: 3.2, opacity: step === 4 ? 0.35 : 0.85 }))}
        lines={
          step === 4
            ? pts.map((p) => {
                const t = p.x * w1[0]! + p.y * w1[1]!;
                return { x1: p.x, y1: p.y, x2: t * w1[0]!, y2: t * w1[1]!, color: '#38D9C5', opacity: 0.35 };
              })
            : centred
              ? [
                  { x1: -6, y1: 0, x2: 6, y2: 0, color: '#34425b' },
                  { x1: 0, y1: -6, x2: 0, y2: 6, color: '#34425b' },
                ]
              : []
        }
        arrows={
          step >= 3
            ? [
                {
                  x1: 0,
                  y1: 0,
                  x2: w1[0]! * Math.sqrt(pca.lambda[0]!) * 2,
                  y2: w1[1]! * Math.sqrt(pca.lambda[0]!) * 2,
                  color: '#7C8CFF',
                  label: 'PC1',
                },
                ...(step === 3
                  ? [
                      {
                        x1: 0,
                        y1: 0,
                        x2: w2[0]! * Math.sqrt(pca.lambda[1]!) * 2,
                        y2: w2[1]! * Math.sqrt(pca.lambda[1]!) * 2,
                        color: '#C084FC',
                        label: 'PC2',
                      },
                    ]
                  : []),
                ...(custom && step === 3
                  ? [
                      {
                        x1: 0,
                        y1: 0,
                        x2: custom[0]! * 3.5,
                        y2: custom[1]! * 3.5,
                        color: '#F59E0B',
                        label: `${angle}°`,
                      },
                    ]
                  : []),
              ]
            : []
        }
      >
        {(sx, sy) => (
          <>
            {step === 0 && (
              <g stroke="#F4F7FB" strokeWidth={2}>
                <line
                  x1={sx(pca.mean[0]) - 7}
                  x2={sx(pca.mean[0]) + 7}
                  y1={sy(pca.mean[1])}
                  y2={sy(pca.mean[1])}
                />
                <line
                  y1={sy(pca.mean[1]) - 7}
                  y2={sy(pca.mean[1]) + 7}
                  x1={sx(pca.mean[0])}
                  x2={sx(pca.mean[0])}
                />
              </g>
            )}
            {step === 2 && (
              <ellipse
                cx={sx(0)}
                cy={sy(0)}
                rx={Math.sqrt(pca.lambda[0]!) * 2 * (sx(1) - sx(0))}
                ry={Math.sqrt(pca.lambda[1]!) * 2 * (sx(1) - sx(0))}
                transform={`rotate(${(-Math.atan2(w1[1]!, w1[0]!) * 180) / Math.PI} ${sx(0)} ${sy(0)})`}
                fill="rgb(124 140 255 / 0.08)"
                stroke="#7C8CFF"
                strokeDasharray="6 4"
              />
            )}
            {step === 4 &&
              pts.map((p, i) => {
                const t = p.x * w1[0]! + p.y * w1[1]!;
                return <circle key={i} cx={sx(t * w1[0]!)} cy={sy(t * w1[1]!)} r={3} fill="#38D9C5" />;
              })}
          </>
        )}
      </MiniScatter>
      {step === 2 && (
        <div className="rounded-lg border border-line bg-card px-4 py-2 text-fg">
          <MathTex
            display
            tex={`C = \\begin{bmatrix} ${pca.cov[0].toFixed(3)} & ${pca.cov[1].toFixed(3)} \\\\ ${pca.cov[1].toFixed(3)} & ${pca.cov[2].toFixed(3)} \\end{bmatrix}`}
          />
        </div>
      )}
      {step === 3 && (
        <p className="num text-xs text-muted">
          λ₁ = {pca.lambda[0]!.toFixed(3)}, λ₂ = {pca.lambda[1]!.toFixed(3)} · w₁ = ({w1[0]!.toFixed(3)},{' '}
          {w1[1]!.toFixed(3)})
          {customVar !== null && (
            <span className="text-warning">
              {' '}
              · variance along {angle}° = {customVar.toFixed(3)} ≤ λ₁
            </span>
          )}
        </p>
      )}
      {step === 4 && (
        <svg
          viewBox="0 0 420 40"
          className="w-full rounded-lg border border-line bg-surface"
          role="img"
          aria-label="Projected one-dimensional values"
        >
          <line x1={10} x2={410} y1={20} y2={20} stroke="#34425b" />
          {Array.from({ length: raw.length }, (_, i) => (
            <circle key={i} cx={210 + pca.scores[i * 2]! * 38} cy={20} r={3} fill="#38D9C5" opacity={0.6} />
          ))}
        </svg>
      )}
      {step === 5 && (
        <div className="rounded-lg border border-line bg-card p-4">
          <HorizontalBars
            ariaLabel="Explained variance ratio"
            data={pca.ratio.map((r, i) => ({
              label: `PC${i + 1}`,
              value: r,
              color: i === 0 ? '#7C8CFF' : '#C084FC',
            }))}
            format={(v) => formatPercent(v)}
          />
        </div>
      )}
    </div>
  );

  return (
    <TutorialShell
      steps={STEPS}
      step={step}
      setStep={setStep}
      level={level}
      visual={visual}
      controls={
        <>
          <Slider
            label="Correlation between the two measurements"
            value={correlation}
            min={-0.95}
            max={0.95}
            step={0.05}
            onChange={setCorrelation}
            format={(v) => v.toFixed(2)}
          />
          {step === 3 && (
            <Slider
              label="Compare a custom direction"
              value={angle ?? 0}
              min={-90}
              max={90}
              step={1}
              onChange={setAngle}
              format={(v) => `${v}°`}
              hint="The orange arrow shows a direction of your choice; its variance never exceeds λ₁."
            />
          )}
          <Button size="sm" variant="secondary" onClick={() => setSeed((s) => s + 1)}>
            New random sample
          </Button>
        </>
      }
    />
  );
}
