import { Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Slider } from '@/components/ui/Form';
import { exactKnn } from '@/algorithms/linalg/knn';
import { fuzzySimplicialSet } from '@/algorithms/umap/fuzzy';
import { initializeUmap, UMAP_DEFAULTS, type UmapRun } from '@/algorithms/umap/umap';
import { neighborhoodMetrics } from '@/algorithms/metrics/neighborhood';
import { createGaussian, createRng } from '@/utils/rng';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { MiniScatter, TutorialShell, type Level, type TutorialStep } from './TutorialShell';
import { domainOf } from './geometry';

const GROUP_COLORS = ['#7C8CFF', '#38D9C5', '#F59E0B'];

const STEPS: TutorialStep[] = [
  {
    title: 'Nearest-neighbour discovery',
    text: {
      beginner: (
        <p>
          Click a point. UMAP starts by finding, for every point, its k closest points. Here the data is
          two-dimensional so you can see the neighbours directly.
        </p>
      ),
      intermediate: (
        <p>
          The neighbourhood size k (n_neighbors) sets the scale UMAP looks at: small k focuses on fine local
          detail, large k on broader structure. For large datasets the search is approximate (NN-descent);
          LatentScope uses exact search up to 4 000 points.
        </p>
      ),
      mathematical: (
        <p>
          For each x_i we compute its k nearest neighbours under the chosen metric. These neighbourhoods are
          treated as local metric spaces, each with its own notion of distance.
        </p>
      ),
    },
  },
  {
    title: 'Neighbourhood graph',
    text: {
      beginner: (
        <p>
          Connecting every point to its neighbours gives a graph — a web that traces the shape of the data:
          the ring, the blob and the line.
        </p>
      ),
      intermediate: (
        <p>
          The k-nearest-neighbour relation is directed: j may be among i’s neighbours without i being among
          j’s. Both directions are drawn faintly here.
        </p>
      ),
      mathematical: (
        <p>
          The union of local neighbourhoods approximates the manifold on which the data are assumed to lie
          (uniformly distributed, with local connectivity).
        </p>
      ),
    },
  },
  {
    title: 'Fuzzy edge weights',
    text: {
      beginner: (
        <p>
          Not all connections are equally strong. The nearest neighbour always gets full strength; farther
          neighbours get weaker connections. Thicker, brighter edges are stronger.
        </p>
      ),
      intermediate: (
        <p>
          Each point gets a distance offset ρ_i (distance to its nearest neighbour) and scale σ_i, chosen so
          the weights of its k edges sum to log₂ k. Directed weights are combined with a fuzzy union:{' '}
          <strong>w_ij + w_ji − w_ij·w_ji</strong>.
        </p>
      ),
      mathematical: (
        <p>
          This is UMAP’s fuzzy simplicial set: a weighted graph whose edge weights are membership strengths.
          The weights here are computed by LatentScope’s implementation, which its tests check against
          umap-learn.
        </p>
      ),
    },
    math: [
      'w_{i\\to j} = \\exp\\!\\left(-\\frac{\\max(0,\\, d(x_i,x_j) - \\rho_i)}{\\sigma_i}\\right),\\quad \\sum_{j} w_{i\\to j} = \\log_2 k',
      '\\bar w_{ij} = w_{i\\to j} + w_{j\\to i} - w_{i\\to j}\\,w_{j\\to i}',
    ],
  },
  {
    title: 'Low-dimensional optimisation',
    text: {
      beginner: (
        <p>
          Press play. Points start at random positions, then strongly connected points pull together while
          random pairs push apart, until the layout reflects the graph.
        </p>
      ),
      intermediate: (
        <p>
          UMAP samples edges in proportion to their weight and applies attractive updates, plus repulsive
          updates for randomly sampled negative pairs. min_dist controls how tightly points may pack.
        </p>
      ),
      mathematical: (
        <p>
          The layout minimises the fuzzy cross-entropy between the high-dimensional weights and
          low-dimensional similarities by stochastic gradient descent with negative sampling (umap-js). a and
          b are fitted from min_dist and spread.
        </p>
      ),
    },
    math: [
      'v_{ij} = \\left(1 + a\\,\\lVert y_i - y_j\\rVert^{2b}\\right)^{-1}',
      '\\mathcal{L} = \\sum_{ij} \\bar w_{ij}\\log\\frac{\\bar w_{ij}}{v_{ij}} + (1-\\bar w_{ij})\\log\\frac{1-\\bar w_{ij}}{1-v_{ij}}',
    ],
  },
  {
    title: 'Final embedding',
    text: {
      beginner: (
        <p>
          The three shapes are laid out as separate groups whose internal neighbourhoods are kept. Like t-SNE,
          the space between groups is not a reliable distance.
        </p>
      ),
      intermediate: (
        <p>
          UMAP tends to retain more global arrangement than t-SNE, but sizes and gaps are still not
          trustworthy. Results depend on n_neighbors, min_dist and the random seed.
        </p>
      ),
      mathematical: (
        <p>
          The theory assumes data uniformly distributed on a Riemannian manifold; departures from that
          assumption (noise, varying density) are absorbed by the per-point normalisation, which is why
          densities are not preserved.
        </p>
      ),
    },
  },
];

function generate() {
  const rng = createRng(12);
  const gauss = createGaussian(rng);
  const pts: { x: number; y: number; g: number }[] = [];
  for (let i = 0; i < 45; i++) {
    const t = (i / 45) * Math.PI * 2;
    pts.push({ x: Math.cos(t) * 2.2 + gauss() * 0.12, y: Math.sin(t) * 2.2 + gauss() * 0.12, g: 0 });
  }
  for (let i = 0; i < 35; i++) pts.push({ x: 5 + gauss() * 0.45, y: 0.5 + gauss() * 0.45, g: 1 });
  for (let i = 0; i < 30; i++) pts.push({ x: -1 + (i / 30) * 7, y: -4 + gauss() * 0.1, g: 2 });
  return pts;
}

export function UmapTutorial({ level }: { level: Level }) {
  const [step, setStep] = useState(0);
  const [k, setK] = useState(8);
  const [minDist, setMinDist] = useState(0.1);
  const [focus, setFocus] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [, setTick] = useState(0);
  const reduced = useReducedMotion();
  const points = useMemo(generate, []);
  const n = points.length;
  const data = useMemo(() => Float64Array.from(points.flatMap((p) => [p.x, p.y])), [points]);

  const graph = useMemo(() => {
    const knn = exactKnn(data, n, 2, k - 1);
    const kPlus = k;
    const indices = new Int32Array(n * kPlus);
    const distances = new Float64Array(n * kPlus);
    for (let i = 0; i < n; i++) {
      indices[i * kPlus] = i;
      for (let t = 0; t < k - 1; t++) {
        indices[i * kPlus + t + 1] = knn.indices[i * (k - 1) + t]!;
        distances[i * kPlus + t + 1] = knn.distances[i * (k - 1) + t]!;
      }
    }
    return { indices, kPlus, fuzzy: fuzzySimplicialSet(indices, distances, n, kPlus) };
  }, [data, n, k]);

  const runRef = useRef<{ run: UmapRun; epoch: number } | null>(null);
  const reset = useCallback(() => {
    runRef.current = {
      run: initializeUmap(data, n, 2, 2, {
        ...UMAP_DEFAULTS,
        nNeighbors: k,
        minDist,
        knn: 'exact',
        nEpochs: 300,
        seed: 5,
      }),
      epoch: 0,
    };
    setPlaying(false);
    setTick((t) => t + 1);
  }, [data, n, k, minDist]);
  useEffect(() => reset(), [reset]);

  const advance = useCallback((epochs: number) => {
    const r = runRef.current;
    if (!r) return;
    for (let e = 0; e < epochs && r.epoch < r.run.nEpochs; e++) {
      r.run.umap.step();
      r.epoch++;
    }
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      advance(reduced ? 50 : 3);
      const r = runRef.current;
      if (!r || r.epoch >= r.run.nEpochs) setPlaying(false);
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, advance, reduced]);

  const neighborsOf = (i: number) =>
    Array.from(graph.indices.subarray(i * graph.kPlus + 1, (i + 1) * graph.kPlus));
  const base = points.map((p, i) => ({
    x: p.x,
    y: p.y,
    color: GROUP_COLORS[p.g]!,
    r: i === focus ? 6 : 3.5,
    opacity: 0.9,
  }));
  const domain = domainOf(points);

  let visual: React.ReactNode;
  if (step <= 2) {
    const edges: { a: number; b: number; opacity: number; width?: number; color?: string }[] = [];
    if (step === 0)
      neighborsOf(focus).forEach((j) =>
        edges.push({ a: focus, b: j, opacity: 0.9, width: 1.6, color: '#F4F7FB' }),
      );
    if (step === 1)
      for (let i = 0; i < n; i++) neighborsOf(i).forEach((j) => edges.push({ a: i, b: j, opacity: 0.22 }));
    if (step === 2) {
      const w = graph.fuzzy.weights;
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++)
          if (w[i * n + j]! > 0.01)
            edges.push({ a: i, b: j, opacity: 0.1 + 0.85 * w[i * n + j]!, width: 0.5 + 2.2 * w[i * n + j]! });
    }
    visual = (
      <div className="space-y-2">
        <MiniScatter
          ariaLabel="UMAP neighbourhood graph on two-dimensional example data"
          domain={domain}
          points={base.map((p, i) => ({ ...p, ring: i === focus }))}
          edges={edges}
          onPick={setFocus}
        />
        {step === 2 && (
          <div className="num space-y-0.5 text-xs text-muted">
            <p>
              point #{focus + 1}: ρ = {graph.fuzzy.rho[focus]!.toFixed(3)}, σ ={' '}
              {graph.fuzzy.sigma[focus]!.toFixed(3)}
            </p>
            <p className="text-subtle">
              outgoing weights:{' '}
              {neighborsOf(focus)
                .map((j) => graph.fuzzy.directed[focus * n + j]!.toFixed(2))
                .join(', ')}{' '}
              (sum{' '}
              {neighborsOf(focus)
                .reduce((s, j) => s + graph.fuzzy.directed[focus * n + j]!, 0)
                .toFixed(3)}{' '}
              ≈ log₂ {k} = {Math.log2(k).toFixed(3)})
            </p>
          </div>
        )}
      </div>
    );
  } else {
    const r = runRef.current;
    const emb = r ? r.run.umap.getEmbedding() : [];
    const embPoints = emb.map((p, i) => ({ x: p[0]!, y: p[1]!, color: GROUP_COLORS[points[i]!.g]!, r: 3.5 }));
    const trust =
      r && r.epoch >= r.run.nEpochs
        ? neighborhoodMetrics(data, 2, Float64Array.from(emb.flat()), 2, n, 5, null).trustworthiness
        : null;
    visual = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            disabled={!r || r.epoch >= r.run.nEpochs}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? 'Pause' : 'Play'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!r || r.epoch >= r.run.nEpochs || playing}
            onClick={() => advance(1000)}
          >
            Run to end
          </Button>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={reset}>
            Reset
          </Button>
          <span className="num ml-auto text-xs text-muted">
            epoch {r?.epoch ?? 0}/{r?.run.nEpochs ?? 0}
          </span>
        </div>
        <MiniScatter
          ariaLabel="UMAP layout during optimisation"
          domain={embPoints.length ? domainOf(embPoints) : [-1, 1, -1, 1]}
          points={embPoints}
        />
        {trust !== null && (
          <p className="text-xs text-muted">
            Trustworthiness (k = 5): <span className="num text-fg">{trust.toFixed(4)}</span> — computed
            against the original 2-D coordinates.
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
        const r = runRef.current;
        if (s === 4 && r && r.epoch < r.run.nEpochs) advance(1000);
      }}
      level={level}
      visual={visual}
      controls={
        <>
          <Slider label="Neighbours (k)" value={k} min={3} max={25} step={1} onChange={setK} />
          <Slider
            label="Minimum distance"
            value={minDist}
            min={0}
            max={0.99}
            step={0.01}
            onChange={setMinDist}
            format={(v) => v.toFixed(2)}
            hint="Affects only the optimisation (steps 4–5)."
          />
          <p className="text-2xs text-subtle">
            110 points: a noisy ring, a Gaussian blob and a line. Click a point to inspect its neighbourhood.
          </p>
        </>
      }
    />
  );
}
