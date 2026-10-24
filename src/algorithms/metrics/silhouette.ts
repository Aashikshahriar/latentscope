/**
 * Mean silhouette coefficient (Rousseeuw, 1987) with Euclidean distances.
 *
 * For each observation i in cluster C_i:
 *   a(i) = mean distance to other members of C_i,
 *   b(i) = min over other clusters C of the mean distance to members of C,
 *   s(i) = (b(i) − a(i)) / max(a(i), b(i)),  and s(i) = 0 if |C_i| = 1.
 * Matches scikit-learn's `silhouette_score`. Callers subsample (as scikit-learn's `sample_size`
 * does) before calling this O(N² D) function.
 */
export function silhouetteScore(data: Float64Array, n: number, d: number, labels: Int32Array): number {
  const clusterIds = [...new Set(labels)].sort((a, b) => a - b);
  const c = clusterIds.length;
  if (c < 2 || c > n - 1) {
    throw new RangeError(`Silhouette needs between 2 and N − 1 clusters (got ${c} for N = ${n}).`);
  }
  const position = new Map(clusterIds.map((id, idx) => [id, idx]));
  const labelIdx = new Int32Array(n);
  const sizes = new Float64Array(c);
  for (let i = 0; i < n; i++) {
    const p = position.get(labels[i]!)!;
    labelIdx[i] = p;
    sizes[p]!++;
  }
  const sums = new Float64Array(c);
  let total = 0;
  for (let i = 0; i < n; i++) {
    sums.fill(0);
    const oi = i * d;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const oj = j * d;
      let s = 0;
      for (let t = 0; t < d; t++) {
        const diff = data[oi + t]! - data[oj + t]!;
        s += diff * diff;
      }
      sums[labelIdx[j]!]! += Math.sqrt(s);
    }
    const own = labelIdx[i]!;
    if (sizes[own]! <= 1) continue; // s(i) = 0
    const a = sums[own]! / (sizes[own]! - 1);
    let b = Infinity;
    for (let p = 0; p < c; p++) {
      if (p === own) continue;
      b = Math.min(b, sums[p]! / sizes[p]!);
    }
    const denom = Math.max(a, b);
    total += denom > 0 ? (b - a) / denom : 0;
  }
  return total / n;
}

/** Maps categorical labels (nulls excluded) to integer codes. */
export function encodeLabels(values: (string | number | null)[]): {
  codes: Int32Array;
  valid: Uint32Array;
  categories: string[];
} {
  const categories: string[] = [];
  const lookup = new Map<string, number>();
  const validRows: number[] = [];
  const codes: number[] = [];
  values.forEach((v, i) => {
    if (v === null || v === '') return;
    const key = String(v);
    let code = lookup.get(key);
    if (code === undefined) {
      code = categories.length;
      categories.push(key);
      lookup.set(key, code);
    }
    validRows.push(i);
    codes.push(code);
  });
  return { codes: Int32Array.from(codes), valid: Uint32Array.from(validRows), categories };
}
