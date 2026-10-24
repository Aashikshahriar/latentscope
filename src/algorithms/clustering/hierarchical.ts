/**
 * Agglomerative hierarchical clustering with the nearest-neighbour-chain algorithm (Murtagh,
 * 1983), O(N²) time and O(N²) memory for the condensed distance matrix. Valid for reducible
 * linkages — Ward, average (UPGMA), complete and single — updated with the Lance–Williams
 * formula. Ward is computed on Euclidean distances as in SciPy / scikit-learn.
 */
export type Linkage = 'ward' | 'average' | 'complete' | 'single';

export const HIERARCHICAL_LIMIT = 3000;

export interface Merge {
  a: number;
  b: number;
  distance: number;
  size: number;
}

function condensedIndex(n: number, i: number, j: number): number {
  if (i > j) [i, j] = [j, i];
  return n * i - (i * (i + 1)) / 2 + (j - i - 1);
}

export function linkageTree(
  data: Float64Array,
  n: number,
  d: number,
  linkage: Linkage,
  onProgress?: (f: number) => void,
): Merge[] {
  if (n < 2) throw new RangeError('Hierarchical clustering needs at least two observations.');
  if (n > HIERARCHICAL_LIMIT) {
    throw new RangeError(
      `Hierarchical clustering is limited to ${HIERARCHICAL_LIMIT} observations in the browser (O(N²) memory).`,
    );
  }
  // Ward works on squared distances internally; others on distances.
  const dist = new Float64Array((n * (n - 1)) / 2);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      for (let t = 0; t < d; t++) s += (data[i * d + t]! - data[j * d + t]!) ** 2;
      dist[condensedIndex(n, i, j)] = linkage === 'ward' ? s : Math.sqrt(s);
    }
  }
  const size = new Float64Array(n).fill(1);
  const active = new Uint8Array(n).fill(1);
  const merges: Merge[] = [];
  const chain: number[] = [];
  let remaining = n;

  while (remaining > 1) {
    if (chain.length === 0) {
      for (let i = 0; i < n; i++) {
        if (active[i]) {
          chain.push(i);
          break;
        }
      }
    }
    for (;;) {
      const x = chain[chain.length - 1]!;
      const prev = chain.length > 1 ? chain[chain.length - 2]! : -1;
      let y = -1;
      let best = Infinity;
      // Prefer the previous chain element on ties so the chain terminates.
      if (prev !== -1) {
        y = prev;
        best = dist[condensedIndex(n, x, prev)]!;
      }
      for (let i = 0; i < n; i++) {
        if (!active[i] || i === x) continue;
        const v = dist[condensedIndex(n, x, i)]!;
        if (v < best) {
          best = v;
          y = i;
        }
      }
      if (y === prev) {
        chain.pop();
        chain.pop();
        // Merge x and y into slot `keep` (the smaller index), deactivate the other.
        const keep = Math.min(x, y);
        const drop = Math.max(x, y);
        const ni = size[x]!;
        const nj = size[y]!;
        const dxy = best;
        for (let k = 0; k < n; k++) {
          if (!active[k] || k === x || k === y) continue;
          const dkx = dist[condensedIndex(n, k, x)]!;
          const dky = dist[condensedIndex(n, k, y)]!;
          let updated: number;
          switch (linkage) {
            case 'ward': {
              const nk = size[k]!;
              updated = ((ni + nk) * dkx + (nj + nk) * dky - nk * dxy) / (ni + nj + nk);
              break;
            }
            case 'average':
              updated = (ni * dkx + nj * dky) / (ni + nj);
              break;
            case 'complete':
              updated = Math.max(dkx, dky);
              break;
            case 'single':
              updated = Math.min(dkx, dky);
              break;
          }
          dist[condensedIndex(n, k, keep)] = updated;
        }
        merges.push({
          a: x,
          b: y,
          distance: linkage === 'ward' ? Math.sqrt(Math.max(dxy, 0)) : dxy,
          size: ni + nj,
        });
        size[keep] = ni + nj;
        active[drop] = 0;
        remaining--;
        if (onProgress && remaining % 64 === 0) onProgress(1 - remaining / n);
        break;
      }
      chain.push(y);
    }
  }
  // NN-chain finds merges out of order; sort by height (stable) as SciPy does.
  return merges
    .map((m, order) => ({ m, order }))
    .sort((p, q) => p.m.distance - q.m.distance || p.order - q.order)
    .map((p) => p.m);
}

/** Cuts the tree into k flat clusters, labelled 0..k−1 in order of first appearance. */
export function cutTree(merges: Merge[], n: number, k: number): Int32Array {
  if (k < 1 || k > n) throw new RangeError(`Cannot cut ${n} observations into ${k} clusters.`);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  // Merges refer to slot ids that persist (the kept slot represents the union), so union-find on
  // slot ids reproduces the cluster structure.
  for (let t = 0; t < n - k; t++) {
    const m = merges[t]!;
    const ra = find(m.a);
    const rb = find(m.b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const labels = new Int32Array(n);
  const map = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let label = map.get(r);
    if (label === undefined) {
      label = map.size;
      map.set(r, label);
    }
    labels[i] = label;
  }
  return labels;
}
