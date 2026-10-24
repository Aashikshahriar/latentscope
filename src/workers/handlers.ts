/**
 * Job handlers executed inside the compute worker. They are plain functions so that integration
 * tests can run them directly, and the worker entry point stays a thin message adapter.
 */
import { preprocess } from '@/algorithms/preprocessing/preprocess';
import { pcaCentered } from '@/algorithms/pca/pca';
import { TSNE } from '@/algorithms/tsne/tsne';
import { initializeUmap, embeddingToFloat32 } from '@/algorithms/umap/umap';
import { neighborhoodMetrics, validateNeighborhoodK } from '@/algorithms/metrics/neighborhood';
import { distanceCorrelation } from '@/algorithms/metrics/distances';
import { silhouetteScore } from '@/algorithms/metrics/silhouette';
import { knnAccuracy, knnAgreement, linearCka, rsa } from '@/algorithms/metrics/representation';
import { kmeans } from '@/algorithms/clustering/kmeans';
import { adjustedRandIndex } from '@/algorithms/clustering/agreement';
import { dbscan } from '@/algorithms/clustering/dbscan';
import { cutTree, linkageTree, type Linkage } from '@/algorithms/clustering/hierarchical';
import { selectRows } from '@/algorithms/linalg/matrix';
import type { MetricValue, QualityMetrics } from '@/types/metrics';
import { createRng, sampleWithoutReplacement } from '@/utils/rng';
import type {
  ClusterRequest,
  ClusterResult,
  CompareRequest,
  CompareResult,
  JobProgress,
  MetricsRequest,
  MetricsResult,
  ProjectRequest,
  ProjectResult,
} from './protocol';

export type ProgressSink = (progress: JobProgress) => void;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Rate-limits progress messages to roughly ten per second (previews are always delivered). */
function throttled(sink: ProgressSink): ProgressSink {
  let last = -Infinity;
  return (p) => {
    const t = now();
    if (p.preview || t - last > 100 || p.fraction === 1) {
      last = t;
      sink(p);
    }
  };
}

export function runProjection(req: ProjectRequest, post: ProgressSink): ProjectResult {
  const start = now();
  const send = throttled(post);
  const { params, outputDims: dims } = req;
  // PCA is defined on centred data, so centring is always applied for PCA.
  const preprocessing =
    params.algorithm === 'pca' ? { ...req.preprocessing, center: true } : req.preprocessing;
  send({ stage: 'Preprocessing', fraction: null });
  const pre = preprocess(req.values, req.n, req.d, preprocessing);
  const { data, n, d } = pre;

  if (params.algorithm === 'pca') {
    const { scores, diagnostics } = pcaCentered(data, n, d, {
      outputDims: dims,
      maxComponents: Math.min(d, 20),
      solver: params.solver,
      seed: params.seed,
      onStage: (stage) => send({ stage, fraction: null }),
    });
    return {
      kind: 'project',
      coords: Float32Array.from(scores),
      dims,
      rowIndices: pre.rowIndices,
      diagnostics,
      preprocessingWarnings: pre.warnings,
      runtimeMs: now() - start,
    };
  }

  if (params.algorithm === 'tsne') {
    const tsne = new TSNE(data, n, d, dims, params, (stage, fraction) => send({ stage, fraction }));
    const total = tsne.totalIterations;
    while (!tsne.done) {
      const computeError = tsne.iteration % 50 === 49 || tsne.iteration === total - 1;
      tsne.step(computeError);
      const it = tsne.iteration;
      const preview =
        req.previewEvery > 0 && it % req.previewEvery === 0 ? Float32Array.from(tsne.y) : undefined;
      send({
        stage: tsne.phase === 'exaggeration' ? 'Optimising (early exaggeration)' : 'Optimising',
        fraction: it / total,
        iteration: it,
        total,
        kl: tsne.lastKl,
        preview,
      });
    }
    return {
      kind: 'project',
      coords: Float32Array.from(tsne.y),
      dims,
      rowIndices: pre.rowIndices,
      diagnostics: tsne.diagnostics(),
      preprocessingWarnings: pre.warnings,
      runtimeMs: now() - start,
    };
  }

  const { umap, nEpochs, knnMethod } = initializeUmap(data, n, d, dims, params, (stage, fraction) =>
    send({ stage, fraction }),
  );
  for (let epoch = 0; epoch < nEpochs; epoch++) {
    umap.step();
    const it = epoch + 1;
    const preview =
      req.previewEvery > 0 && it % req.previewEvery === 0
        ? embeddingToFloat32(umap.getEmbedding(), dims)
        : undefined;
    send({ stage: 'Optimising layout', fraction: it / nEpochs, iteration: it, total: nEpochs, preview });
  }
  return {
    kind: 'project',
    coords: embeddingToFloat32(umap.getEmbedding(), dims),
    dims,
    rowIndices: pre.rowIndices,
    diagnostics: { kind: 'umap', knnMethod, epochs: nEpochs, warnings: [] },
    preprocessingWarnings: pre.warnings,
    runtimeMs: now() - start,
  };
}

/** Number of query points that keeps neighbourhood metrics within a fixed operation budget. */
export function metricQueryCount(n: number, d: number, requested: number): number {
  const budget = 4e9; // multiply-adds; a few seconds in a modern browser worker
  const perQuery = n * (d + 3) + n * 20;
  return Math.max(Math.min(50, n), Math.min(n, requested, Math.floor(budget / perQuery)));
}

function metricValue(
  value: number,
  sampleSize: number,
  population: number,
  seed: number | null,
  note?: string,
): MetricValue {
  return { value, approximate: sampleSize < population, sampleSize, population, seed, note };
}

export function runMetrics(req: MetricsRequest, post: ProgressSink): MetricsResult {
  const start = now();
  const send = throttled(post);
  const { options, dims } = req;
  const warnings: string[] = [];
  send({ stage: 'Preparing original space', fraction: null });
  const pre = preprocess(req.values, req.n, req.d, { ...req.preprocessing, subsample: null }, req.rowIndices);
  const x = pre.data;
  const n = pre.n;
  const z = Float64Array.from(req.coords);
  const k = options.k;

  let trust: MetricValue | null = null;
  let continuity: MetricValue | null = null;
  let preservation: MetricValue | null = null;
  const kError = validateNeighborhoodK(k, n);
  if (kError) warnings.push(`Neighbourhood metrics skipped: ${kError}`);
  else {
    const m = metricQueryCount(n, pre.d, options.maxQueries);
    const queries = m < n ? sampleWithoutReplacement(n, m, createRng(options.seed)) : null;
    const res = neighborhoodMetrics(x, pre.d, z, dims, n, k, queries, (f) =>
      send({ stage: `Neighbourhood metrics (k = ${k})`, fraction: f * 0.7 }),
    );
    const note = queries ? `Averaged over ${m} seeded query points; ranks use all ${n} points.` : undefined;
    trust = metricValue(res.trustworthiness, m, n, queries ? options.seed : null, note);
    continuity = metricValue(res.continuity, m, n, queries ? options.seed : null, note);
    preservation = metricValue(res.preservation, m, n, queries ? options.seed : null, note);
  }

  let distCorr: MetricValue | null = null;
  let shepard: { a: number; b: number }[] = [];
  if (n >= 3) {
    send({ stage: 'Distance correlation', fraction: 0.75 });
    const dc = distanceCorrelation(x, pre.d, z, dims, n, options.distancePairs, options.seed + 1);
    const totalPairs = (n * (n - 1)) / 2;
    distCorr = metricValue(
      dc.spearman,
      dc.pairs,
      totalPairs,
      dc.pairs < totalPairs ? options.seed + 1 : null,
      `Pearson r = ${dc.pearson.toFixed(4)}`,
    );
    shepard = dc.sample;
  }

  let silOriginal: MetricValue | null = null;
  let silProjected: MetricValue | null = null;
  if (req.labels) {
    const rowLabels = new Int32Array(n);
    for (let i = 0; i < n; i++) rowLabels[i] = req.labels[req.rowIndices ? req.rowIndices[i]! : i]!;
    const valid: number[] = [];
    for (let i = 0; i < n; i++) if (rowLabels[i]! >= 0) valid.push(i);
    const distinct = new Set(valid.map((i) => rowLabels[i]!)).size;
    if (distinct < 2 || distinct > valid.length - 1) {
      warnings.push(`Silhouette skipped: needs between 2 and N − 1 distinct labels (found ${distinct}).`);
    } else {
      send({ stage: 'Silhouette scores', fraction: 0.85 });
      let rows = Uint32Array.from(valid);
      const m = Math.min(rows.length, options.maxSilhouette);
      if (m < rows.length) {
        const pick = sampleWithoutReplacement(rows.length, m, createRng(options.seed + 2));
        rows = Uint32Array.from(pick, (p) => rows[p]!);
      }
      const labels = Int32Array.from(rows, (r) => rowLabels[r]!);
      const subsetDistinct = new Set(labels).size;
      if (subsetDistinct >= 2 && subsetDistinct <= m - 1) {
        const note =
          m < valid.length ? `Computed on a seeded subset of ${m} labelled observations.` : undefined;
        const seed = m < valid.length ? options.seed + 2 : null;
        silOriginal = metricValue(
          silhouetteScore(selectRows(x, pre.d, rows), m, pre.d, labels),
          m,
          valid.length,
          seed,
          note,
        );
        silProjected = metricValue(
          silhouetteScore(selectRows(z, dims, rows), m, dims, labels),
          m,
          valid.length,
          seed,
          note,
        );
      }
    }
  }

  const metrics: QualityMetrics = {
    k,
    trustworthiness: trust,
    continuity,
    neighborhoodPreservation: preservation,
    distanceCorrelation: distCorr,
    silhouetteOriginal: silOriginal,
    silhouetteProjected: silProjected,
    silhouetteLabelColumn: req.labelColumn,
    computedAt: new Date().toISOString(),
    runtimeMs: now() - start,
    warnings,
  };
  send({ stage: 'Done', fraction: 1 });
  return { kind: 'metrics', metrics, shepard };
}

export function runClustering(req: ClusterRequest, post: ProgressSink): ClusterResult {
  const send = throttled(post);
  const data = req.preprocessing
    ? preprocess(req.values, req.n, req.d, { ...req.preprocessing, subsample: null }).data
    : Float64Array.from(req.values);
  const { n, d } = req;
  if (req.method === 'kmeans') {
    const k = Number(req.params.k);
    const res = kmeans(data, n, d, {
      k,
      seed: req.seed,
      nInit: Number(req.params.nInit ?? 4),
      onProgress: (f) => send({ stage: 'k-means', fraction: f }),
    });
    return {
      kind: 'cluster',
      assignments: res.labels,
      clusterCount: k,
      summary: `k-means, k = ${k}, inertia ${res.inertia.toPrecision(5)}, ${res.iterations} iterations (best of ${req.params.nInit ?? 4} seeded restarts).`,
    };
  }
  if (req.method === 'dbscan') {
    const eps = Number(req.params.eps);
    const minSamples = Number(req.params.minSamples);
    const res = dbscan(data, n, d, {
      eps,
      minSamples,
      onProgress: (f) => send({ stage: 'DBSCAN', fraction: f }),
    });
    return {
      kind: 'cluster',
      assignments: res.labels,
      clusterCount: res.clusterCount,
      summary: `DBSCAN, ε = ${eps}, min samples = ${minSamples}: ${res.clusterCount} clusters, ${res.noiseCount} noise points, ${res.coreCount} core points.`,
    };
  }
  const linkage = String(req.params.linkage) as Linkage;
  const k = Number(req.params.k);
  send({ stage: `Agglomerative clustering (${linkage})`, fraction: null });
  const merges = linkageTree(data, n, d, linkage, (f) =>
    send({ stage: `Agglomerative clustering (${linkage})`, fraction: f }),
  );
  return {
    kind: 'cluster',
    assignments: cutTree(merges, n, k),
    clusterCount: k,
    summary: `Agglomerative clustering, ${linkage} linkage, cut at ${k} clusters.`,
  };
}

function standardizeInPlace(x: Float64Array, n: number, d: number, scale: boolean): void {
  for (let t = 0; t < d; t++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i * d + t]!;
    mean /= n;
    let sd = 1;
    if (scale) {
      let v = 0;
      for (let i = 0; i < n; i++) v += (x[i * d + t]! - mean) ** 2;
      sd = n > 1 ? Math.sqrt(v / (n - 1)) : 0;
      if (!(sd > 0)) sd = 1;
    }
    for (let i = 0; i < n; i++) x[i * d + t] = (x[i * d + t]! - mean) / sd;
  }
}

export function runComparison(req: CompareRequest, post: ProgressSink): CompareResult {
  const start = now();
  const send = throttled(post);
  const { n, da, db, k } = req;
  const warnings: string[] = [];
  const a = Float64Array.from(req.a);
  const b = Float64Array.from(req.b);
  standardizeInPlace(a, n, da, req.standardize);
  standardizeInPlace(b, n, db, req.standardize);

  send({ stage: 'Linear CKA', fraction: 0.05 });
  const cka = metricValue(linearCka(a, da, b, db, n), n, n, null);

  send({ stage: 'Representational similarity analysis', fraction: 0.3 });
  const m = Math.min(n, req.rsaSample);
  const rsaRows = m < n ? sampleWithoutReplacement(n, m, createRng(req.seed)) : null;
  const subA = rsaRows ? selectRows(a, da, rsaRows) : a;
  const subB = rsaRows ? selectRows(b, db, rsaRows) : b;
  const rsaValue = metricValue(
    rsa(subA, da, subB, db, m, req.rsaMetric),
    (m * (m - 1)) / 2,
    (n * (n - 1)) / 2,
    rsaRows ? req.seed : null,
    `Spearman correlation of ${req.rsaMetric} RDMs over ${m} observations.`,
  );

  // Sampled distance pairs for the pairwise-similarity scatter plot (from the RDM subset).
  const pairs: { a: number; b: number }[] = [];
  const dist = (x: Float64Array, d: number, i: number, j: number) => {
    let s = 0;
    for (let t = 0; t < d; t++) s += (x[i * d + t]! - x[j * d + t]!) ** 2;
    return Math.sqrt(s);
  };
  const rng = createRng(req.seed + 7);
  for (let p = 0; p < Math.min(1500, (n * (n - 1)) / 2); p++) {
    const i = Math.floor(rng() * n);
    let j = Math.floor(rng() * (n - 1));
    if (j >= i) j++;
    pairs.push({ a: dist(a, da, i, j), b: dist(b, db, i, j) });
  }
  const pa = pairs.map((p) => p.a);
  const pb = pairs.map((p) => p.b);
  const meanA = pa.reduce((s, v) => s + v, 0) / pa.length;
  const meanB = pb.reduce((s, v) => s + v, 0) / pb.length;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let t = 0; t < pa.length; t++) {
    sab += (pa[t]! - meanA) * (pb[t]! - meanB);
    saa += (pa[t]! - meanA) ** 2;
    sbb += (pb[t]! - meanB) ** 2;
  }

  let agreement: MetricValue | null = null;
  let accuracy: { name: string; value: MetricValue }[] | null = null;
  if (k >= n) warnings.push(`kNN metrics skipped: k = ${k} needs more than ${k} matched observations.`);
  else {
    send({ stage: `kNN agreement (k = ${k})`, fraction: 0.55 });
    const q = Math.min(n, req.maxQueries);
    const queries = q < n ? sampleWithoutReplacement(n, q, createRng(req.seed + 3)) : null;
    agreement = metricValue(knnAgreement(a, da, b, db, n, k, queries), q, n, queries ? req.seed + 3 : null);
    if (req.labels) {
      send({ stage: 'kNN classification accuracy', fraction: 0.8 });
      const labelled = Array.from(req.labels).filter((l) => l >= 0).length;
      if (labelled > k) {
        const sampleNote = queries ? 'seeded query subset' : undefined;
        accuracy = [
          {
            name: 'A',
            value: metricValue(
              knnAccuracy(a, n, da, req.labels, k, queries),
              q,
              n,
              queries ? req.seed + 3 : null,
              sampleNote,
            ),
          },
          {
            name: 'B',
            value: metricValue(
              knnAccuracy(b, n, db, req.labels, k, queries),
              q,
              n,
              queries ? req.seed + 3 : null,
              sampleNote,
            ),
          },
        ];
      }
    }
  }
  let clusterAgreement: CompareResult['comparison']['clusterAgreement'] = null;
  if (req.clusterK >= 2 && req.clusterK < n) {
    send({ stage: `k-means (k = ${req.clusterK}) in both representations`, fraction: 0.9 });
    const ka = kmeans(a, n, da, { k: req.clusterK, seed: req.seed, nInit: 3 }).labels;
    const kb = kmeans(b, n, db, { k: req.clusterK, seed: req.seed, nInit: 3 }).labels;
    let ariALabels: number | null = null;
    let ariBLabels: number | null = null;
    if (req.labels) {
      const rows = Array.from(req.labels.keys()).filter((i) => req.labels![i]! >= 0);
      if (rows.length > 1) {
        const truth = rows.map((i) => req.labels![i]!);
        ariALabels = adjustedRandIndex(
          rows.map((i) => ka[i]!),
          truth,
        );
        ariBLabels = adjustedRandIndex(
          rows.map((i) => kb[i]!),
          truth,
        );
      }
    }
    clusterAgreement = { k: req.clusterK, ariAB: adjustedRandIndex(ka, kb), ariALabels, ariBLabels };
  }

  send({ stage: 'Done', fraction: 1 });
  return {
    kind: 'compare',
    comparison: {
      matched: n,
      cka,
      rsa: rsaValue,
      knnAgreement: agreement,
      knnAccuracy: accuracy,
      distancePairs: pairs,
      distancePearson: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null,
      clusterAgreement,
      k,
      runtimeMs: now() - start,
      warnings,
    },
  };
}
