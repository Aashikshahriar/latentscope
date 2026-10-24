import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Feedback';
import { Slider } from '@/components/ui/Form';
import { LineChart } from '@/components/charts/Charts';
import { conditionalRow } from '@/algorithms/tsne/affinities';
import { TSNE, TSNE_DEFAULTS } from '@/algorithms/tsne/tsne';
import { neighborhoodMetrics } from '@/algorithms/metrics/neighborhood';
import { centerColumns } from '@/algorithms/linalg/matrix';
import { pcaCentered } from '@/algorithms/pca/pca';
import { createGaussian, createRng } from '@/utils/rng';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { Heatmap } from './Heatmap';
import { MiniScatter, TutorialShell, type Level, type TutorialStep } from './TutorialShell';
import { domainOf } from './geometry';

const COLORS = ['#7C8CFF', '#38D9C5', '#C084FC', '#F59E0B'];
const N_PER = 20;
const D = 5;

const STEPS: TutorialStep[] = [
  {
    title: 'High-dimensional similarities',
    text: {
      beginner: (
        <p>
          The data has five measurements per point, shown here through its two main PCA directions. Click any
          point: the others grow and brighten in proportion to how “similar” t-SNE considers them. Nearby
          points get most of the similarity.
        </p>
      ),
      intermediate: (
        <p>
          Each point i gets a Gaussian neighbourhood of width σ_i. σ_i is tuned per point so that the
          neighbourhood has the chosen <strong>perplexity</strong> — roughly, the effective number of
          neighbours. Dense regions get small σ, sparse regions large σ.
        </p>
      ),
      mathematical: (
        <p>
          The conditional distribution over neighbours of i is a normalised Gaussian kernel. σ_i is found by
          bisection so that the Shannon entropy H(P_i) equals log(perplexity) — exactly as scikit-learn does,
          which LatentScope’s tests verify.
        </p>
      ),
    },
    math: [
      'p_{j|i} = \\frac{\\exp(-\\lVert x_i - x_j\\rVert^2 / 2\\sigma_i^2)}{\\sum_{k\\ne i}\\exp(-\\lVert x_i - x_k\\rVert^2 / 2\\sigma_i^2)}',
      '2^{H(P_i)} \\approx \\mathrm{Perp},\\quad H(P_i) = -\\textstyle\\sum_j p_{j|i}\\log_2 p_{j|i}',
    ],
  },
  {
    title: 'Probability distributions',
    text: {
      beginner: (
        <p>
          All the similarities form a table: row i, column j says how similar j is to i. Points are sorted by
          group, so the bright blocks on the diagonal are the groups.
        </p>
      ),
      intermediate: (
        <p>
          The conditional probabilities are symmetrised into one joint distribution P over all pairs.
          Symmetrising ensures outliers still contribute to the cost.
        </p>
      ),
      mathematical: (
        <p>
          P is symmetric with zero diagonal and sums to one. The heatmap is square-root scaled so that small
          probabilities remain visible.
        </p>
      ),
    },
    math: ['p_{ij} = \\frac{p_{j|i} + p_{i|j}}{2N}'],
  },
  {
    title: 'Initial low-dimensional positions',
    text: {
      beginner: (
        <p>
          t-SNE starts by placing every point at a random spot very close to the centre. These positions mean
          nothing yet.
        </p>
      ),
      intermediate: (
        <p>
          Here the initial map y is drawn from N(0, 10⁻⁴ I) with a fixed seed, so the run is reproducible. In
          the Explorer, PCA initialisation is the default because it preserves more of the global layout.
        </p>
      ),
      mathematical: (
        <p>
          Low-dimensional similarities use a heavy-tailed Student-t kernel with one degree of freedom. The
          heavy tail lets moderately distant points be placed far apart, alleviating the crowding problem.
        </p>
      ),
    },
    math: [
      'q_{ij} = \\frac{(1 + \\lVert y_i - y_j\\rVert^2)^{-1}}{\\sum_{k\\ne l}(1 + \\lVert y_k - y_l\\rVert^2)^{-1}}',
    ],
  },
  {
    title: 'Optimisation',
    text: {
      beginner: (
        <p>
          Press play. Points that should be neighbours attract, all others repel, until the map’s similarities
          resemble the original ones. The curve shows the mismatch shrinking.
        </p>
      ),
      intermediate: (
        <p>
          Gradient descent minimises the Kullback–Leibler divergence between P and Q. For the first 250
          iterations P is multiplied by 12 (<strong>early exaggeration</strong>), which forms well-separated
          clusters early. Momentum and adaptive gains speed up convergence.
        </p>
      ),
      mathematical: (
        <p>
          The gradient has an attractive term from P and a repulsive term from Q. Exact gradients cost O(N²)
          per iteration; the Explorer switches to the Barnes–Hut approximation (O(N log N)) above 1 500
          points.
        </p>
      ),
    },
    math: [
      'C = \\mathrm{KL}(P\\,\\Vert\\,Q) = \\sum_{i\\ne j} p_{ij}\\log\\frac{p_{ij}}{q_{ij}}',
      '\\frac{\\partial C}{\\partial y_i} = 4\\sum_j (p_{ij} - q_{ij})(y_i - y_j)(1 + \\lVert y_i - y_j\\rVert^2)^{-1}',
    ],
  },
  {
    title: 'Final embedding',
    text: {
      beginner: (
        <p>
          The groups are cleanly separated and points that were neighbours remain neighbours. But the
          distances between groups and the sizes of groups in this picture are not meaningful.
        </p>
      ),
      intermediate: (
        <p>
          t-SNE preserves <strong>local</strong> neighbourhoods (see the trustworthiness score). It does not
          preserve global distances or densities, and different seeds or perplexities can change the layout.
          Never read cluster separation in a t-SNE map as proof of separation in the data.
        </p>
      ),
      mathematical: (
        <p>
          Because KL(P‖Q) heavily penalises placing close pairs far apart but only weakly penalises placing
          distant pairs close, the objective is asymmetric: it is local by construction. Coordinates have no
          units.
        </p>
      ),
    },
  },
];

function generate(seed: number) {
  const gauss = createGaussian(createRng(seed));
  const centres = Array.from({ length: 4 }, () => Array.from({ length: D }, () => gauss() * 4));
  const spreads = [0.6, 1.0, 1.6, 0.8];
  const x = new Float64Array(4 * N_PER * D);
  for (let c = 0; c < 4; c++) {
    for (let j = 0; j < N_PER; j++)
      for (let t = 0; t < D; t++) x[(c * N_PER + j) * D + t] = centres[c]![t]! + gauss() * spreads[c]!;
  }
  const centred = Float64Array.from(x);
  centerColumns(centred, 4 * N_PER, D);
  const view = pcaCentered(centred, 4 * N_PER, D, { outputDims: 2 }).scores;
  return { x, view, n: 4 * N_PER };
}

export function TsneTutorial({ level }: { level: Level }) {
  const [step, setStep] = useState(0);
  const [perplexity, setPerplexity] = useState(10);
  const [seed] = useState(3);
  const [focus, setFocus] = useState(0);
  const [, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();
  const data = useMemo(() => generate(seed), [seed]);
  const n = data.n;
  const tsneRef = useRef<TSNE | null>(null);
  const historyRef = useRef<{ x: number; y: number }[]>([]);

  const reset = useCallback(() => {
    tsneRef.current = new TSNE(data.x, n, D, 2, {
      ...TSNE_DEFAULTS,
      perplexity,
      init: 'random',
      method: 'exact',
      iterations: 750,
      pcaDims: 0,
      seed: 7,
    });
    historyRef.current = [];
    setPlaying(false);
    setTick((t) => t + 1);
  }, [data, n, perplexity]);

  useEffect(() => reset(), [reset]);

  const advance = useCallback((iterations: number) => {
    const t = tsneRef.current;
    if (!t) return;
    for (let k = 0; k < iterations && !t.done; k++) {
      const record = t.iteration % 10 === 9;
      const kl = t.step(record);
      if (record && kl !== null) historyRef.current.push({ x: t.iteration, y: kl });
    }
    setTick((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      advance(reduced ? 50 : 4);
      if (tsneRef.current?.done) setPlaying(false);
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, advance, reduced]);

  // Conditional probabilities of the focused point, and its bandwidth.
  const conditional = useMemo(() => {
    const dist = new Float64Array(n - 1);
    const out = new Float64Array(n - 1);
    let c = 0;
    for (let j = 0; j < n; j++) {
      if (j === focus) continue;
      let s = 0;
      for (let t = 0; t < D; t++) s += (data.x[focus * D + t]! - data.x[j * D + t]!) ** 2;
      dist[c++] = s;
    }
    const { beta, perplexity: achieved } = conditionalRow(dist, 0, n - 1, perplexity, out, 0);
    const full = new Float64Array(n);
    c = 0;
    for (let j = 0; j < n; j++) if (j !== focus) full[j] = out[c++]!;
    return { p: full, sigma: Math.sqrt(1 / (2 * beta)), achieved };
  }, [data, n, focus, perplexity]);

  const tsne = tsneRef.current;
  const y = tsne?.y;
  const P = tsne?.joint ?? null;
  const Q = useMemo(() => {
    if (!y) return null;
    const q = new Float64Array(n * n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const v = 1 / (1 + (y[i * 2]! - y[j * 2]!) ** 2 + (y[i * 2 + 1]! - y[j * 2 + 1]!) ** 2);
        q[i * n + j] = v;
        sum += v;
      }
    }
    for (let t = 0; t < q.length; t++) q[t]! /= sum;
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y, n, tsne?.iteration]);

  const viewPoints = Array.from({ length: n }, (_, i) => ({
    x: data.view[i * 2]!,
    y: data.view[i * 2 + 1]!,
  }));
  const maxP = Math.max(...conditional.p);
  const embedPoints = y ? Array.from({ length: n }, (_, i) => ({ x: y[i * 2]!, y: y[i * 2 + 1]! })) : [];
  const trust = tsne?.done && y ? neighborhoodMetrics(data.x, D, y, 2, n, 5, null).trustworthiness : null;

  let visual: React.ReactNode;
  if (step === 0) {
    visual = (
      <div className="space-y-2">
        <MiniScatter
          ariaLabel="Five-dimensional data viewed through its first two principal components; point sizes show similarity to the selected point"
          domain={domainOf(viewPoints)}
          onPick={setFocus}
          points={viewPoints.map((p, i) => ({
            ...p,
            color: i === focus ? '#F4F7FB' : COLORS[Math.floor(i / N_PER)]!,
            r: i === focus ? 6 : 2.5 + 9 * Math.sqrt(conditional.p[i]! / (maxP || 1)),
            opacity: i === focus ? 1 : 0.25 + 0.75 * Math.sqrt(conditional.p[i]! / (maxP || 1)),
          }))}
        />
        <p className="num text-xs text-muted">
          point #{focus + 1}: σ = {conditional.sigma.toFixed(3)} · achieved perplexity{' '}
          {conditional.achieved.toFixed(2)} (target {perplexity})
        </p>
      </div>
    );
  } else if (step === 1) {
    visual = P ? (
      <div className="flex flex-wrap items-start gap-4">
        <Heatmap
          values={P}
          n={n}
          highlightRow={focus}
          label={`Joint probabilities P (${n}×${n}), √-scaled; row of point #${focus + 1} highlighted`}
          size={300}
        />
      </div>
    ) : null;
  } else {
    visual = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            disabled={!tsne || tsne.done}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? 'Pause' : 'Play'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<SkipForward className="size-3.5" />}
            disabled={!tsne || tsne.done || playing}
            onClick={() => advance(25)}
          >
            +25 iterations
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!tsne || tsne.done || playing}
            onClick={() => advance(1000)}
          >
            Run to end
          </Button>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={reset}>
            Reset
          </Button>
          <span className="num ml-auto text-xs text-muted">
            iteration {tsne?.iteration ?? 0}/{tsne?.totalIterations ?? 0}
          </span>
          {tsne && (
            <Badge tone={tsne.phase === 'exaggeration' ? 'warning' : 'teal'}>
              {tsne.phase === 'exaggeration' ? 'early exaggeration' : 'refinement'}
            </Badge>
          )}
        </div>
        <MiniScatter
          ariaLabel="t-SNE embedding during optimisation"
          domain={embedPoints.length ? domainOf(embedPoints) : [-1, 1, -1, 1]}
          points={embedPoints.map((p, i) => ({
            ...p,
            color: COLORS[Math.floor(i / N_PER)]!,
            r: i === focus ? 5.5 : 3.5,
            ring: i === focus,
          }))}
        />
        {step >= 3 && P && Q && (
          <div className="flex flex-wrap gap-4">
            <Heatmap values={P} n={n} label="Target P (high-dimensional)" size={150} />
            <Heatmap values={Q} n={n} label="Current Q (map)" size={150} />
            <div className="min-w-48 flex-1">
              {historyRef.current.length > 1 && (
                <LineChart
                  series={[{ name: 'KL', color: '#38D9C5', points: historyRef.current }]}
                  height={150}
                  xLabel="iteration"
                  yLabel="KL(P‖Q)"
                  ariaLabel="KL divergence over iterations"
                />
              )}
            </div>
          </div>
        )}
        {step === 4 && trust !== null && (
          <p className="text-xs text-muted">
            Trustworthiness (k = 5) of this map: <span className="num text-fg">{trust.toFixed(4)}</span> (1
            would mean no false neighbours).
          </p>
        )}
      </div>
    );
  }

  return (
    <TutorialShell
      steps={STEPS}
      step={step}
      setStep={(s) => {
        setStep(s);
        if (s === 4 && tsneRef.current && !tsneRef.current.done) advance(1000);
      }}
      level={level}
      visual={visual}
      controls={
        <>
          <Slider
            label="Perplexity"
            value={perplexity}
            min={2}
            max={40}
            step={1}
            onChange={setPerplexity}
            hint="Changing perplexity rebuilds P and restarts the optimisation."
          />
          <p className="text-2xs text-subtle">
            80 points in 5 dimensions, four groups with different spreads. Click points in step 1 to change
            the reference point.
          </p>
        </>
      }
    />
  );
}
