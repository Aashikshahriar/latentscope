/**
 * DBSCAN (Ester et al., 1996) with Euclidean distance and scikit-learn's conventions:
 * a point is a core point if its ε-neighbourhood (inclusive of the point itself, d ≤ ε) contains
 * at least `minSamples` points; clusters are grown depth-first from core points in index order;
 * border points join the first cluster that reaches them; everything else is noise (−1).
 *
 * Neighbourhoods are recomputed on demand rather than stored, keeping memory O(N) at the cost of
 * a second O(N² D) pass.
 */
export interface DbscanOptions {
  eps: number;
  minSamples: number;
  onProgress?: (fraction: number) => void;
}

export interface DbscanResult {
  labels: Int32Array;
  clusterCount: number;
  noiseCount: number;
  coreCount: number;
}

function regionQuery(
  data: Float64Array,
  n: number,
  d: number,
  i: number,
  epsSq: number,
  out: number[],
): void {
  out.length = 0;
  const oi = i * d;
  for (let j = 0; j < n; j++) {
    const oj = j * d;
    let s = 0;
    for (let t = 0; t < d && s <= epsSq; t++) {
      const diff = data[oi + t]! - data[oj + t]!;
      s += diff * diff;
    }
    if (s <= epsSq) out.push(j);
  }
}

export function dbscan(data: Float64Array, n: number, d: number, options: DbscanOptions): DbscanResult {
  const { eps, minSamples } = options;
  if (!(eps > 0)) throw new RangeError('ε must be positive.');
  if (!Number.isInteger(minSamples) || minSamples < 1)
    throw new RangeError('Minimum samples must be a positive integer.');
  const epsSq = eps * eps;
  const isCore = new Uint8Array(n);
  const buffer: number[] = [];
  let coreCount = 0;
  for (let i = 0; i < n; i++) {
    regionQuery(data, n, d, i, epsSq, buffer);
    if (buffer.length >= minSamples) {
      isCore[i] = 1;
      coreCount++;
    }
    if (options.onProgress && i % 256 === 0) options.onProgress((0.5 * i) / n);
  }
  const labels = new Int32Array(n).fill(-1);
  let label = 0;
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || !isCore[start]) continue;
    let i = start;
    for (;;) {
      if (labels[i] === -1) {
        labels[i] = label;
        if (isCore[i]) {
          regionQuery(data, n, d, i, epsSq, buffer);
          for (const v of buffer) if (labels[v] === -1) stack.push(v);
        }
      }
      if (stack.length === 0) break;
      i = stack.pop()!;
    }
    label++;
    if (options.onProgress) options.onProgress(0.5 + (0.5 * start) / n);
  }
  let noiseCount = 0;
  for (let i = 0; i < n; i++) if (labels[i] === -1) noiseCount++;
  return { labels, clusterCount: label, noiseCount, coreCount };
}
