import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProjection } from '@/workers/handlers';
import { neighborhoodMetrics } from '@/algorithms/metrics/neighborhood';
import { DEFAULT_PREPROCESSING } from '@/algorithms/preprocessing/preprocess';
import { TSNE_DEFAULTS } from '@/algorithms/tsne/tsne';
import { UMAP_DEFAULTS } from '@/algorithms/umap/umap';
import type { AlgorithmParams } from '@/types/algorithms';
import { loadFixture } from './helpers';

/**
 * Benchmark behaviour on the bundled Digits dataset (1 797 × 64). Coordinates of stochastic
 * methods are not comparable across implementations, so we compare neighbourhood quality
 * (trustworthiness, k = 10) with scikit-learn's t-SNE and Python umap-learn on the same data.
 */
const ref = loadFixture<{
  k: number;
  pcaTrustworthiness: number;
  tsneTrustworthiness: number[];
  umapTrustworthiness?: number[];
}>('benchmark');
const digits = JSON.parse(readFileSync(resolve(__dirname, '../../public/datasets/digits.json'), 'utf8')) as {
  n: number;
  d: number;
  values: number[];
};
const values = Float32Array.from(digits.values);
const x = Float64Array.from(digits.values);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

function trust(params: AlgorithmParams): number {
  const res = runProjection(
    {
      kind: 'project',
      values,
      n: digits.n,
      d: digits.d,
      params,
      preprocessing: DEFAULT_PREPROCESSING,
      outputDims: 2,
      previewEvery: 0,
    },
    () => {},
  );
  return neighborhoodMetrics(x, digits.d, Float64Array.from(res.coords), 2, digits.n, ref.k, null)
    .trustworthiness;
}

describe('Digits benchmark against reference implementations', () => {
  it('PCA trustworthiness matches scikit-learn (deterministic method)', () => {
    // Digits features are integers, so many pairwise distances tie exactly. Ranks among tied
    // points depend on the sort's tie order (scikit-learn: argsort; LatentScope: by index), which
    // moves trustworthiness by a few parts in 10⁶ — far below any meaningful difference.
    expect(
      Math.abs(trust({ algorithm: 'pca', solver: 'auto', seed: 0 }) - ref.pcaTrustworthiness),
    ).toBeLessThan(1e-5);
  });

  it('t-SNE (Barnes–Hut) reaches scikit-learn-level neighbourhood quality', { timeout: 300_000 }, () => {
    const t = trust({ ...TSNE_DEFAULTS, seed: 42 });
    expect(Math.abs(t - mean(ref.tsneTrustworthiness))).toBeLessThan(0.005);
  });

  it.runIf(ref.umapTrustworthiness !== undefined)(
    'UMAP (umap-js) reaches umap-learn-level neighbourhood quality',
    { timeout: 300_000 },
    () => {
      const t = trust({ ...UMAP_DEFAULTS, seed: 42 });
      expect(Math.abs(t - mean(ref.umapTrustworthiness!))).toBeLessThan(0.01);
    },
  );
});
