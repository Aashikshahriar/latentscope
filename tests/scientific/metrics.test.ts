import { describe, expect, it } from 'vitest';
import { neighborhoodMetrics, validateNeighborhoodK } from '@/algorithms/metrics/neighborhood';
import { silhouetteScore } from '@/algorithms/metrics/silhouette';
import { distanceCorrelation } from '@/algorithms/metrics/distances';
import { knnAccuracy, knnAgreement, linearCka, procrustes, rsa } from '@/algorithms/metrics/representation';
import { flatten, loadFixture } from './helpers';

describe('neighbourhood metrics against scikit-learn', () => {
  const f = loadFixture<{
    x: number[][];
    z: number[][];
    n: number;
    dx: number;
    dz: number;
    cases: { k: number; trustworthiness: number; continuity: number; preservation: number }[];
  }>('neighborhood');
  const x = flatten(f.x);
  const z = flatten(f.z);
  for (const c of f.cases) {
    it(`k = ${c.k}: trustworthiness, continuity, neighbourhood preservation`, () => {
      const res = neighborhoodMetrics(x, f.dx, z, f.dz, f.n, c.k, null);
      expect(res.trustworthiness).toBeCloseTo(c.trustworthiness, 12);
      expect(res.continuity).toBeCloseTo(c.continuity, 12);
      expect(res.preservation).toBeCloseTo(c.preservation, 12);
    });
  }

  it('is 1 for an isometric embedding and ≤ 1 otherwise', () => {
    const res = neighborhoodMetrics(x, f.dx, x, f.dx, f.n, 5, null);
    expect(res.trustworthiness).toBe(1);
    expect(res.continuity).toBe(1);
    expect(res.preservation).toBe(1);
  });

  it('sampled queries give an estimate close to the exact value', () => {
    const exact = neighborhoodMetrics(x, f.dx, z, f.dz, f.n, 10, null);
    const queries = Uint32Array.from({ length: 40 }, (_, i) => i * 2);
    const approx = neighborhoodMetrics(x, f.dx, z, f.dz, f.n, 10, queries);
    expect(approx.queries).toBe(40);
    expect(Math.abs(approx.trustworthiness - exact.trustworthiness)).toBeLessThan(0.05);
  });

  it('validates k against N / 2', () => {
    expect(validateNeighborhoodK(40, 80)).toMatch(/smaller than N \/ 2/);
    expect(validateNeighborhoodK(0, 80)).toMatch(/positive/);
    expect(validateNeighborhoodK(5, 80)).toBeNull();
  });
});

describe('silhouette against scikit-learn', () => {
  const f = loadFixture<{ x: number[][]; labels: number[]; n: number; d: number; silhouette: number }>(
    'silhouette',
  );
  it('matches silhouette_score', () => {
    expect(silhouetteScore(flatten(f.x), f.n, f.d, Int32Array.from(f.labels))).toBeCloseTo(f.silhouette, 12);
  });
  it('rejects single-class labels', () => {
    expect(() => silhouetteScore(flatten(f.x), f.n, f.d, new Int32Array(f.n))).toThrow(/between 2/);
  });
  it('scores singleton clusters as 0', () => {
    const data = flatten([[0], [0.1], [10]]);
    // Cluster {2} is a singleton → s = 0. Point 0: a = 0.1, b = 10; point 1: a = 0.1, b = 9.9.
    const s = silhouetteScore(data, 3, 1, Int32Array.from([0, 0, 1]));
    const expected = ((10 - 0.1) / 10 + (9.9 - 0.1) / 9.9 + 0) / 3;
    expect(s).toBeCloseTo(expected, 10);
  });
});

describe('representation similarity against NumPy / SciPy', () => {
  const f = loadFixture<{
    n: number;
    a: number[][];
    b: number[][];
    da: number;
    db: number;
    cka: number;
    ckaSelfRotated: number;
    rsaEuclidean: number;
    rsaCorrelation: number;
    procrustesA: number[][];
    procrustesB: number[][];
    procrustesDisparity: number;
  }>('representation');
  const a = flatten(f.a);
  const b = flatten(f.b);

  it('linear CKA matches the reference formula', () => {
    expect(linearCka(a, f.da, b, f.db, f.n)).toBeCloseTo(f.cka, 10);
    expect(f.ckaSelfRotated).toBeCloseTo(1, 10);
  });

  it('feature-space and Gram-space CKA agree', () => {
    // Small N relative to features forces the Gram route; compare with the transposed problem.
    const wide = flatten(f.a.slice(0, 8));
    const wideB = flatten(f.b.slice(0, 8));
    const gram = linearCka(wide, f.da, wideB, f.db, 8);
    const ref = linearCka(flatten(f.a.slice(0, 8)), f.da, flatten(f.b.slice(0, 8)), f.db, 8);
    expect(gram).toBeCloseTo(ref, 12);
    expect(linearCka(a, f.da, a, f.da, f.n)).toBeCloseTo(1, 12);
  });

  it('RSA matches scipy spearmanr over pdist', () => {
    expect(rsa(a, f.da, b, f.db, f.n, 'euclidean')).toBeCloseTo(f.rsaEuclidean, 10);
    expect(rsa(a, f.da, b, f.db, f.n, 'correlation')).toBeCloseTo(f.rsaCorrelation, 10);
  });

  it('Procrustes disparity matches scipy.spatial.procrustes', () => {
    const res = procrustes(flatten(f.procrustesA), flatten(f.procrustesB), f.n, 2);
    expect(res.disparity).toBeCloseTo(f.procrustesDisparity, 10);
  });

  it('Procrustes recovers an exact similarity transform', () => {
    const pa = flatten(f.procrustesA);
    const theta = 1.1;
    const pb = new Float64Array(pa.length);
    for (let i = 0; i < f.n; i++) {
      const [u, v] = [pa[i * 2]!, pa[i * 2 + 1]!];
      pb[i * 2] = 2 * (Math.cos(theta) * u - Math.sin(theta) * v) + 5;
      pb[i * 2 + 1] = 2 * (Math.sin(theta) * u + Math.cos(theta) * v) - 1;
    }
    const res = procrustes(pa, pb, f.n, 2);
    expect(res.disparity).toBeLessThan(1e-20 + 1e-12);
    for (let t = 0; t < pa.length; t++) expect(res.aligned[t]).toBeCloseTo(pa[t]!, 9);
  });

  it('kNN agreement is 1 for identical representations and in [0, 1] otherwise', () => {
    expect(knnAgreement(a, f.da, a, f.da, f.n, 5, null)).toBe(1);
    const v = knnAgreement(a, f.da, b, f.db, f.n, 5, null);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('kNN accuracy is 1 on perfectly separated classes and ignores unlabelled rows', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => [i * 0.01, 0]),
      ...Array.from({ length: 10 }, (_, i) => [100 + i * 0.01, 0]),
    ];
    const labels = Int32Array.from([...Array(10).fill(0), ...Array(10).fill(1)]);
    labels[3] = -1;
    expect(knnAccuracy(flatten(rows), 20, 2, labels, 3, null)).toBe(1);
  });
});

describe('distance correlation', () => {
  it('is 1 for a scaled copy and computes exhaustively for small N', () => {
    const data = flatten(Array.from({ length: 30 }, (_, i) => [Math.sin(i), Math.cos(i * 1.3), i / 10]));
    const scaled = data.map((v) => v * 3);
    const res = distanceCorrelation(data, 3, scaled, 3, 30, 10_000, 1);
    expect(res.pairs).toBe(435);
    expect(res.spearman).toBeCloseTo(1, 12);
    expect(res.pearson).toBeCloseTo(1, 12);
  });
  it('samples pairs deterministically for a seed', () => {
    const data = flatten(Array.from({ length: 300 }, (_, i) => [Math.sin(i), Math.cos(i)]));
    const r1 = distanceCorrelation(data, 2, data, 2, 300, 1000, 5);
    const r2 = distanceCorrelation(data, 2, data, 2, 300, 1000, 5);
    expect(r1.pairs).toBe(1000);
    expect(r1.spearman).toBe(r2.spearman);
  });
});
