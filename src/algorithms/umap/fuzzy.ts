/**
 * UMAP's fuzzy simplicial set construction (McInnes, Healy & Melville, 2018), reimplemented
 * step by step for the interactive tutorial and for inspecting neighbourhood graphs. Production
 * projections use umap-js; this module mirrors umap-learn's `smooth_knn_dist`,
 * `compute_membership_strengths` and fuzzy union so the tutorial shows real weights.
 *
 * For each point i with neighbour distances d_i1 ≤ … ≤ d_ik (self excluded):
 *   ρ_i = distance to the nearest neighbour (local connectivity = 1),
 *   σ_i solves Σ_j exp(−max(0, d_ij − ρ_i) / σ_i) = log₂(k + 1)   [k + 1 counts the point itself],
 *   w_ij = exp(−max(0, d_ij − ρ_i) / σ_i).
 * The directed weights are symmetrised with the probabilistic t-conorm
 *   w̄_ij = w_ij + w_ji − w_ij · w_ji.
 */
const SMOOTH_K_TOLERANCE = 1e-5;
const MIN_K_DIST_SCALE = 1e-3;

export interface SmoothKnn {
  rho: Float64Array;
  sigma: Float64Array;
}

/**
 * @param distances N × (k+1) neighbour distances *including* the point itself at column 0,
 *                  exactly as umap-learn receives them.
 */
export function smoothKnnDist(distances: Float64Array, n: number, kPlusSelf: number, nIter = 64): SmoothKnn {
  const target = Math.log2(kPlusSelf);
  const rho = new Float64Array(n);
  const sigma = new Float64Array(n);
  let meanAll = 0;
  for (let t = 0; t < distances.length; t++) meanAll += distances[t]!;
  meanAll /= distances.length;
  for (let i = 0; i < n; i++) {
    const row = distances.subarray(i * kPlusSelf, (i + 1) * kPlusSelf);
    const nonZero: number[] = [];
    for (const v of row) if (v > 0) nonZero.push(v);
    if (nonZero.length >= 1) rho[i] = nonZero[0]!;
    let lo = 0;
    let hi = Infinity;
    let mid = 1;
    for (let iter = 0; iter < nIter; iter++) {
      let psum = 0;
      for (let j = 1; j < kPlusSelf; j++) {
        const d = row[j]! - rho[i]!;
        psum += d > 0 ? Math.exp(-(d / mid)) : 1;
      }
      if (Math.abs(psum - target) < SMOOTH_K_TOLERANCE) break;
      if (psum > target) {
        hi = mid;
        mid = (lo + hi) / 2;
      } else {
        lo = mid;
        mid = hi === Infinity ? mid * 2 : (lo + hi) / 2;
      }
    }
    let mean = 0;
    for (const v of row) mean += v;
    mean /= kPlusSelf;
    const floor = MIN_K_DIST_SCALE * (rho[i]! > 0 ? mean : meanAll);
    sigma[i] = Math.max(mid, floor);
  }
  return { rho, sigma };
}

export interface FuzzyGraph {
  /** Dense symmetric N × N membership matrix (tutorial-scale data only). */
  weights: Float64Array;
  /** Directed weights w_{i→j} before symmetrisation (dense). */
  directed: Float64Array;
  rho: Float64Array;
  sigma: Float64Array;
  n: number;
}

/**
 * Builds the dense fuzzy graph from kNN lists that include the point itself first
 * (indices / distances are N × (k+1)).
 */
export function fuzzySimplicialSet(
  indices: Int32Array,
  distances: Float64Array,
  n: number,
  kPlusSelf: number,
): FuzzyGraph {
  const { rho, sigma } = smoothKnnDist(distances, n, kPlusSelf);
  const directed = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < kPlusSelf; t++) {
      const j = indices[i * kPlusSelf + t]!;
      if (j === i || j < 0) continue;
      const d = distances[i * kPlusSelf + t]! - rho[i]!;
      directed[i * n + j] = d <= 0 || sigma[i] === 0 ? 1 : Math.exp(-(d / sigma[i]!));
    }
  }
  const weights = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = directed[i * n + j]!;
      const b = directed[j * n + i]!;
      weights[i * n + j] = a + b - a * b;
    }
  }
  return { weights, directed, rho, sigma, n };
}
