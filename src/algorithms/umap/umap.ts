import { UMAP } from 'umap-js';
import type { UmapParams } from '@/types/algorithms';
import { createRng } from '@/utils/rng';
import { exactKnn } from '../linalg/knn';

/**
 * UMAP via umap-js (https://github.com/PAIR-code/umap-js), a port of McInnes et al.'s umap-learn.
 *
 * Known differences from Python umap-learn, documented rather than hidden:
 *  - Initialisation is uniform random in [−10, 10] (umap-learn defaults to spectral).
 *  - Approximate neighbours use NN-descent with random-projection trees; for N ≤ 4 000 we inject
 *    exact brute-force neighbours (umap-js `setPrecomputedKNN`), which removes that source of
 *    variation.
 *  - All randomness is drawn from the seeded generator passed as `random`, so runs are
 *    reproducible within umap-js, but coordinates are not expected to match umap-learn.
 */
export const UMAP_IMPLEMENTATION = { name: 'umap-js', version: '1.4.0' } as const;

export const UMAP_DEFAULTS: UmapParams = {
  algorithm: 'umap',
  nNeighbors: 15,
  minDist: 0.1,
  spread: 1,
  metric: 'euclidean',
  nEpochs: 0,
  knn: 'auto',
  seed: 42,
};

export const UMAP_EXACT_KNN_LIMIT = 4000;

export function validateUmapParams(params: UmapParams, n: number): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Number.isInteger(params.nNeighbors) || params.nNeighbors < 2)
    errors.push('Number of neighbours must be an integer ≥ 2.');
  else if (params.nNeighbors >= n) {
    errors.push(
      `Number of neighbours (${params.nNeighbors}) must be smaller than the number of observations (${n}).`,
    );
  } else if (params.nNeighbors > n / 2) {
    warnings.push(
      'A neighbourhood larger than half the dataset makes UMAP emphasise global structure almost exclusively.',
    );
  }
  if (!(params.spread > 0)) errors.push('Spread must be positive.');
  if (!(params.minDist >= 0)) errors.push('Minimum distance must be non-negative.');
  else if (params.minDist > params.spread) errors.push('Minimum distance must not exceed spread.');
  if (!Number.isInteger(params.nEpochs) || params.nEpochs < 0)
    errors.push('Epochs must be a non-negative integer (0 = automatic).');
  if (!Number.isInteger(params.seed)) errors.push('The random seed must be an integer.');
  if (params.knn === 'exact' && n > 20000)
    errors.push('Exact neighbours are limited to 20 000 observations; use approximate.');
  return { errors, warnings };
}

export interface UmapRun {
  umap: UMAP;
  nEpochs: number;
  knnMethod: 'exact' | 'nn-descent';
}

function toRows(data: Float64Array, n: number, d: number): number[][] {
  const rows: number[][] = new Array(n);
  for (let i = 0; i < n; i++) rows[i] = Array.from(data.subarray(i * d, (i + 1) * d));
  return rows;
}

/** Builds the fuzzy graph and initial layout. The caller drives optimisation via `umap.step()`. */
export function initializeUmap(
  data: Float64Array,
  n: number,
  d: number,
  dims: 2 | 3,
  params: UmapParams,
  onStage?: (stage: string, fraction: number | null) => void,
): UmapRun {
  const validation = validateUmapParams(params, n);
  if (validation.errors.length > 0) throw new RangeError(validation.errors.join(' '));

  const umap = new UMAP({
    nComponents: dims,
    nNeighbors: params.nNeighbors,
    minDist: params.minDist,
    spread: params.spread,
    nEpochs: params.nEpochs,
    random: createRng(params.seed),
    distanceFn: params.metric === 'cosine' ? cosineDistance : euclideanDistance,
  });

  const useExact = params.knn === 'exact' || (params.knn === 'auto' && n <= UMAP_EXACT_KNN_LIMIT);
  if (useExact) {
    const k = params.nNeighbors - 1;
    onStage?.('Finding exact nearest neighbours', 0);
    const knn = exactKnn(data, n, d, k, {
      metric: params.metric,
      onProgress: (f) => onStage?.('Finding exact nearest neighbours', f),
    });
    // umap-js (like umap-learn) expects each list to start with the point itself at distance 0.
    const indices: number[][] = new Array(n);
    const distances: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      indices[i] = [i, ...Array.from(knn.indices.subarray(i * k, (i + 1) * k))];
      distances[i] = [0, ...Array.from(knn.distances.subarray(i * k, (i + 1) * k))];
    }
    umap.setPrecomputedKNN(indices, distances);
  }
  onStage?.(useExact ? 'Building fuzzy simplicial set' : 'NN-descent and fuzzy simplicial set', null);
  const nEpochs = umap.initializeFit(toRows(data, n, d));
  return { umap, nEpochs, knnMethod: useExact ? 'exact' : 'nn-descent' };
}

function euclideanDistance(x: number[], y: number[]): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    const diff = x[i]! - y[i]!;
    s += diff * diff;
  }
  return Math.sqrt(s);
}

function cosineDistance(x: number[], y: number[]): number {
  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i]! * y[i]!;
    nx += x[i]! * x[i]!;
    ny += y[i]! * y[i]!;
  }
  if (nx === 0 && ny === 0) return 0;
  if (nx === 0 || ny === 0) return 1;
  return 1 - dot / Math.sqrt(nx * ny);
}

export function embeddingToFloat32(rows: number[][], dims: number): Float32Array {
  const out = new Float32Array(rows.length * dims);
  for (let i = 0; i < rows.length; i++) for (let k = 0; k < dims; k++) out[i * dims + k] = rows[i]![k]!;
  return out;
}
