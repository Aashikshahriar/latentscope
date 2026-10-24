import { describe, expect, it } from 'vitest';
import { kmeans } from '@/algorithms/clustering/kmeans';
import { dbscan } from '@/algorithms/clustering/dbscan';
import { cutTree, linkageTree, type Linkage } from '@/algorithms/clustering/hierarchical';
import { adjustedRandIndex } from '@/algorithms/clustering/agreement';
import { flatten, loadFixture } from './helpers';

const f = loadFixture<{
  x: number[][];
  n: number;
  d: number;
  truth: number[];
  kmeansInertia: number;
  kmeansLabels: number[];
  dbscanEps: number;
  dbscanMinSamples: number;
  dbscanLabels: number[];
  agglomerative: Record<Linkage, number[]>;
  linkageHeights: Record<Linkage, number[]>;
  small: number[][];
  ariA: number[];
  ariB: number[];
  ari: number;
}>('clustering');
const x = flatten(f.x);

describe('clustering against scikit-learn / SciPy', () => {
  it('adjusted Rand index matches adjusted_rand_score', () => {
    expect(adjustedRandIndex(f.ariA, f.ariB)).toBeCloseTo(f.ari, 12);
    expect(adjustedRandIndex([0, 0, 1, 1], [5, 5, 2, 2])).toBe(1);
  });

  it('k-means reaches the scikit-learn optimum on separated blobs', () => {
    const res = kmeans(x, f.n, f.d, { k: 4, seed: 0, nInit: 10 });
    expect(res.inertia).toBeLessThanOrEqual(f.kmeansInertia * (1 + 1e-9));
    expect(adjustedRandIndex(res.labels, f.kmeansLabels)).toBe(1);
    expect(res.sizes.reduce((s, v) => s + v, 0)).toBe(f.n);
  });

  it('k-means is deterministic per seed and validates k', () => {
    const a = kmeans(x, f.n, f.d, { k: 3, seed: 5, nInit: 1 });
    const b = kmeans(x, f.n, f.d, { k: 3, seed: 5, nInit: 1 });
    expect(Array.from(a.labels)).toEqual(Array.from(b.labels));
    expect(() => kmeans(x, f.n, f.d, { k: 0, seed: 1 })).toThrow();
    expect(() => kmeans(x, 3, f.d, { k: 4, seed: 1 })).toThrow();
  });

  it('k-means handles identical observations', () => {
    const same = flatten(Array.from({ length: 10 }, () => [1, 2]));
    const res = kmeans(same, 10, 2, { k: 3, seed: 1 });
    expect(res.inertia).toBe(0);
  });

  it('DBSCAN matches scikit-learn labels', () => {
    const res = dbscan(x, f.n, f.d, { eps: f.dbscanEps, minSamples: f.dbscanMinSamples });
    expect(adjustedRandIndex(res.labels, f.dbscanLabels)).toBe(1);
    const noiseRef = f.dbscanLabels.filter((l) => l === -1).length;
    expect(res.noiseCount).toBe(noiseRef);
  });

  for (const method of ['ward', 'average', 'complete', 'single'] as const) {
    it(`${method} linkage matches SciPy merge heights and scikit-learn labels`, () => {
      const small = flatten(f.small);
      const merges = linkageTree(small, f.small.length, 3, method);
      const heights = merges.map((m) => m.distance);
      heights.forEach((h, i) => expect(h).toBeCloseTo(f.linkageHeights[method][i]!, 9));
      const labels = cutTree(linkageTree(x, f.n, f.d, method), f.n, 4);
      expect(adjustedRandIndex(labels, f.agglomerative[method])).toBe(1);
    });
  }
});
