import type { DistanceMetric } from '@/types/algorithms';
import { rowNorms } from './matrix';

export interface KnnGraph {
  /** N × k neighbour indices, nearest first, self excluded. */
  indices: Int32Array;
  /** N × k distances in the requested metric, ascending. */
  distances: Float64Array;
  k: number;
  /** Number of query rows (rows of `indices`). */
  rows: number;
}

/**
 * Bounded max-heap that keeps the k smallest (distance, index) pairs seen so far.
 * Ties are broken by index so results are deterministic.
 */
export class KSmallest {
  readonly dist: Float64Array;
  readonly idx: Int32Array;
  size = 0;
  constructor(readonly k: number) {
    this.dist = new Float64Array(k);
    this.idx = new Int32Array(k);
  }
  reset(): void {
    this.size = 0;
  }
  private greater(a: number, b: number): boolean {
    const da = this.dist[a]!;
    const db = this.dist[b]!;
    return da > db || (da === db && this.idx[a]! > this.idx[b]!);
  }
  private swap(a: number, b: number): void {
    const d = this.dist[a]!;
    this.dist[a] = this.dist[b]!;
    this.dist[b] = d;
    const i = this.idx[a]!;
    this.idx[a] = this.idx[b]!;
    this.idx[b] = i;
  }
  push(distance: number, index: number): void {
    if (this.size < this.k) {
      let c = this.size++;
      this.dist[c] = distance;
      this.idx[c] = index;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (!this.greater(c, p)) break;
        this.swap(c, p);
        c = p;
      }
      return;
    }
    const top = this.dist[0]!;
    if (distance > top || (distance === top && index > this.idx[0]!)) return;
    this.dist[0] = distance;
    this.idx[0] = index;
    let p = 0;
    for (;;) {
      const l = 2 * p + 1;
      const r = l + 1;
      let m = p;
      if (l < this.k && this.greater(l, m)) m = l;
      if (r < this.k && this.greater(r, m)) m = r;
      if (m === p) break;
      this.swap(p, m);
      p = m;
    }
  }
  /** Writes the contents sorted ascending into the output arrays at `offset`. */
  drainSorted(outIdx: Int32Array, outDist: Float64Array, offset: number): void {
    const order = Array.from({ length: this.size }, (_, i) => i);
    order.sort((a, b) => this.dist[a]! - this.dist[b]! || this.idx[a]! - this.idx[b]!);
    for (let t = 0; t < order.length; t++) {
      outIdx[offset + t] = this.idx[order[t]!]!;
      outDist[offset + t] = this.dist[order[t]!]!;
    }
  }
}

export interface KnnOptions {
  metric?: DistanceMetric;
  /** Rows to query; defaults to every row. */
  queries?: ArrayLike<number> | null;
  onProgress?: (fraction: number) => void;
}

/**
 * Exact brute-force k-nearest neighbours. O(Q · N · D) time, O(Q · k) memory.
 *
 * Euclidean distances use the direct difference form Σ(aₖ − bₖ)². The expansion
 * ‖a‖² + ‖b‖² − 2a·b would be faster but loses precision for nearby points.
 * Cosine distance is 1 − cos θ; rows with zero norm are at distance 1 from everything
 * (matching umap-js). The query row itself is always excluded.
 */
export function exactKnn(
  data: Float64Array,
  n: number,
  d: number,
  k: number,
  options: KnnOptions = {},
): KnnGraph {
  const metric = options.metric ?? 'euclidean';
  if (k < 1) throw new RangeError('k must be at least 1.');
  if (k > n - 1) throw new RangeError(`k = ${k} requires at least ${k + 1} observations (have ${n}).`);
  const queries = options.queries ?? null;
  const q = queries ? queries.length : n;
  const indices = new Int32Array(q * k);
  const distances = new Float64Array(q * k);
  const heap = new KSmallest(k);
  const norms = metric === 'cosine' ? rowNorms(data, n, d) : null;
  const reportEvery = Math.max(1, Math.floor(q / 50));

  for (let qi = 0; qi < q; qi++) {
    const i = queries ? queries[qi]! : qi;
    const oi = i * d;
    heap.reset();
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const oj = j * d;
      let dist: number;
      if (norms) {
        const ni = norms[i]!;
        const nj = norms[j]!;
        if (ni === 0 || nj === 0) dist = ni === 0 && nj === 0 ? 0 : 1;
        else {
          let dot = 0;
          for (let t = 0; t < d; t++) dot += data[oi + t]! * data[oj + t]!;
          dist = 1 - dot / (ni * nj);
        }
      } else {
        let s = 0;
        for (let t = 0; t < d; t++) {
          const diff = data[oi + t]! - data[oj + t]!;
          s += diff * diff;
        }
        dist = s;
      }
      heap.push(dist, j);
    }
    heap.drainSorted(indices, distances, qi * k);
    if (!norms) {
      for (let t = 0; t < k; t++) distances[qi * k + t] = Math.sqrt(distances[qi * k + t]!);
    }
    if (options.onProgress && qi % reportEvery === 0) options.onProgress(qi / q);
  }
  options.onProgress?.(1);
  return { indices, distances, k, rows: q };
}

/** Distances (Euclidean) from one row to every row, including itself (0). */
export function distancesFrom(data: ArrayLike<number>, n: number, d: number, i: number): Float64Array {
  const out = new Float64Array(n);
  const oi = i * d;
  for (let j = 0; j < n; j++) {
    const oj = j * d;
    let s = 0;
    for (let t = 0; t < d; t++) {
      const diff = data[oi + t]! - data[oj + t]!;
      s += diff * diff;
    }
    out[j] = Math.sqrt(s);
  }
  return out;
}

/** Nearest neighbours of a single row, for interactive inspection. */
export function nearestTo(
  data: ArrayLike<number>,
  n: number,
  d: number,
  i: number,
  k: number,
  metric: DistanceMetric = 'euclidean',
): { index: number; distance: number }[] {
  const heap = new KSmallest(Math.min(k, n - 1));
  if (heap.k === 0) return [];
  const oi = i * d;
  let ni = 0;
  if (metric === 'cosine') for (let t = 0; t < d; t++) ni += data[oi + t]! * data[oi + t]!;
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const oj = j * d;
    let dist: number;
    if (metric === 'cosine') {
      let dot = 0;
      let nj = 0;
      for (let t = 0; t < d; t++) {
        dot += data[oi + t]! * data[oj + t]!;
        nj += data[oj + t]! * data[oj + t]!;
      }
      dist = ni === 0 || nj === 0 ? (ni === 0 && nj === 0 ? 0 : 1) : 1 - dot / Math.sqrt(ni * nj);
    } else {
      let s = 0;
      for (let t = 0; t < d; t++) {
        const diff = data[oi + t]! - data[oj + t]!;
        s += diff * diff;
      }
      dist = Math.sqrt(s);
    }
    heap.push(dist, j);
  }
  const idx = new Int32Array(heap.size);
  const dist = new Float64Array(heap.size);
  heap.drainSorted(idx, dist, 0);
  return Array.from(idx, (index, t) => ({ index, distance: dist[t]! }));
}
