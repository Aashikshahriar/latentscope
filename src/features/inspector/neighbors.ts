import type { DistanceMetric, PreprocessingConfig } from '@/types/algorithms';
import type { Dataset } from '@/types/dataset';
import { KSmallest } from '@/algorithms/linalg/knn';

/**
 * Per-row and per-feature scale factors that reproduce the preprocessing pipeline's geometry
 * without materialising a transformed copy of the matrix:
 *   x̃_it = ((x_it / r_i) − μ_t) / s_t,   where r_i is the row norm (L2 option) and s_t the
 * feature standard deviation (standardise option). Centring (μ) cancels in all distances.
 */
export interface FeatureGeometry {
  rowScale: Float64Array | null;
  featureScale: Float64Array | null;
}

export function featureGeometry(dataset: Dataset, preprocessing: PreprocessingConfig): FeatureGeometry {
  const { n, d, values } = dataset;
  let rowScale: Float64Array | null = null;
  if (preprocessing.l2Normalize) {
    rowScale = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let t = 0; t < d; t++) s += values[i * d + t]! ** 2;
      rowScale[i] = s > 0 ? 1 / Math.sqrt(s) : 1;
    }
  }
  let featureScale: Float64Array | null = null;
  if (preprocessing.standardize && n > 1) {
    const mean = new Float64Array(d);
    const sq = new Float64Array(d);
    for (let i = 0; i < n; i++) {
      const r = rowScale ? rowScale[i]! : 1;
      for (let t = 0; t < d; t++) mean[t]! += values[i * d + t]! * r;
    }
    for (let t = 0; t < d; t++) mean[t]! /= n;
    for (let i = 0; i < n; i++) {
      const r = rowScale ? rowScale[i]! : 1;
      for (let t = 0; t < d; t++) sq[t]! += (values[i * d + t]! * r - mean[t]!) ** 2;
    }
    featureScale = new Float64Array(d);
    for (let t = 0; t < d; t++) {
      const sd = Math.sqrt(sq[t]! / (n - 1));
      featureScale[t] = sd > 0 ? 1 / sd : 1;
    }
  }
  return { rowScale, featureScale };
}

export interface Neighbor {
  row: number;
  distance: number;
}

/** k nearest neighbours of `row` in the preprocessed feature space, restricted to `candidates` if given. */
export function featureNeighbors(
  dataset: Dataset,
  geometry: FeatureGeometry,
  row: number,
  k: number,
  metric: DistanceMetric,
  candidates: Uint32Array | null,
): Neighbor[] {
  const { n, d, values } = dataset;
  const { rowScale, featureScale } = geometry;
  const query = new Float64Array(d);
  const ri = rowScale ? rowScale[row]! : 1;
  for (let t = 0; t < d; t++) query[t] = values[row * d + t]! * ri * (featureScale ? featureScale[t]! : 1);
  let qNorm = 0;
  if (metric === 'cosine') for (let t = 0; t < d; t++) qNorm += query[t]! * query[t]!;
  const heap = new KSmallest(Math.min(k, (candidates ? candidates.length : n) - 1));
  if (heap.k <= 0) return [];
  const count = candidates ? candidates.length : n;
  for (let c = 0; c < count; c++) {
    const j = candidates ? candidates[c]! : c;
    if (j === row) continue;
    const rj = rowScale ? rowScale[j]! : 1;
    let dist: number;
    if (metric === 'cosine') {
      let dot = 0;
      let nj = 0;
      for (let t = 0; t < d; t++) {
        const v = values[j * d + t]! * rj * (featureScale ? featureScale[t]! : 1);
        dot += v * query[t]!;
        nj += v * v;
      }
      dist = qNorm === 0 || nj === 0 ? 1 : 1 - dot / Math.sqrt(qNorm * nj);
    } else {
      let s = 0;
      for (let t = 0; t < d; t++) {
        const v = values[j * d + t]! * rj * (featureScale ? featureScale[t]! : 1) - query[t]!;
        s += v * v;
      }
      dist = Math.sqrt(s);
    }
    heap.push(dist, j);
  }
  const idx = new Int32Array(heap.size);
  const dist = new Float64Array(heap.size);
  heap.drainSorted(idx, dist, 0);
  return Array.from(idx, (r, t) => ({ row: r, distance: dist[t]! }));
}

/** k nearest neighbours of a dataset row in a projection (Euclidean in projection units). */
export function projectionNeighbors(
  coords: Float32Array,
  dims: number,
  rowIndices: Uint32Array | null,
  row: number,
  k: number,
): Neighbor[] {
  const count = coords.length / dims;
  let self = row;
  if (rowIndices) {
    self = -1;
    for (let r = 0; r < count; r++) if (rowIndices[r] === row) self = r;
    if (self < 0) return [];
  }
  const heap = new KSmallest(Math.min(k, count - 1));
  if (heap.k <= 0) return [];
  for (let r = 0; r < count; r++) {
    if (r === self) continue;
    let s = 0;
    for (let t = 0; t < dims; t++) s += (coords[r * dims + t]! - coords[self * dims + t]!) ** 2;
    heap.push(Math.sqrt(s), r);
  }
  const idx = new Int32Array(heap.size);
  const dist = new Float64Array(heap.size);
  heap.drainSorted(idx, dist, 0);
  return Array.from(idx, (r, t) => ({ row: rowIndices ? rowIndices[r]! : r, distance: dist[t]! }));
}
