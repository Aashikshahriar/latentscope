/**
 * High-dimensional affinities for t-SNE.
 *
 * For each observation i a Gaussian bandwidth σ_i is found by bisection on β_i = 1 / (2σ_i²) so
 * that the Shannon entropy (in nats) of the conditional distribution
 *
 *     p_{j|i} = exp(−β_i ‖x_i − x_j‖²) / Σ_{k≠i} exp(−β_i ‖x_i − x_k‖²)
 *
 * equals log(perplexity). The search mirrors scikit-learn's `_binary_search_perplexity`
 * (tolerance 1e-5, at most 100 steps). The joint distribution is the symmetrisation
 * p_ij = (p_{j|i} + p_{i|j}) / Σ_{kl}(p_{l|k} + p_{k|l}), i.e. (p_{j|i} + p_{i|j}) / 2N.
 */

export const MACHINE_EPSILON = 2.220446049250313e-16;
const PERPLEXITY_TOLERANCE = 1e-5;
const MAX_STEPS = 100;

/**
 * Computes conditional probabilities for one row in place.
 * @param distSq squared distances to the candidate neighbours (self excluded)
 * @param out    receives p_{j|i}
 * @returns the β found and the achieved perplexity
 */
export function conditionalRow(
  distSq: ArrayLike<number>,
  offset: number,
  count: number,
  perplexity: number,
  out: Float64Array,
  outOffset: number,
): { beta: number; perplexity: number } {
  const desiredEntropy = Math.log(perplexity);
  let beta = 1;
  let betaMin = -Infinity;
  let betaMax = Infinity;
  let entropy = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    let sumP = 0;
    for (let j = 0; j < count; j++) {
      const p = Math.exp(-distSq[offset + j]! * beta);
      out[outOffset + j] = p;
      sumP += p;
    }
    if (sumP === 0) sumP = 1e-8; // scikit-learn's EPSILON_DBL guard
    let sumDistP = 0;
    for (let j = 0; j < count; j++) {
      const p = out[outOffset + j]! / sumP;
      out[outOffset + j] = p;
      sumDistP += distSq[offset + j]! * p;
    }
    entropy = Math.log(sumP) + beta * sumDistP;
    const diff = entropy - desiredEntropy;
    if (Math.abs(diff) <= PERPLEXITY_TOLERANCE) break;
    if (diff > 0) {
      betaMin = beta;
      beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
    } else {
      betaMax = beta;
      beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
    }
  }
  return { beta, perplexity: Math.exp(entropy) };
}

/** Dense joint probabilities from the full N × N squared-distance matrix (exact t-SNE). */
export function jointProbabilitiesDense(
  data: Float64Array,
  n: number,
  d: number,
  perplexity: number,
  onProgress?: (fraction: number) => void,
): { P: Float64Array; meanPerplexity: number } {
  const distRow = new Float64Array(n - 1);
  const condRow = new Float64Array(n - 1);
  const conditional = new Float64Array(n * n);
  let perplexitySum = 0;
  for (let i = 0; i < n; i++) {
    const oi = i * d;
    let c = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const oj = j * d;
      let s = 0;
      for (let t = 0; t < d; t++) {
        const diff = data[oi + t]! - data[oj + t]!;
        s += diff * diff;
      }
      distRow[c++] = s;
    }
    const res = conditionalRow(distRow, 0, n - 1, perplexity, condRow, 0);
    perplexitySum += res.perplexity;
    c = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      conditional[i * n + j] = condRow[c++]!;
    }
    if (onProgress && i % 64 === 0) onProgress(i / n);
  }
  const P = new Float64Array(n * n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = conditional[i * n + j]! + conditional[j * n + i]!;
      P[i * n + j] = v;
      P[j * n + i] = v;
      sum += 2 * v;
    }
  }
  sum = Math.max(sum, MACHINE_EPSILON);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      P[i * n + j] = i === j ? 0 : Math.max(P[i * n + j]! / sum, MACHINE_EPSILON);
    }
  }
  return { P, meanPerplexity: perplexitySum / n };
}

/** Symmetric sparse matrix in CSR form. */
export interface SparseP {
  rowPtr: Int32Array;
  colIdx: Int32Array;
  values: Float64Array;
  n: number;
}

/**
 * Sparse joint probabilities from k-nearest-neighbour lists (Barnes–Hut t-SNE), with
 * k = min(N − 1, ⌊3·perplexity + 1⌋) as in scikit-learn and van der Maaten (2014).
 */
export function jointProbabilitiesSparse(
  knnIndices: Int32Array,
  knnDistances: Float64Array,
  n: number,
  k: number,
  perplexity: number,
): { P: SparseP; meanPerplexity: number } {
  const distSq = new Float64Array(n * k);
  for (let t = 0; t < distSq.length; t++) distSq[t] = knnDistances[t]! * knnDistances[t]!;
  const cond = new Float64Array(n * k);
  let perplexitySum = 0;
  for (let i = 0; i < n; i++) {
    perplexitySum += conditionalRow(distSq, i * k, k, perplexity, cond, i * k).perplexity;
  }

  // Symmetrise: P = C + Cᵀ, accumulated through per-row maps.
  const rows: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < k; t++) {
      const j = knnIndices[i * k + t]!;
      const v = cond[i * k + t]!;
      if (v === 0) continue;
      rows[i]!.set(j, (rows[i]!.get(j) ?? 0) + v);
      rows[j]!.set(i, (rows[j]!.get(i) ?? 0) + v);
    }
  }
  let nnz = 0;
  let sum = 0;
  for (const row of rows) {
    nnz += row.size;
    for (const v of row.values()) sum += v;
  }
  sum = Math.max(sum, MACHINE_EPSILON);
  const rowPtr = new Int32Array(n + 1);
  const colIdx = new Int32Array(nnz);
  const values = new Float64Array(nnz);
  let p = 0;
  for (let i = 0; i < n; i++) {
    rowPtr[i] = p;
    const entries = [...rows[i]!.entries()].sort((a, b) => a[0] - b[0]);
    for (const [j, v] of entries) {
      colIdx[p] = j;
      values[p] = v / sum;
      p++;
    }
  }
  rowPtr[n] = p;
  return { P: { rowPtr, colIdx, values, n }, meanPerplexity: perplexitySum / n };
}
