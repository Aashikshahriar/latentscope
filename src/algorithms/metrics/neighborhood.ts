import { KSmallest } from '../linalg/knn';

/**
 * Rank-based neighbourhood metrics between an original space X and an embedding Z.
 *
 * Ranks r(i, j) are 1-based positions of j in the ordering of all points by distance from i
 * (i itself excluded), with ties broken by index for determinism. N_k(i) is the set of the k
 * nearest neighbours.
 *
 * Trustworthiness (Venna & Kaski, 2001), as implemented in scikit-learn:
 *   T(k) = 1 − 2 / (m k (2N − 3k − 1)) · Σ_i Σ_{j ∈ N_k^Z(i) \ N_k^X(i)} (r_X(i, j) − k)
 * penalises points that appear close in the embedding but were not close originally.
 *
 * Continuity swaps the roles of X and Z and penalises original neighbours that were torn apart.
 *
 * Neighbourhood preservation: NP_k = (1/m) Σ_i |N_k^X(i) ∩ N_k^Z(i)| / k.
 *
 * With m = N (all query points) these are exact. When m < N, query points are a seeded random
 * subsample but ranks are still computed against all N points, so each term is exact and the
 * average is an unbiased estimate of the full-data value.
 */
export interface NeighborhoodResult {
  trustworthiness: number;
  continuity: number;
  preservation: number;
  queries: number;
}

export function validateNeighborhoodK(k: number, n: number): string | null {
  if (!Number.isInteger(k) || k < 1) return 'k must be a positive integer.';
  if (k >= n / 2)
    return `k (${k}) must be smaller than N / 2 (${Math.floor(n / 2)}) for trustworthiness to be defined.`;
  return null;
}

function distancesTo(data: Float64Array, n: number, d: number, i: number, out: Float64Array): void {
  const oi = i * d;
  for (let j = 0; j < n; j++) {
    const oj = j * d;
    let s = 0;
    for (let t = 0; t < d; t++) {
      const diff = data[oi + t]! - data[oj + t]!;
      s += diff * diff;
    }
    out[j] = s; // squared distances preserve the ordering
  }
}

function topK(dist: Float64Array, n: number, self: number, heap: KSmallest, out: Int32Array): void {
  heap.reset();
  for (let j = 0; j < n; j++) if (j !== self) heap.push(dist[j]!, j);
  const tmp = new Float64Array(heap.k);
  heap.drainSorted(out, tmp, 0);
}

/** 1-based rank of j among all l ≠ i, ordering by (distance, index). */
function rankOf(dist: Float64Array, n: number, self: number, j: number): number {
  const dj = dist[j]!;
  let rank = 1;
  for (let l = 0; l < n; l++) {
    if (l === self || l === j) continue;
    const dl = dist[l]!;
    if (dl < dj || (dl === dj && l < j)) rank++;
  }
  return rank;
}

export function neighborhoodMetrics(
  x: Float64Array,
  dx: number,
  z: Float64Array,
  dz: number,
  n: number,
  k: number,
  queries: ArrayLike<number> | null,
  onProgress?: (fraction: number) => void,
): NeighborhoodResult {
  const error = validateNeighborhoodK(k, n);
  if (error) throw new RangeError(error);
  const m = queries ? queries.length : n;
  const distX = new Float64Array(n);
  const distZ = new Float64Array(n);
  const heap = new KSmallest(k);
  const nnX = new Int32Array(k);
  const nnZ = new Int32Array(k);
  const inX = new Uint8Array(n);
  const inZ = new Uint8Array(n);
  let trustPenalty = 0;
  let continuityPenalty = 0;
  let overlapSum = 0;
  const reportEvery = Math.max(1, Math.floor(m / 40));

  for (let q = 0; q < m; q++) {
    const i = queries ? queries[q]! : q;
    distancesTo(x, n, dx, i, distX);
    distancesTo(z, n, dz, i, distZ);
    topK(distX, n, i, heap, nnX);
    topK(distZ, n, i, heap, nnZ);
    for (let t = 0; t < k; t++) {
      inX[nnX[t]!] = 1;
      inZ[nnZ[t]!] = 1;
    }
    let overlap = 0;
    for (let t = 0; t < k; t++) {
      const jz = nnZ[t]!;
      if (inX[jz]) overlap++;
      else trustPenalty += rankOf(distX, n, i, jz) - k;
      const jx = nnX[t]!;
      if (!inZ[jx]) continuityPenalty += rankOf(distZ, n, i, jx) - k;
    }
    overlapSum += overlap / k;
    for (let t = 0; t < k; t++) {
      inX[nnX[t]!] = 0;
      inZ[nnZ[t]!] = 0;
    }
    if (onProgress && q % reportEvery === 0) onProgress(q / m);
  }
  const norm = 2 / (m * k * (2 * n - 3 * k - 1));
  return {
    trustworthiness: 1 - norm * trustPenalty,
    continuity: 1 - norm * continuityPenalty,
    preservation: overlapSum / m,
    queries: m,
  };
}
