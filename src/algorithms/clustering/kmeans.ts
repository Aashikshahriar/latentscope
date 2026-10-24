import { createRng, randomInt, type Rng } from '@/utils/rng';

export interface KMeansOptions {
  k: number;
  seed: number;
  /** Independent restarts; the solution with the lowest inertia is kept. */
  nInit?: number;
  maxIterations?: number;
  /** Convergence tolerance on centre movement, relative to the mean feature variance (as in scikit-learn). */
  tolerance?: number;
  onProgress?: (fraction: number) => void;
}

export interface KMeansResult {
  labels: Int32Array;
  centers: Float64Array;
  inertia: number;
  iterations: number;
  sizes: number[];
}

/**
 * Lloyd's k-means with k-means++ seeding (Arthur & Vassilvitskii, 2007).
 * Empty clusters are re-seeded with the point farthest from its current centre.
 */
export function kmeans(data: Float64Array, n: number, d: number, options: KMeansOptions): KMeansResult {
  const { k, seed } = options;
  if (!Number.isInteger(k) || k < 1) throw new RangeError('k must be a positive integer.');
  if (k > n) throw new RangeError(`k (${k}) cannot exceed the number of observations (${n}).`);
  const nInit = options.nInit ?? 4;
  const maxIterations = options.maxIterations ?? 300;
  const tolerance = (options.tolerance ?? 1e-4) * meanVariance(data, n, d);
  const rng = createRng(seed);
  let best: KMeansResult | null = null;
  for (let run = 0; run < nInit; run++) {
    const result = lloyd(data, n, d, k, kmeansPlusPlus(data, n, d, k, rng), maxIterations, tolerance);
    if (!best || result.inertia < best.inertia) best = result;
    options.onProgress?.((run + 1) / nInit);
  }
  return best!;
}

function meanVariance(data: Float64Array, n: number, d: number): number {
  let total = 0;
  for (let t = 0; t < d; t++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += data[i * d + t]!;
    mean /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (data[i * d + t]! - mean) ** 2;
    total += v / n;
  }
  return total / d;
}

function sqDist(a: Float64Array, ao: number, b: Float64Array, bo: number, d: number): number {
  let s = 0;
  for (let t = 0; t < d; t++) {
    const diff = a[ao + t]! - b[bo + t]!;
    s += diff * diff;
  }
  return s;
}

export function kmeansPlusPlus(data: Float64Array, n: number, d: number, k: number, rng: Rng): Float64Array {
  const centers = new Float64Array(k * d);
  const first = randomInt(rng, n);
  centers.set(data.subarray(first * d, first * d + d), 0);
  const closest = new Float64Array(n);
  for (let i = 0; i < n; i++) closest[i] = sqDist(data, i * d, centers, 0, d);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) total += closest[i]!;
    let chosen = n - 1;
    if (total > 0) {
      let target = rng() * total;
      for (let i = 0; i < n; i++) {
        target -= closest[i]!;
        if (target <= 0) {
          chosen = i;
          break;
        }
      }
    } else {
      chosen = randomInt(rng, n); // all points coincide with existing centres
    }
    centers.set(data.subarray(chosen * d, chosen * d + d), c * d);
    for (let i = 0; i < n; i++) closest[i] = Math.min(closest[i]!, sqDist(data, i * d, centers, c * d, d));
  }
  return centers;
}

function lloyd(
  data: Float64Array,
  n: number,
  d: number,
  k: number,
  centers: Float64Array,
  maxIterations: number,
  tolerance: number,
): KMeansResult {
  const labels = new Int32Array(n);
  const pointDist = new Float64Array(n);
  const sums = new Float64Array(k * d);
  const counts = new Int32Array(k);
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dist = sqDist(data, i * d, centers, c * d, d);
        if (dist < bestD) {
          bestD = dist;
          bestC = c;
        }
      }
      labels[i] = bestC;
      pointDist[i] = bestD;
    }
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = labels[i]!;
      counts[c]!++;
      for (let t = 0; t < d; t++) sums[c * d + t]! += data[i * d + t]!;
    }
    let shift = 0;
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // Re-seed an empty cluster with the worst-fitted point.
        let far = 0;
        for (let i = 1; i < n; i++) if (pointDist[i]! > pointDist[far]!) far = i;
        pointDist[far] = 0;
        for (let t = 0; t < d; t++) {
          shift += (centers[c * d + t]! - data[far * d + t]!) ** 2;
          centers[c * d + t] = data[far * d + t]!;
        }
        continue;
      }
      for (let t = 0; t < d; t++) {
        const next = sums[c * d + t]! / counts[c]!;
        shift += (centers[c * d + t]! - next) ** 2;
        centers[c * d + t] = next;
      }
    }
    if (shift <= tolerance) {
      iterations++;
      break;
    }
  }
  // Final assignment and inertia with the converged centres.
  let inertia = 0;
  const sizes = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    let bestC = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const dist = sqDist(data, i * d, centers, c * d, d);
      if (dist < bestD) {
        bestD = dist;
        bestC = c;
      }
    }
    labels[i] = bestC;
    inertia += bestD;
    sizes[bestC]!++;
  }
  return { labels, centers, inertia, iterations, sizes };
}
