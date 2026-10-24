// Runs in Node: typed arrays stored through fake-indexeddb must share Node's realm.
// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest';
import { extractDelimited, previewDelimited } from '@/services/import/table';
import { finalizeDataset } from '@/services/import/finalize';
import { runClustering, runComparison, runMetrics, runProjection } from '@/workers/handlers';
import { coordinatesCsv } from '@/services/export/csv';
import { buildSession, validateSession } from '@/services/export/session';
import { loadDemo } from '@/services/datasets/demos';
import { gaussianClusters } from '@/services/datasets/generators';
import { datasetRepo, experimentRepo, clearAllLocalData } from '@/services/persistence/db';
import { encodeLabels } from '@/algorithms/metrics/silhouette';
import { adjustedRandIndex } from '@/algorithms/clustering/agreement';
import { DEFAULT_VISUALS } from '@/stores/viewStore';
import { DEFAULT_PREPROCESSING } from '@/algorithms/preprocessing/preprocess';
import { TSNE_DEFAULTS } from '@/algorithms/tsne/tsne';
import { UMAP_DEFAULTS } from '@/algorithms/umap/umap';
import type { Experiment } from '@/types/experiment';
import type { JobProgress } from '@/workers/protocol';
import { APP_VERSION } from '@/utils/misc';

function csvFromGenerated() {
  const g = gaussianClusters({
    kind: 'gaussian-clusters',
    clusters: 3,
    dimensions: 6,
    pointsPerCluster: 40,
    separation: 14,
    noise: 1,
    seed: 2,
  });
  const header = ['sample', 'class', ...g.featureNames].join(',');
  const rows = g.ids.map((id, i) =>
    [id, g.columns[0]!.values[i], ...Array.from(g.values.subarray(i * g.d, (i + 1) * g.d))].join(','),
  );
  return { csv: `${header}\n${rows.join('\n')}\n`, g };
}

const noop = (_p: JobProgress) => {};

describe('upload → parse → project → metrics → export', () => {
  it('runs the complete pipeline on an uploaded CSV', async () => {
    const { csv, g } = csvFromGenerated();
    const preview = await previewDelimited(csv, 'blobs.csv', 'csv');
    const assignments = Object.fromEntries(preview.inferred.map((c) => [c.name, c.suggestedRole]));
    expect(assignments).toMatchObject({ class: 'label' });
    assignments.sample = 'id';
    assignments.class = 'label';
    const data = await extractDelimited(csv, 'csv', preview.columns, {
      hasHeader: true,
      assignments,
      kinds: { class: 'categorical' },
    });
    const { dataset } = await finalizeDataset(data, {
      name: 'blobs',
      missingPolicy: 'reject',
      idStrategy: 'column',
      source: { type: 'upload', fileName: 'blobs.csv', format: 'csv' },
    });
    expect(dataset!.n).toBe(120);
    expect(Array.from(dataset!.values)).toEqual(Array.from(g.values));

    const progress: JobProgress[] = [];
    const result = runProjection(
      {
        kind: 'project',
        values: dataset!.values,
        n: 120,
        d: 6,
        params: { ...UMAP_DEFAULTS, nEpochs: 200 },
        preprocessing: DEFAULT_PREPROCESSING,
        outputDims: 2,
        previewEvery: 50,
      },
      (p) => progress.push(p),
    );
    expect(result.coords.length).toBe(240);
    expect(progress.some((p) => p.preview)).toBe(true);
    expect(
      progress.filter((p) => p.fraction !== null).every((p) => p.fraction! >= 0 && p.fraction! <= 1),
    ).toBe(true);

    const { codes, valid } = encodeLabels(dataset!.columns[0]!.values);
    const labels = new Int32Array(120).fill(-1);
    valid.forEach((r, t) => (labels[r] = codes[t]!));
    const metrics = runMetrics(
      {
        kind: 'metrics',
        values: dataset!.values,
        n: 120,
        d: 6,
        preprocessing: DEFAULT_PREPROCESSING,
        rowIndices: null,
        coords: result.coords,
        dims: 2,
        labels,
        labelColumn: 'class',
        options: { k: 10, maxQueries: 1000, maxSilhouette: 1000, distancePairs: 5000, seed: 0 },
      },
      noop,
    ).metrics;
    expect(metrics.trustworthiness!.approximate).toBe(false);
    expect(metrics.trustworthiness!.value).toBeGreaterThan(0.9);
    expect(metrics.silhouetteOriginal!.value).toBeGreaterThan(0.5);

    const experiment: Experiment = {
      id: 'e1',
      name: 'UMAP',
      datasetId: dataset!.id,
      datasetName: dataset!.name,
      datasetChecksum: dataset!.checksum,
      algorithm: 'umap',
      implementation: { name: 'umap-js', version: '1.4.0' },
      params: { ...UMAP_DEFAULTS, nEpochs: 200 },
      preprocessing: DEFAULT_PREPROCESSING,
      outputDims: 2,
      rowIndices: null,
      coords: result.coords,
      diagnostics: result.diagnostics,
      metrics,
      runtimeMs: result.runtimeMs,
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      environment: 'test',
    };
    const lines = coordinatesCsv(dataset!, experiment, { metadataColumns: ['class'] })
      .trim()
      .split('\n');
    expect(lines).toHaveLength(121);
    expect(lines[1]!.startsWith(`${dataset!.ids[0]},`)).toBe(true);
    const session = validateSession(
      JSON.parse(
        JSON.stringify(
          buildSession(
            experiment,
            dataset!,
            {
              visuals: DEFAULT_VISUALS,
              colorBy: { type: 'none' },
              hidden: [],
              selection: { ids: [] },
              camera: null,
            },
            false,
            [],
          ),
        ),
      ),
    );
    expect(session.experiment.metrics!.trustworthiness!.value).toBe(metrics.trustworthiness!.value);
  });

  it('subsampling is explicit, recorded and reproducible', () => {
    const { g } = csvFromGenerated();
    const run = () =>
      runProjection(
        {
          kind: 'project',
          values: g.values,
          n: g.n,
          d: g.d,
          params: { ...TSNE_DEFAULTS, perplexity: 10, iterations: 300, seed: 5 },
          preprocessing: { ...DEFAULT_PREPROCESSING, subsample: { size: 60, seed: 1 } },
          outputDims: 2,
          previewEvery: 0,
        },
        noop,
      );
    const a = run();
    const b = run();
    expect(a.rowIndices!.length).toBe(60);
    expect(Array.from(a.coords)).toEqual(Array.from(b.coords));
  });

  it('clusters in the original space and recovers well-separated groups', () => {
    const { g } = csvFromGenerated();
    const res = runClustering(
      {
        kind: 'cluster',
        values: g.values,
        n: g.n,
        d: g.d,
        preprocessing: DEFAULT_PREPROCESSING,
        method: 'kmeans',
        params: { k: 3, nInit: 4 },
        seed: 0,
      },
      noop,
    );
    const truth = (g.columns[0]!.values as string[]).map((v) => Number(v.split(' ')[1]));
    expect(adjustedRandIndex(res.assignments, truth)).toBe(1);
  });

  it('compares two representations of the same observations', () => {
    const { g } = csvFromGenerated();
    const rotated = new Float32Array(g.values.length);
    for (let i = 0; i < g.n; i++)
      for (let t = 0; t < g.d; t++) rotated[i * g.d + t] = g.values[i * g.d + ((t + 1) % g.d)]! * 2;
    const res = runComparison(
      {
        kind: 'compare',
        a: g.values,
        da: g.d,
        b: rotated,
        db: g.d,
        n: g.n,
        labels: null,
        standardize: false,
        k: 10,
        maxQueries: 500,
        rsaSample: 500,
        rsaMetric: 'euclidean',
        clusterK: 3,
        seed: 0,
      },
      noop,
    ).comparison;
    // A coordinate permutation with uniform scaling is an orthogonal transform: CKA = 1, RSA = 1.
    expect(res.cka!.value).toBeCloseTo(1, 9);
    expect(res.rsa!.value).toBeCloseTo(1, 9);
    expect(res.knnAgreement!.value).toBe(1);
    expect(res.clusterAgreement!.ariAB).toBe(1);
  });
});

describe('demonstration datasets', () => {
  it('generates synthetic demos with provenance and stable checksums', async () => {
    const a = await loadDemo({ kind: 'swiss-roll', points: 300, noise: 0.2, seed: 9 });
    const b = await loadDemo({ kind: 'swiss-roll', points: 300, noise: 0.2, seed: 9 });
    expect(a.checksum).toBe(b.checksum);
    expect(a.provenance!.synthetic).toBe(true);
    expect(a.columns.map((c) => c.name)).toEqual(['position_t', 'segment']);
  });
});

describe('local persistence (IndexedDB)', () => {
  beforeEach(async () => clearAllLocalData());

  it('saves, lists, renames, reopens and deletes datasets', async () => {
    const ds = await loadDemo({
      kind: 'gaussian-clusters',
      clusters: 2,
      dimensions: 3,
      pointsPerCluster: 5,
      separation: 5,
      noise: 1,
      seed: 1,
    });
    await datasetRepo.save(ds);
    expect((await datasetRepo.list()).map((d) => d.name)).toEqual([ds.name]);
    await datasetRepo.rename(ds.id, 'Renamed');
    const reopened = await datasetRepo.get(ds.id);
    expect(reopened!.name).toBe('Renamed');
    expect(Array.from(reopened!.values)).toEqual(Array.from(ds.values));
    expect((await datasetRepo.findByChecksum(ds.checksum))!.id).toBe(ds.id);
    await datasetRepo.remove(ds.id);
    expect(await datasetRepo.list()).toEqual([]);
  });

  it('persists experiments with typed-array payloads', async () => {
    const experiment = {
      id: 'x',
      createdAt: '2026-01-02',
      coords: Float32Array.from([1, 2]),
      rowIndices: Uint32Array.from([4]),
    } as unknown as Experiment;
    await experimentRepo.save(experiment);
    const [loaded] = await experimentRepo.list();
    expect(loaded!.coords).toBeInstanceOf(Float32Array);
    expect(Array.from(loaded!.rowIndices!)).toEqual([4]);
    await experimentRepo.remove('x');
    expect(await experimentRepo.list()).toEqual([]);
  });
});
