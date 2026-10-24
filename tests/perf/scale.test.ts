// Manual timing probe (not part of the default suite): npx vitest run tests/perf --config vitest.perf.config.ts
import { it } from 'vitest';
import { runProjection, runMetrics } from '@/workers/handlers';
import { gaussianClusters } from '@/services/datasets/generators';
import { DEFAULT_PREPROCESSING } from '@/algorithms/preprocessing/preprocess';
import { TSNE_DEFAULTS } from '@/algorithms/tsne/tsne';
import { UMAP_DEFAULTS } from '@/algorithms/umap/umap';

const g = gaussianClusters({
  kind: 'gaussian-clusters',
  clusters: 10,
  dimensions: 50,
  pointsPerCluster: 1000,
  separation: 12,
  noise: 1,
  seed: 1,
});
const noop = () => {};
for (const [name, params] of [
  ['pca', { algorithm: 'pca', solver: 'auto', seed: 0 }],
  ['tsne', { ...TSNE_DEFAULTS }],
  ['umap', { ...UMAP_DEFAULTS }],
] as const) {
  it(`${name} on 10 000 × 50`, { timeout: 900_000 }, () => {
    const t0 = performance.now();
    const r = runProjection(
      {
        kind: 'project',
        values: g.values,
        n: g.n,
        d: g.d,
        params,
        preprocessing: DEFAULT_PREPROCESSING,
        outputDims: 2,
        previewEvery: 0,
      },
      noop,
    );
    const t1 = performance.now();
    const m = runMetrics(
      {
        kind: 'metrics',
        values: g.values,
        n: g.n,
        d: g.d,
        preprocessing: DEFAULT_PREPROCESSING,
        rowIndices: null,
        coords: r.coords,
        dims: 2,
        labels: null,
        labelColumn: null,
        options: { k: 10, maxQueries: 5000, maxSilhouette: 2000, distancePairs: 20000, seed: 0 },
      },
      noop,
    );
    console.log(
      `${name}: projection ${((t1 - t0) / 1000).toFixed(1)} s, metrics ${(m.metrics.runtimeMs / 1000).toFixed(1)} s (${m.metrics.trustworthiness?.sampleSize} queries), T=${m.metrics.trustworthiness?.value.toFixed(4)}`,
    );
  });
}
