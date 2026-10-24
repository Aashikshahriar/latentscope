import { describe, expect, it } from 'vitest';
import { fuzzySimplicialSet } from '@/algorithms/umap/fuzzy';
import { initializeUmap, UMAP_DEFAULTS, validateUmapParams } from '@/algorithms/umap/umap';
import { neighborhoodMetrics } from '@/algorithms/metrics/neighborhood';
import { flatten, loadFixture, maxAbsDiff } from './helpers';

const f = loadFixture<{
  x: number[][];
  n: number;
  nNeighbors: number;
  knnIndices: number[][];
  knnDistances: number[][];
  weights: number[][];
  sigmas: number[];
  rhos: number[];
}>('umap');

describe('UMAP fuzzy simplicial set against umap-learn', () => {
  it('matches ρ, σ and the symmetrised membership weights', () => {
    const g = fuzzySimplicialSet(
      Int32Array.from(f.knnIndices.flat()),
      Float64Array.from(f.knnDistances.flat()),
      f.n,
      f.nNeighbors,
    );
    expect(maxAbsDiff(g.rho, f.rhos)).toBeLessThan(1e-6);
    expect(maxAbsDiff(g.sigma, f.sigmas)).toBeLessThan(1e-4);
    expect(maxAbsDiff(g.weights, flatten(f.weights))).toBeLessThan(1e-4);
  });
});

function run(seed: number, dims: 2 | 3, knn: 'exact' | 'approximate') {
  const x = flatten(f.x);
  const { umap, nEpochs, knnMethod } = initializeUmap(x, f.n, 3, dims, {
    ...UMAP_DEFAULTS,
    nNeighbors: 8,
    seed,
    knn,
    nEpochs: 200,
  });
  for (let e = 0; e < nEpochs; e++) umap.step();
  return { y: umap.getEmbedding(), knnMethod };
}

describe('UMAP (umap-js) behaviour', () => {
  for (const dims of [2, 3] as const) {
    it(`${dims}D output has the right shape, finite values and preserves neighbourhoods`, () => {
      const { y, knnMethod } = run(1, dims, 'exact');
      expect(knnMethod).toBe('exact');
      expect(y.length).toBe(f.n);
      expect(y.every((row) => row.length === dims && row.every(Number.isFinite))).toBe(true);
      const t = neighborhoodMetrics(flatten(f.x), 3, flatten(y), dims, f.n, 5, null).trustworthiness;
      expect(t).toBeGreaterThan(0.85);
    });
  }

  it('is reproducible for a fixed seed (exact and approximate neighbours)', () => {
    expect(run(9, 2, 'exact').y).toEqual(run(9, 2, 'exact').y);
    expect(run(9, 2, 'approximate').y).toEqual(run(9, 2, 'approximate').y);
    expect(run(9, 2, 'exact').y).not.toEqual(run(10, 2, 'exact').y);
  });

  it('validates parameter ranges', () => {
    expect(validateUmapParams({ ...UMAP_DEFAULTS, nNeighbors: 1 }, 100).errors.length).toBe(1);
    expect(validateUmapParams({ ...UMAP_DEFAULTS, nNeighbors: 100 }, 100).errors.length).toBe(1);
    expect(validateUmapParams({ ...UMAP_DEFAULTS, minDist: 2, spread: 1 }, 100).errors.length).toBe(1);
    expect(validateUmapParams({ ...UMAP_DEFAULTS, minDist: -1 }, 100).errors.length).toBe(1);
    expect(validateUmapParams({ ...UMAP_DEFAULTS, nEpochs: 1.5 }, 100).errors.length).toBe(1);
    expect(validateUmapParams({ ...UMAP_DEFAULTS, nNeighbors: 60 }, 100).warnings.length).toBe(1);
    expect(validateUmapParams(UMAP_DEFAULTS, 100)).toEqual({ errors: [], warnings: [] });
  });
});
