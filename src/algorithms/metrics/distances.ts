import { createRng, randomInt } from '@/utils/rng';
import { pearson, spearman } from '../linalg/matrix';

export interface DistanceCorrelationResult {
  spearman: number;
  pearson: number;
  pairs: number;
  /** Sampled pairs (original distance, embedded distance) for Shepard diagrams. */
  sample: { a: number; b: number }[];
}

/**
 * Correlation between pairwise Euclidean distances in two spaces over a seeded sample of
 * distinct pairs (i ≠ j). Spearman's ρ is reported as the primary value because non-linear
 * methods (t-SNE, UMAP) deliberately distort distances monotonically at best; Pearson's r is
 * reported alongside. Neither is a complete measure of embedding quality: a projection can
 * preserve neighbourhoods well while distorting large distances.
 */
export function distanceCorrelation(
  a: Float64Array,
  da: number,
  b: Float64Array,
  db: number,
  n: number,
  pairs: number,
  seed: number,
  keepSample = 1500,
): DistanceCorrelationResult {
  if (n < 3) throw new RangeError('Distance correlation needs at least 3 observations.');
  const totalPairs = (n * (n - 1)) / 2;
  const exhaustive = totalPairs <= pairs;
  const count = exhaustive ? totalPairs : pairs;
  const distA = new Float64Array(count);
  const distB = new Float64Array(count);
  const dist = (data: Float64Array, d: number, i: number, j: number) => {
    let s = 0;
    for (let t = 0; t < d; t++) {
      const diff = data[i * d + t]! - data[j * d + t]!;
      s += diff * diff;
    }
    return Math.sqrt(s);
  };
  if (exhaustive) {
    let p = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        distA[p] = dist(a, da, i, j);
        distB[p] = dist(b, db, i, j);
        p++;
      }
    }
  } else {
    const rng = createRng(seed);
    for (let p = 0; p < count; p++) {
      const i = randomInt(rng, n);
      let j = randomInt(rng, n - 1);
      if (j >= i) j++;
      distA[p] = dist(a, da, i, j);
      distB[p] = dist(b, db, i, j);
    }
  }
  const sample: { a: number; b: number }[] = [];
  const stride = Math.max(1, Math.floor(count / keepSample));
  for (let p = 0; p < count && sample.length < keepSample; p += stride)
    sample.push({ a: distA[p]!, b: distB[p]! });
  return { spearman: spearman(distA, distB), pearson: pearson(distA, distB), pairs: count, sample };
}
