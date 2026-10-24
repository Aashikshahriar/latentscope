import type { AlgorithmParams, PreprocessingConfig } from '@/types/algorithms';
import type { Experiment } from '@/types/experiment';

export function paramsSummary(params: AlgorithmParams): string {
  switch (params.algorithm) {
    case 'pca':
      return `solver ${params.solver}`;
    case 'tsne':
      return `perplexity ${params.perplexity} · ${params.iterations} it · lr ${params.learningRate ?? 'auto'} · ${params.init} init · seed ${params.seed}`;
    case 'umap':
      return `k ${params.nNeighbors} · min dist ${params.minDist} · ${params.metric} · seed ${params.seed}`;
  }
}

export function preprocessingSummary(p: PreprocessingConfig): string {
  const steps: string[] = [];
  if (p.l2Normalize) steps.push('L2-normalised');
  if (p.center) steps.push('centred');
  if (p.standardize) steps.push('standardised');
  if (p.subsample) steps.push(`subsample ${p.subsample.size} (seed ${p.subsample.seed})`);
  return steps.length ? steps.join(', ') : 'none';
}

export function methodSummary(e: Experiment): string {
  const d = e.diagnostics;
  if (d.kind === 'pca') return `${d.method}${d.exact ? '' : ' (approximate)'}`;
  if (d.kind === 'tsne')
    return `${d.method === 'exact' ? 'exact gradient' : 'Barnes–Hut'}${d.pcaPreReduced ? `, PCA → ${d.inputDims} dims first` : ''}`;
  return `${d.knnMethod === 'exact' ? 'exact' : 'NN-descent'} neighbours, ${d.epochs} epochs`;
}

/** A flat, serialisable record of everything needed to reproduce the run. */
export function reproducibilityRecord(e: Experiment) {
  return {
    experiment: e.name,
    dataset: { id: e.datasetId, name: e.datasetName, sha256: e.datasetChecksum },
    algorithm: e.algorithm,
    implementation: e.implementation,
    parameters: e.params,
    preprocessing: e.preprocessing,
    outputDimensions: e.outputDims,
    rowsUsed: e.rowIndices ? e.rowIndices.length : 'all',
    method: methodSummary(e),
    createdAt: e.createdAt,
    runtimeMs: Math.round(e.runtimeMs),
    software: `LatentScope ${e.appVersion}`,
    environment: e.environment,
  };
}
