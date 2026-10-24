import type { AlgorithmId, AlgorithmParams, OutputDims, PreprocessingConfig } from '@/types/algorithms';
import type { Dataset } from '@/types/dataset';
import type { ClusteringMethod, ClusteringResult, Experiment } from '@/types/experiment';
import type { MetricsRequestOptions } from '@/types/metrics';
import { encodeLabels } from '@/algorithms/metrics/silhouette';
import { subsampleIndices } from '@/algorithms/preprocessing/preprocess';
import { validateTsneParams, TSNE_EXACT_LIMIT } from '@/algorithms/tsne/tsne';
import { UMAP_IMPLEMENTATION, validateUmapParams } from '@/algorithms/umap/umap';
import { runComputeJob, JobCancelledError } from '@/workers/client';
import { useExperimentStore } from '@/stores/experimentStore';
import { useDatasetStore } from '@/stores/datasetStore';
import { log } from '@/stores/logStore';
import { APP_VERSION, createId, environmentDescription, errorMessage } from '@/utils/misc';
import { formatDuration } from '@/utils/format';

export const ALGORITHM_LABELS: Record<AlgorithmId, string> = { pca: 'PCA', tsne: 't-SNE', umap: 'UMAP' };

export function implementationFor(algorithm: AlgorithmId): { name: string; version: string } {
  if (algorithm === 'umap') return { ...UMAP_IMPLEMENTATION };
  return { name: algorithm === 'pca' ? 'latentscope-pca' : 'latentscope-tsne', version: APP_VERSION };
}

export interface CostEstimate {
  level: 'low' | 'moderate' | 'high' | 'very-high';
  summary: string;
  detail: string;
}

/**
 * Qualitative cost tiers from operation counts. These are deliberately coarse: actual runtime
 * depends heavily on the device, so we report the scaling and a tier rather than a fake ETA.
 */
export function estimateCost(
  algorithm: AlgorithmId,
  n: number,
  d: number,
  params: AlgorithmParams,
  subsample: number | null,
): CostEstimate {
  const rows = subsample ? Math.min(n, subsample) : n;
  let ops: number;
  let detail: string;
  if (algorithm === 'pca') {
    ops = rows * d * Math.min(rows, d);
    detail = `PCA cost grows as N·D·min(N, D) ≈ ${ops.toExponential(1)} operations.`;
  } else if (algorithm === 'tsne') {
    const p = params as Extract<AlgorithmParams, { algorithm: 'tsne' }>;
    const exact = p.method === 'exact' || (p.method === 'auto' && rows <= TSNE_EXACT_LIMIT);
    const inputD = p.pcaDims > 0 ? Math.min(d, p.pcaDims) : d;
    ops = exact
      ? rows * rows * p.iterations * 6
      : rows * Math.log2(Math.max(rows, 2)) * p.iterations * 40 + rows * rows * inputD;
    detail = exact
      ? `Exact t-SNE is O(N²) per iteration: ${rows.toLocaleString()}² × ${p.iterations} iterations.`
      : `Barnes–Hut t-SNE is O(N log N) per iteration plus an O(N²·D) neighbour search.`;
  } else {
    const p = params as Extract<AlgorithmParams, { algorithm: 'umap' }>;
    const epochs = p.nEpochs || (rows <= 2500 ? 500 : rows <= 5000 ? 400 : rows <= 7500 ? 300 : 200);
    const knnExact = p.knn === 'exact' || (p.knn === 'auto' && rows <= 4000);
    ops =
      (knnExact ? rows * rows * d : rows * Math.log2(Math.max(rows, 2)) * d * 30) +
      rows * p.nNeighbors * epochs * 25;
    detail = `UMAP: ${knnExact ? 'exact O(N²·D)' : 'approximate'} neighbour search, then ${epochs} epochs over ≈ ${(rows * p.nNeighbors).toLocaleString()} edges.`;
  }
  const level: CostEstimate['level'] =
    ops < 3e8 ? 'low' : ops < 3e9 ? 'moderate' : ops < 2e10 ? 'high' : 'very-high';
  const summary = {
    low: 'Quick',
    moderate: 'A few seconds',
    high: 'Likely tens of seconds or more',
    'very-high': 'Likely minutes — consider subsampling',
  }[level];
  return { level, summary, detail };
}

export function validateRun(
  algorithm: AlgorithmId,
  params: AlgorithmParams,
  n: number,
): { errors: string[]; warnings: string[] } {
  if (algorithm === 'tsne')
    return validateTsneParams(params as Extract<AlgorithmParams, { algorithm: 'tsne' }>, n);
  if (algorithm === 'umap')
    return validateUmapParams(params as Extract<AlgorithmParams, { algorithm: 'umap' }>, n);
  return { errors: n < 2 ? ['PCA needs at least two observations.'] : [], warnings: [] };
}

export function defaultLabelColumn(dataset: Dataset): string | null {
  return (
    (
      dataset.columns.find((c) => c.role === 'label' && c.kind !== 'numeric') ??
      dataset.columns.find((c) => c.kind === 'categorical')
    )?.name ?? null
  );
}

export interface RunOptions {
  algorithm: AlgorithmId;
  params: AlgorithmParams;
  preprocessing: PreprocessingConfig;
  outputDims: OutputDims;
  name?: string;
  /** Job key; the explorer uses 'projection', the comparison view uses one per algorithm. */
  jobKey?: string;
  activate?: boolean;
  previews?: boolean;
  autoMetrics?: MetricsRequestOptions | null;
}

export async function runProjection(dataset: Dataset, options: RunOptions): Promise<Experiment | null> {
  const store = useExperimentStore.getState();
  const key = options.jobKey ?? 'projection';
  store.jobs[key]?.cancel();
  const rows = options.preprocessing.subsample
    ? Math.min(dataset.n, options.preprocessing.subsample.size)
    : dataset.n;
  const { errors } = validateRun(options.algorithm, options.params, rows);
  if (errors.length > 0) {
    log('error', `${ALGORITHM_LABELS[options.algorithm]} was not started.`, errors.join(' '));
    throw new Error(errors.join(' '));
  }
  const label = `${ALGORITHM_LABELS[options.algorithm]} on ${dataset.name}`;
  // The same seeded indices the worker will use, so live previews map onto the right rows.
  const previewRows = options.preprocessing.subsample
    ? subsampleIndices(dataset.n, options.preprocessing.subsample)
    : null;
  const job = runComputeJob(
    {
      kind: 'project',
      values: dataset.values,
      n: dataset.n,
      d: dataset.d,
      params: options.params,
      preprocessing: options.preprocessing,
      outputDims: options.outputDims,
      previewEvery:
        options.previews === false
          ? 0
          : options.algorithm === 'pca'
            ? 0
            : Math.max(5, Math.round(rows / 400)),
    },
    (progress) => {
      useExperimentStore.getState().updateJob(key, progress);
      if (progress.preview && options.activate !== false) {
        useExperimentStore.getState().setPreview({
          datasetId: dataset.id,
          coords: progress.preview,
          dims: options.outputDims,
          rowIndices: previewRows,
          iteration: progress.iteration ?? 0,
          total: progress.total ?? 0,
        });
      }
    },
  );
  store.startJob({
    key,
    kind: 'projection',
    label,
    progress: null,
    startedAt: performance.now(),
    cancel: job.cancel,
  });
  log(
    'info',
    `Started ${label}.`,
    JSON.stringify({
      params: options.params,
      preprocessing: options.preprocessing,
      dims: options.outputDims,
    }),
  );
  try {
    const result = await job.promise;
    const experiment: Experiment = {
      id: createId('exp'),
      name: options.name ?? `${ALGORITHM_LABELS[options.algorithm]} · ${dataset.name}`,
      datasetId: dataset.id,
      datasetName: dataset.name,
      datasetChecksum: dataset.checksum,
      algorithm: options.algorithm,
      implementation: implementationFor(options.algorithm),
      params: options.params,
      preprocessing:
        options.algorithm === 'pca' ? { ...options.preprocessing, center: true } : options.preprocessing,
      outputDims: result.dims,
      rowIndices: result.rowIndices,
      coords: result.coords,
      diagnostics: result.diagnostics,
      metrics: null,
      runtimeMs: result.runtimeMs,
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      environment: environmentDescription(),
    };
    for (const w of [...result.preprocessingWarnings, ...result.diagnostics.warnings]) log('warning', w);
    useExperimentStore.getState().add(experiment);
    if (options.activate !== false) useExperimentStore.getState().setActive(experiment.id);
    log('success', `${label} finished in ${formatDuration(result.runtimeMs)}.`);
    if (options.autoMetrics) {
      void computeMetrics(experiment, dataset, options.autoMetrics, defaultLabelColumn(dataset)).catch(
        () => undefined,
      );
    }
    return experiment;
  } catch (error) {
    if (error instanceof JobCancelledError) {
      log('warning', `${label} was cancelled.`);
      return null;
    }
    log('error', `${label} failed.`, errorMessage(error));
    throw error;
  } finally {
    useExperimentStore.getState().endJob(key);
    if (options.activate !== false) useExperimentStore.getState().setPreview(null);
  }
}

export async function computeMetrics(
  experiment: Experiment,
  dataset: Dataset,
  options: MetricsRequestOptions,
  labelColumn: string | null,
): Promise<void> {
  const key = `metrics:${experiment.id}`;
  const store = useExperimentStore.getState();
  store.jobs[key]?.cancel();
  let labels: Int32Array | null = null;
  if (labelColumn) {
    const column = dataset.columns.find((c) => c.name === labelColumn);
    if (column) {
      const { codes, valid } = encodeLabels(column.values);
      labels = new Int32Array(dataset.n).fill(-1);
      valid.forEach((row, t) => (labels![row] = codes[t]!));
    }
  }
  const job = runComputeJob(
    {
      kind: 'metrics',
      values: dataset.values,
      n: dataset.n,
      d: dataset.d,
      preprocessing: experiment.preprocessing,
      rowIndices: experiment.rowIndices,
      coords: experiment.coords,
      dims: experiment.outputDims,
      labels,
      labelColumn,
      options,
    },
    (p) => useExperimentStore.getState().updateJob(key, p),
  );
  store.startJob({
    key,
    kind: 'metrics',
    label: `Quality metrics for ${experiment.name}`,
    progress: null,
    startedAt: performance.now(),
    cancel: job.cancel,
  });
  try {
    const result = await job.promise;
    useExperimentStore.getState().update(experiment.id, { metrics: result.metrics });
    useExperimentStore.getState().setShepard(experiment.id, result.shepard);
    for (const w of result.metrics.warnings) log('warning', w);
    log(
      'success',
      `Computed quality metrics (k = ${options.k}) in ${formatDuration(result.metrics.runtimeMs)}.`,
    );
  } catch (error) {
    if (!(error instanceof JobCancelledError)) {
      log('error', 'Quality metrics failed.', errorMessage(error));
      throw error;
    }
  } finally {
    useExperimentStore.getState().endJob(key);
  }
}

export async function runClustering(
  dataset: Dataset,
  method: ClusteringMethod,
  params: Record<string, number | string>,
  space: 'original' | 'projection',
  experiment: Experiment | null,
  preprocessing: PreprocessingConfig,
  seed: number,
): Promise<ClusteringResult | null> {
  const key = 'clustering';
  useExperimentStore.getState().jobs[key]?.cancel();
  let values: Float32Array;
  let n: number;
  let d: number;
  if (space === 'projection') {
    if (!experiment) throw new Error('Run a projection first to cluster in projection space.');
    values = experiment.coords;
    n = experiment.coords.length / experiment.outputDims;
    d = experiment.outputDims;
  } else {
    values = dataset.values;
    n = dataset.n;
    d = dataset.d;
  }
  const job = runComputeJob(
    {
      kind: 'cluster',
      values,
      n,
      d,
      preprocessing: space === 'original' ? { ...preprocessing, subsample: null } : null,
      method,
      params,
      seed,
    },
    (p) => useExperimentStore.getState().updateJob(key, p),
  );
  useExperimentStore.getState().startJob({
    key,
    kind: 'clustering',
    label: `Clustering (${method})`,
    progress: null,
    startedAt: performance.now(),
    cancel: job.cancel,
  });
  try {
    const result = await job.promise;
    // Map assignments back to dataset rows; rows outside a projection subsample are unassigned.
    let assignments = result.assignments;
    if (space === 'projection' && experiment?.rowIndices) {
      const full = new Int32Array(dataset.n).fill(-2);
      experiment.rowIndices.forEach((row, i) => (full[row] = result.assignments[i]!));
      assignments = full;
    }
    const clustering: ClusteringResult = {
      id: createId('cl'),
      datasetId: dataset.id,
      method,
      space,
      experimentId: space === 'projection' ? (experiment?.id ?? null) : null,
      params: { ...params, seed },
      assignments,
      clusterCount: result.clusterCount,
      summary:
        result.summary +
        (space === 'projection'
          ? ` Computed on ${experiment?.name ?? 'projection'} coordinates.`
          : ' Computed on preprocessed original features.'),
      createdAt: new Date().toISOString(),
    };
    useDatasetStore.getState().addClustering(clustering);
    log('success', result.summary);
    return clustering;
  } catch (error) {
    if (error instanceof JobCancelledError) return null;
    log('error', 'Clustering failed.', errorMessage(error));
    throw error;
  } finally {
    useExperimentStore.getState().endJob(key);
  }
}
