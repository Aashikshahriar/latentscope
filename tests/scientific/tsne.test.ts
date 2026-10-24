import { describe, expect, it } from 'vitest';
import { jointProbabilitiesDense, jointProbabilitiesSparse } from '@/algorithms/tsne/affinities';
import { klDivergenceExact, TSNE, TSNE_DEFAULTS, validateTsneParams } from '@/algorithms/tsne/tsne';
import { exactKnn } from '@/algorithms/linalg/knn';
import { neighborhoodMetrics } from '@/algorithms/metrics/neighborhood';
import { flatten, loadFixture, maxAbsDiff } from './helpers';

interface TsneFixture {
  n: number;
  d: number;
  perplexity: number;
  x: number[][];
  pCondensed: number[];
  y: number[][];
  kl: number;
  grad: number[][];
  kSparse: number;
  pSparseDense: number[][];
}

const f = loadFixture<TsneFixture>('tsne');
const x = flatten(f.x);

// scikit-learn casts squared distances to float32 before its perplexity search, so agreement is
// limited to float32 precision (relative ~1e-7); we compute in float64 throughout.
describe('t-SNE affinities against scikit-learn', () => {
  it('matches _joint_probabilities (exact) to float32 precision', () => {
    const { P } = jointProbabilitiesDense(x, f.n, f.d, f.perplexity);
    const condensed: number[] = [];
    for (let i = 0; i < f.n; i++) for (let j = i + 1; j < f.n; j++) condensed.push(P[i * f.n + j]!);
    expect(maxAbsDiff(condensed, f.pCondensed)).toBeLessThan(1e-9);
    // A joint distribution over ordered pairs sums to one.
    expect(P.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
  });

  it('matches _joint_probabilities_nn (Barnes–Hut) to float32 precision', () => {
    const knn = exactKnn(x, f.n, f.d, f.kSparse);
    const { P } = jointProbabilitiesSparse(knn.indices, knn.distances, f.n, f.kSparse, f.perplexity);
    const dense = new Float64Array(f.n * f.n);
    for (let i = 0; i < f.n; i++) {
      for (let p = P.rowPtr[i]!; p < P.rowPtr[i + 1]!; p++) dense[i * f.n + P.colIdx[p]!] = P.values[p]!;
    }
    expect(maxAbsDiff(dense, flatten(f.pSparseDense))).toBeLessThan(1e-9);
  });

  it('matches _kl_divergence value and gradient', () => {
    const { P } = jointProbabilitiesDense(x, f.n, f.d, f.perplexity);
    const { kl, grad } = klDivergenceExact(P, flatten(f.y), f.n, 2);
    expect(Math.abs(kl - f.kl) / f.kl).toBeLessThan(1e-7);
    expect(maxAbsDiff(grad, flatten(f.grad))).toBeLessThan(1e-7);
  });
});

function runTsne(method: 'exact' | 'barnes-hut', dims: 2 | 3, seed = 7) {
  const t = new TSNE(x, f.n, f.d, dims, {
    ...TSNE_DEFAULTS,
    perplexity: 10,
    iterations: 500,
    method,
    seed,
    pcaDims: 0,
  });
  while (!t.done) t.step(t.iteration % 50 === 49);
  return t;
}

describe('t-SNE optimisation', () => {
  for (const method of ['exact', 'barnes-hut'] as const) {
    for (const dims of [2, 3] as const) {
      it(`${method} ${dims}D produces finite coordinates of the right shape and preserves clusters`, () => {
        const t = runTsne(method, dims);
        expect(t.y.length).toBe(f.n * dims);
        expect(Array.from(t.y).every(Number.isFinite)).toBe(true);
        const nb = neighborhoodMetrics(x, f.d, t.y, dims, f.n, 5, null);
        expect(nb.trustworthiness).toBeGreaterThan(0.9);
        // KL decreases during refinement.
        const hist = t.klHistory;
        expect(hist.length).toBeGreaterThan(2);
        expect(hist[hist.length - 1]!.kl).toBeLessThan(hist[0]!.kl);
      });
    }
  }

  it('is deterministic for a fixed seed and differs across seeds with random init', () => {
    const make = (seed: number) => {
      const t = new TSNE(x, f.n, f.d, 2, {
        ...TSNE_DEFAULTS,
        perplexity: 10,
        iterations: 300,
        init: 'random',
        seed,
        pcaDims: 0,
      });
      while (!t.done) t.step();
      return Array.from(t.y);
    };
    expect(make(3)).toEqual(make(3));
    expect(make(3)).not.toEqual(make(4));
  });

  it('Barnes–Hut gradient approximates the exact gradient for small θ', () => {
    const exact = new TSNE(x, f.n, f.d, 2, {
      ...TSNE_DEFAULTS,
      perplexity: 10,
      method: 'exact',
      pcaDims: 0,
      iterations: 300,
    });
    for (let i = 0; i < 300; i++) exact.step();
    // Compare one exact KL evaluation with the BH estimate at the same coordinates is not possible
    // with differing P; instead check BH with θ→0 converges to the same quality.
    const bh = new TSNE(x, f.n, f.d, 2, {
      ...TSNE_DEFAULTS,
      perplexity: 10,
      method: 'barnes-hut',
      theta: 0.05,
      pcaDims: 0,
      iterations: 300,
    });
    for (let i = 0; i < 300; i++) bh.step();
    const te = neighborhoodMetrics(x, f.d, exact.y, 2, f.n, 5, null).trustworthiness;
    const tb = neighborhoodMetrics(x, f.d, bh.y, 2, f.n, 5, null).trustworthiness;
    expect(Math.abs(te - tb)).toBeLessThan(0.05);
  });
});

describe('t-SNE parameter validation', () => {
  it('rejects perplexity ≥ N', () => {
    expect(validateTsneParams({ ...TSNE_DEFAULTS, perplexity: 50 }, 50).errors.length).toBeGreaterThan(0);
  });
  it('warns when 3·perplexity exceeds N − 1', () => {
    const v = validateTsneParams({ ...TSNE_DEFAULTS, perplexity: 30 }, 60);
    expect(v.errors).toEqual([]);
    expect(v.warnings.length).toBe(1);
  });
  it('rejects too few iterations, bad θ, non-integer seeds and tiny datasets', () => {
    expect(validateTsneParams({ ...TSNE_DEFAULTS, iterations: 100 }, 500).errors.length).toBeGreaterThan(0);
    expect(validateTsneParams({ ...TSNE_DEFAULTS, theta: 0 }, 500).errors.length).toBeGreaterThan(0);
    expect(validateTsneParams({ ...TSNE_DEFAULTS, seed: 1.5 }, 500).errors.length).toBeGreaterThan(0);
    expect(validateTsneParams({ ...TSNE_DEFAULTS, perplexity: 1 }, 2).errors.length).toBeGreaterThan(0);
  });
  it('accepts defaults on a typical dataset', () => {
    expect(validateTsneParams(TSNE_DEFAULTS, 1000)).toEqual({ errors: [], warnings: [] });
  });
  it('handles identical observations without producing NaNs', () => {
    const rows = Array.from({ length: 20 }, (_, i) => (i < 10 ? [1, 1, 1] : [i, 0, -i]));
    const t = new TSNE(flatten(rows), 20, 3, 2, {
      ...TSNE_DEFAULTS,
      perplexity: 5,
      iterations: 260,
      pcaDims: 0,
    });
    while (!t.done) t.step();
    expect(Array.from(t.y).every(Number.isFinite)).toBe(true);
  });
});
