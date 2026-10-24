import { Matrix, SingularValueDecomposition } from 'ml-matrix';
import { KSmallest } from '../linalg/knn';
import { centerColumns, spearman } from '../linalg/matrix';

/**
 * Linear Centered Kernel Alignment (Kornblith et al., 2019):
 *   CKA(X, Y) = ‖Yᵀ X‖²_F / (‖Xᵀ X‖_F · ‖Yᵀ Y‖_F)  with column-centred X, Y.
 * Equivalently HSIC computed with linear kernels on the N × N Gram matrices. We evaluate whichever
 * form is cheaper (feature space when N is large, Gram space when the feature counts are large).
 * CKA is invariant to orthogonal transforms and isotropic scaling, but not to arbitrary
 * invertible linear maps.
 */
export function linearCka(x: Float64Array, px: number, y: Float64Array, py: number, n: number): number {
  const xc = Float64Array.from(x);
  const yc = Float64Array.from(y);
  centerColumns(xc, n, px);
  centerColumns(yc, n, py);
  const featureCost = n * (px * px + py * py + px * py);
  const gramCost = n * n * (px + py) + n * n;
  if (featureCost <= gramCost) {
    const cross = frobeniusSqOfProduct(yc, py, xc, px, n);
    const xx = Math.sqrt(frobeniusSqOfProduct(xc, px, xc, px, n));
    const yy = Math.sqrt(frobeniusSqOfProduct(yc, py, yc, py, n));
    return xx > 0 && yy > 0 ? cross / (xx * yy) : Number.NaN;
  }
  const kx = gram(xc, n, px);
  const ky = gram(yc, n, py);
  let xy = 0;
  let xxs = 0;
  let yys = 0;
  for (let t = 0; t < kx.length; t++) {
    xy += kx[t]! * ky[t]!;
    xxs += kx[t]! * kx[t]!;
    yys += ky[t]! * ky[t]!;
  }
  return xxs > 0 && yys > 0 ? xy / Math.sqrt(xxs * yys) : Number.NaN;
}

/** ‖Aᵀ B‖²_F for row-major A (n × pa), B (n × pb). */
function frobeniusSqOfProduct(a: Float64Array, pa: number, b: Float64Array, pb: number, n: number): number {
  const prod = new Float64Array(pa * pb);
  for (let i = 0; i < n; i++) {
    const oa = i * pa;
    const ob = i * pb;
    for (let s = 0; s < pa; s++) {
      const av = a[oa + s]!;
      if (av === 0) continue;
      const row = s * pb;
      for (let t = 0; t < pb; t++) prod[row + t]! += av * b[ob + t]!;
    }
  }
  let sum = 0;
  for (let t = 0; t < prod.length; t++) sum += prod[t]! * prod[t]!;
  return sum;
}

function gram(a: Float64Array, n: number, p: number): Float64Array {
  const k = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let t = 0; t < p; t++) s += a[i * p + t]! * a[j * p + t]!;
      k[i * n + j] = s;
      k[j * n + i] = s;
    }
  }
  return k;
}

export type RdmMetric = 'euclidean' | 'correlation';

/** Condensed representational dissimilarity matrix (upper triangle, row-major). */
export function rdm(data: Float64Array, n: number, d: number, metric: RdmMetric): Float64Array {
  let rows = data;
  if (metric === 'correlation') {
    // Correlation distance 1 − r between observation vectors: centre and normalise each row.
    rows = Float64Array.from(data);
    for (let i = 0; i < n; i++) {
      let mean = 0;
      for (let t = 0; t < d; t++) mean += rows[i * d + t]!;
      mean /= d;
      let norm = 0;
      for (let t = 0; t < d; t++) {
        rows[i * d + t]! -= mean;
        norm += rows[i * d + t]! ** 2;
      }
      norm = Math.sqrt(norm);
      if (norm > 0) for (let t = 0; t < d; t++) rows[i * d + t]! /= norm;
    }
  }
  const out = new Float64Array((n * (n - 1)) / 2);
  let p = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      if (metric === 'correlation') {
        for (let t = 0; t < d; t++) s += rows[i * d + t]! * rows[j * d + t]!;
        out[p++] = 1 - s;
      } else {
        for (let t = 0; t < d; t++) s += (rows[i * d + t]! - rows[j * d + t]!) ** 2;
        out[p++] = Math.sqrt(s);
      }
    }
  }
  return out;
}

/**
 * Representational Similarity Analysis (Kriegeskorte et al., 2008): Spearman correlation between
 * the condensed RDMs of two representations of the same observations.
 */
export function rsa(
  a: Float64Array,
  da: number,
  b: Float64Array,
  db: number,
  n: number,
  metric: RdmMetric,
): number {
  return spearman(rdm(a, n, da, metric), rdm(b, n, db, metric));
}

export interface ProcrustesResult {
  /** B aligned onto A, in A's original location and scale (N × k). */
  aligned: Float64Array;
  /** Residual sum of squares after standardisation, in [0, 1] (scipy.spatial.procrustes). */
  disparity: number;
}

/**
 * Orthogonal Procrustes alignment of B onto A (rotation/reflection + uniform scale + translation).
 * Both are centred and scaled to unit Frobenius norm; with Bᵀ A = U Σ Vᵀ the optimal orthogonal
 * map is R = U Vᵀ and the disparity is 1 − (tr Σ)². Used only to make two projections easier to
 * compare visually; it never alters stored coordinates.
 */
export function procrustes(a: Float64Array, b: Float64Array, n: number, k: number): ProcrustesResult {
  const ac = Float64Array.from(a);
  const bc = Float64Array.from(b);
  const meanA = centerColumns(ac, n, k);
  centerColumns(bc, n, k);
  let normA = 0;
  let normB = 0;
  for (let t = 0; t < ac.length; t++) {
    normA += ac[t]! ** 2;
    normB += bc[t]! ** 2;
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA === 0 || normB === 0) throw new RangeError('Procrustes alignment needs non-degenerate inputs.');
  for (let t = 0; t < ac.length; t++) {
    ac[t]! /= normA;
    bc[t]! /= normB;
  }
  const m = new Matrix(k, k);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < k; r++) {
      for (let c = 0; c < k; c++) m.set(r, c, m.get(r, c) + bc[i * k + r]! * ac[i * k + c]!);
    }
  }
  const svd = new SingularValueDecomposition(m);
  const R = svd.leftSingularVectors.mmul(svd.rightSingularVectors.transpose());
  const scale = svd.diagonal.reduce((s, v) => s + v, 0);
  const aligned = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < k; c++) {
      let s = 0;
      for (let r = 0; r < k; r++) s += bc[i * k + r]! * R.get(r, c);
      aligned[i * k + c] = s * scale * normA + meanA[c]!;
    }
  }
  return { aligned, disparity: Math.max(0, 1 - scale * scale) };
}

function neighbors(
  data: Float64Array,
  n: number,
  d: number,
  i: number,
  heap: KSmallest,
  out: Int32Array,
): void {
  heap.reset();
  const oi = i * d;
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    let s = 0;
    const oj = j * d;
    for (let t = 0; t < d; t++) s += (data[oi + t]! - data[oj + t]!) ** 2;
    heap.push(s, j);
  }
  heap.drainSorted(out, new Float64Array(heap.k), 0);
}

/** Mean fraction of shared k-nearest neighbours between two representations of the same rows. */
export function knnAgreement(
  a: Float64Array,
  da: number,
  b: Float64Array,
  db: number,
  n: number,
  k: number,
  queries: ArrayLike<number> | null,
): number {
  const heap = new KSmallest(k);
  const na = new Int32Array(k);
  const nb = new Int32Array(k);
  const mark = new Uint8Array(n);
  const m = queries ? queries.length : n;
  let sum = 0;
  for (let q = 0; q < m; q++) {
    const i = queries ? queries[q]! : q;
    neighbors(a, n, da, i, heap, na);
    neighbors(b, n, db, i, heap, nb);
    for (let t = 0; t < k; t++) mark[na[t]!] = 1;
    let shared = 0;
    for (let t = 0; t < k; t++) if (mark[nb[t]!]) shared++;
    for (let t = 0; t < k; t++) mark[na[t]!] = 0;
    sum += shared / k;
  }
  return sum / m;
}

/**
 * Leave-one-out k-nearest-neighbour classification accuracy: each query is classified by majority
 * vote of its k nearest labelled neighbours (ties go to the class of the nearest tied neighbour).
 * Rows with label −1 are excluded both as queries and as neighbours.
 */
export function knnAccuracy(
  data: Float64Array,
  n: number,
  d: number,
  labels: Int32Array,
  k: number,
  queries: ArrayLike<number> | null,
): number {
  const labelled: number[] = [];
  for (let i = 0; i < n; i++) if (labels[i]! >= 0) labelled.push(i);
  const heap = new KSmallest(k);
  const nn = new Int32Array(k);
  const dist = new Float64Array(k);
  const pool = queries ? Array.from(queries).filter((i) => labels[i]! >= 0) : labelled;
  if (pool.length === 0) return Number.NaN;
  let correct = 0;
  for (const i of pool) {
    heap.reset();
    const oi = i * d;
    for (const j of labelled) {
      if (j === i) continue;
      let s = 0;
      const oj = j * d;
      for (let t = 0; t < d; t++) s += (data[oi + t]! - data[oj + t]!) ** 2;
      heap.push(s, j);
    }
    const size = heap.size;
    heap.drainSorted(nn, dist, 0);
    const votes = new Map<number, number>();
    let best = -1;
    let bestVotes = 0;
    for (let t = 0; t < size; t++) votes.set(labels[nn[t]!]!, (votes.get(labels[nn[t]!]!) ?? 0) + 1);
    // Iterate in distance order so that ties resolve to the nearest neighbour's class.
    for (let t = 0; t < size; t++) {
      const label = labels[nn[t]!]!;
      const v = votes.get(label)!;
      if (v > bestVotes) {
        best = label;
        bestVotes = v;
      }
    }
    if (best === labels[i]) correct++;
  }
  return correct / pool.length;
}
