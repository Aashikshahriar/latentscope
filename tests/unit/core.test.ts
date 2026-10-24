import { describe, expect, it } from 'vitest';
import { createGaussian, createRng, sampleWithoutReplacement } from '@/utils/rng';
import { datasetChecksum, sha256Fallback, sha256Hex } from '@/utils/checksum';
import { preprocess, subsampleIndices } from '@/algorithms/preprocessing/preprocess';
import { exactKnn, nearestTo } from '@/algorithms/linalg/knn';
import { averageRanks, spearman } from '@/algorithms/linalg/matrix';
import { niceTicks, normalizeCoords, pointInPolygon } from '@/visualization/common/geometry';
import { computeColorMapping, defaultColorBy } from '@/visualization/common/colorMapping';
import { categoricalColor, sequentialColor } from '@/visualization/common/palettes';
import { gaussianClusters, multimodal, swissRoll } from '@/services/datasets/generators';
import { demoDatasetId } from '@/services/datasets/demos';
import { demoSpecFromId } from '@/services/experiments/open';
import { featureGeometry, featureNeighbors } from '@/features/inspector/neighbors';
import { matchById, matchByOrder } from '@/services/experiments/correspondence';
import type { Dataset } from '@/types/dataset';
import { formatBytes, formatNumber } from '@/utils/format';

function makeDataset(values: number[][], ids?: string[], label?: string[]): Dataset {
  const n = values.length;
  const d = values[0]!.length;
  return {
    id: 'test',
    name: 'test',
    source: { type: 'upload', fileName: 't.csv', format: 'csv' },
    n,
    d,
    values: Float32Array.from(values.flat()),
    featureNames: Array.from({ length: d }, (_, i) => `f${i}`),
    ids: ids ?? values.map((_, i) => `r${i}`),
    columns: label ? [{ name: 'label', role: 'label', kind: 'categorical', values: label }] : [],
    checksum: '0'.repeat(64),
    createdAt: '',
    importNotes: [],
  };
}

describe('seeded randomness', () => {
  it('is reproducible and decorrelated across seeds', () => {
    const a = createRng(1);
    const b = createRng(1);
    const c = createRng(2);
    const sa = Array.from({ length: 5 }, a);
    expect(sa).toEqual(Array.from({ length: 5 }, b));
    expect(sa).not.toEqual(Array.from({ length: 5 }, c));
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });
  it('produces approximately standard normal variates', () => {
    const g = createGaussian(createRng(3));
    const xs = Array.from({ length: 20000 }, g);
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });
  it('samples without replacement, sorted and distinct', () => {
    for (const [n, k] of [
      [100, 10],
      [100, 90],
      [5, 5],
    ] as const) {
      const s = Array.from(sampleWithoutReplacement(n, k, createRng(4)));
      expect(new Set(s).size).toBe(k);
      expect(s).toEqual([...s].sort((x, y) => x - y));
      expect(s.every((v) => v >= 0 && v < n)).toBe(true);
    }
    expect(() => sampleWithoutReplacement(3, 4, createRng(1))).toThrow();
  });
});

describe('checksums', () => {
  it('pure-JS SHA-256 matches known vectors and Web Crypto', async () => {
    const enc = new TextEncoder();
    expect(sha256Fallback(enc.encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Fallback(enc.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const long = enc.encode('a'.repeat(1000));
    expect(sha256Fallback(long)).toBe(await sha256Hex(long));
  });
  it('dataset checksum depends on values and ids, not on metadata', async () => {
    const v = Float32Array.from([1, 2, 3, 4]);
    const a = await datasetChecksum(v, 2, 2, ['x', 'y']);
    expect(await datasetChecksum(v, 2, 2, ['x', 'y'])).toBe(a);
    expect(await datasetChecksum(v, 2, 2, ['x', 'z'])).not.toBe(a);
    expect(await datasetChecksum(Float32Array.from([1, 2, 3, 5]), 2, 2, ['x', 'y'])).not.toBe(a);
  });
});

describe('preprocessing', () => {
  const values = Float32Array.from([1, 10, 2, 20, 3, 30, 4, 40]);
  it('centres and standardises with ddof = 1', () => {
    const r = preprocess(values, 4, 2, {
      center: true,
      standardize: true,
      l2Normalize: false,
      subsample: null,
    });
    for (let t = 0; t < 2; t++) {
      const col = [0, 1, 2, 3].map((i) => r.data[i * 2 + t]!);
      const mean = col.reduce((s, v) => s + v, 0) / 4;
      const sd = Math.sqrt(col.reduce((s, v) => s + (v - mean) ** 2, 0) / 3);
      expect(mean).toBeCloseTo(0, 12);
      expect(sd).toBeCloseTo(1, 12);
    }
  });
  it('L2-normalises rows and reports constant features', () => {
    const r = preprocess(Float32Array.from([3, 4, 1, 4, 0, 4]), 3, 2, {
      center: false,
      standardize: true,
      l2Normalize: false,
      subsample: null,
    });
    expect(r.constantFeatures).toBe(1);
    const l2 = preprocess(Float32Array.from([3, 4]), 1, 2, {
      center: false,
      standardize: false,
      l2Normalize: true,
      subsample: null,
    });
    expect(Array.from(l2.data)).toEqual([0.6, 0.8].map((v) => expect.closeTo(v, 6)));
  });
  it('subsamples deterministically and records the rows', () => {
    const a = subsampleIndices(100, { size: 10, seed: 3 });
    expect(a).toEqual(subsampleIndices(100, { size: 10, seed: 3 }));
    expect(subsampleIndices(5, { size: 10, seed: 3 })).toBeNull();
    const r = preprocess(new Float32Array(200), 100, 2, {
      center: false,
      standardize: false,
      l2Normalize: false,
      subsample: { size: 10, seed: 3 },
    });
    expect(r.n).toBe(10);
    expect(Array.from(r.rowIndices!)).toEqual(Array.from(a!));
  });
});

describe('nearest neighbours', () => {
  it('finds exact neighbours with deterministic tie-breaking', () => {
    const data = Float64Array.from([0, 0, 1, 0, 2, 0, 10, 0]);
    const g = exactKnn(data, 4, 2, 2);
    expect(Array.from(g.indices.subarray(0, 2))).toEqual([1, 2]);
    expect(Array.from(g.indices.subarray(2, 4))).toEqual([0, 2]); // tie between 0 and 2 → lower index first
    expect(Array.from(g.distances.subarray(0, 2))).toEqual([1, 2]);
    expect(() => exactKnn(data, 4, 2, 4)).toThrow();
  });
  it('supports cosine distance', () => {
    const data = Float64Array.from([1, 0, 0.9, 0.1, 0, 1]);
    const nn = nearestTo(data, 3, 2, 0, 2, 'cosine');
    expect(nn[0]!.index).toBe(1);
    expect(nn[1]!.distance).toBeCloseTo(1, 12);
  });
  it('inspector neighbours reproduce neighbours of the explicitly preprocessed matrix', () => {
    const rng = createRng(9);
    const rows = Array.from({ length: 40 }, () => Array.from({ length: 5 }, () => rng() * (1 + rng() * 10)));
    const ds = makeDataset(rows);
    const config = { center: true, standardize: true, l2Normalize: true, subsample: null };
    const pre = preprocess(ds.values, ds.n, ds.d, config);
    const viaGeometry = featureNeighbors(ds, featureGeometry(ds, config), 7, 6, 'euclidean', null).map(
      (x) => x.row,
    );
    const reference = nearestTo(pre.data, ds.n, ds.d, 7, 6).map((x) => x.index);
    expect(viaGeometry).toEqual(reference);
  });
});

describe('ranks', () => {
  it('averages tied ranks like scipy.stats.rankdata', () => {
    expect(Array.from(averageRanks([10, 20, 20, 5]))).toEqual([2, 3.5, 3.5, 1]);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 12);
  });
});

describe('visualization geometry', () => {
  it('normalises coordinates into [−1, 1] keeping aspect ratio', () => {
    const n = normalizeCoords(Float32Array.from([0, 0, 10, 2, 5, 1]), 2);
    expect(n.scale).toBe(5);
    expect(n.positions[0]).toBe(-1);
    expect(n.positions[3]).toBe(1); // x of (10, 2)
    expect(n.positions[4]).toBeCloseTo(0.2, 6); // y of (10, 2)
  });
  it('tests polygon membership and produces nice ticks', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(11, 5, square)).toBe(false);
    expect(niceTicks(0, 1, 5)).toEqual(
      [0, 0.2, 0.4, 0.6000000000000001, 0.8, 1].map((v) => expect.closeTo(v, 9)),
    );
  });
});

describe('colour mapping', () => {
  const ds = makeDataset([[0], [1], [2], [3]], undefined, ['b', 'a', 'b', null as unknown as string]);
  it('maps categories in sorted order with a separate missing category', () => {
    const m = computeColorMapping(ds, defaultColorBy(ds), [], 'okabe-ito', 'viridis');
    expect(m.mode).toBe('categorical');
    expect(m.categories.map((c) => c.label)).toEqual(['a', 'b', 'missing']);
    expect(Array.from(m.categoryIndex)).toEqual([1, 0, 1, 2]);
  });
  it('maps numeric columns through the sequential palette', () => {
    const numeric: Dataset = {
      ...ds,
      columns: [{ name: 'v', role: 'custom', kind: 'numeric', values: [0, 5, 10, null] }],
    };
    const m = computeColorMapping(numeric, { type: 'column', name: 'v' }, [], 'okabe-ito', 'viridis');
    expect(m.numericRange).toEqual([0, 10]);
    expect(m.missingCount).toBe(1);
    expect(Array.from(m.colors.subarray(0, 3))).toEqual(
      sequentialColor('viridis', 0).map((v) => expect.closeTo(v, 6)),
    );
  });
  it('generates distinct colours beyond the palette length', () => {
    expect(categoricalColor('okabe-ito', 100)).not.toBe(categoricalColor('okabe-ito', 101));
  });
});

describe('demo generators', () => {
  it('are deterministic per seed and have the documented shapes', () => {
    const spec = {
      kind: 'gaussian-clusters' as const,
      clusters: 3,
      dimensions: 4,
      pointsPerCluster: 5,
      separation: 8,
      noise: 1,
      seed: 1,
    };
    const g = gaussianClusters(spec);
    expect(g.n).toBe(15);
    expect(g.d).toBe(4);
    expect(Array.from(g.values)).toEqual(Array.from(gaussianClusters(spec).values));
    expect(swissRoll({ kind: 'swiss-roll', points: 50, noise: 0, seed: 2 }).d).toBe(3);
    const a = multimodal({ kind: 'multimodal', modality: 'a', seed: 3 });
    const b = multimodal({ kind: 'multimodal', modality: 'b', seed: 3 });
    expect(a.ids).toEqual(b.ids);
    expect(a.columns[0]!.values).toEqual(b.columns[0]!.values);
    expect([a.d, b.d]).toEqual([64, 120]);
  });
  it('round-trips demo dataset ids to specifications', () => {
    const specs = [
      {
        kind: 'gaussian-clusters' as const,
        clusters: 6,
        dimensions: 20,
        pointsPerCluster: 150,
        separation: 12.5,
        noise: 0.5,
        seed: 7,
      },
      { kind: 'swiss-roll' as const, points: 1500, noise: 0.4, seed: 3 },
      { kind: 'multimodal' as const, modality: 'b' as const, seed: 11 },
      { kind: 'static' as const, demo: 'digits' as const },
    ];
    for (const s of specs) expect(demoSpecFromId(demoDatasetId(s))).toEqual(s);
  });
});

describe('correspondence', () => {
  it('matches by identifier and never silently by position', () => {
    const a = makeDataset([[1], [2], [3]], ['x', 'y', 'z']);
    const b = makeDataset([[9], [8], [7], [6]], ['z', 'q', 'x', 'w']);
    const m = matchById(a, b);
    expect(Array.from(m.rowsA)).toEqual([0, 2]);
    expect(Array.from(m.rowsB)).toEqual([2, 0]);
    expect(m.unmatchedA).toEqual(['y']);
    expect(m.unmatchedB).toEqual(['q', 'w']);
    expect(() => matchByOrder(a, b)).toThrow(/equal sizes/);
  });
});

describe('formatting', () => {
  it('formats numbers and byte sizes', () => {
    expect(formatNumber(0.123456, 3)).toBe('0.123');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(1e-5, 3)).toBe('1.00e-5');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});
