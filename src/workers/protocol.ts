import type {
  AlgorithmParams,
  OutputDims,
  PreprocessingConfig,
  ProjectionDiagnostics,
} from '@/types/algorithms';
import type { ClusteringMethod } from '@/types/experiment';
import type { MetricsRequestOptions, QualityMetrics, RepresentationComparison } from '@/types/metrics';

export interface ProjectRequest {
  kind: 'project';
  values: Float32Array;
  n: number;
  d: number;
  params: AlgorithmParams;
  preprocessing: PreprocessingConfig;
  outputDims: OutputDims;
  /** Post intermediate coordinates every this many iterations (0 disables). */
  previewEvery: number;
}

export interface ProjectResult {
  kind: 'project';
  coords: Float32Array;
  dims: OutputDims;
  rowIndices: Uint32Array | null;
  diagnostics: ProjectionDiagnostics;
  preprocessingWarnings: string[];
  runtimeMs: number;
}

export interface MetricsRequest {
  kind: 'metrics';
  values: Float32Array;
  n: number;
  d: number;
  preprocessing: PreprocessingConfig;
  rowIndices: Uint32Array | null;
  coords: Float32Array;
  dims: OutputDims;
  /** Label codes per *dataset* row (−1 = missing), for silhouette. */
  labels: Int32Array | null;
  labelColumn: string | null;
  options: MetricsRequestOptions;
}

export interface MetricsResult {
  kind: 'metrics';
  metrics: QualityMetrics;
  shepard: { a: number; b: number }[];
}

export interface ClusterRequest {
  kind: 'cluster';
  /** Either the dataset feature matrix or projection coordinates. */
  values: Float32Array;
  n: number;
  d: number;
  /** Preprocessing applied before clustering (original space only). */
  preprocessing: PreprocessingConfig | null;
  method: ClusteringMethod;
  params: Record<string, number | string>;
  seed: number;
}

export interface ClusterResult {
  kind: 'cluster';
  assignments: Int32Array;
  clusterCount: number;
  summary: string;
}

export interface CompareRequest {
  kind: 'compare';
  a: Float32Array;
  da: number;
  b: Float32Array;
  db: number;
  n: number;
  labels: Int32Array | null;
  standardize: boolean;
  k: number;
  maxQueries: number;
  rsaSample: number;
  rsaMetric: 'euclidean' | 'correlation';
  /** Number of k-means clusters for the cluster-distribution comparison (0 disables). */
  clusterK: number;
  seed: number;
}

export interface CompareResult {
  kind: 'compare';
  comparison: RepresentationComparison;
}

export type ComputeRequest = ProjectRequest | MetricsRequest | ClusterRequest | CompareRequest;
export type ComputeResult = ProjectResult | MetricsResult | ClusterResult | CompareResult;

export type ResultFor<R extends ComputeRequest> = R extends ProjectRequest
  ? ProjectResult
  : R extends MetricsRequest
    ? MetricsResult
    : R extends ClusterRequest
      ? ClusterResult
      : CompareResult;

export interface JobProgress {
  stage: string;
  /** Fraction in [0, 1], or null when progress cannot be estimated reliably. */
  fraction: number | null;
  iteration?: number;
  total?: number;
  kl?: number | null;
  preview?: Float32Array;
}

export type WorkerMessage =
  | { type: 'progress'; progress: JobProgress }
  | { type: 'result'; result: ComputeResult }
  | { type: 'error'; message: string };
