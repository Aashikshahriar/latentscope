import type {
  AlgorithmId,
  AlgorithmParams,
  OutputDims,
  PreprocessingConfig,
  ProjectionDiagnostics,
} from './algorithms';
import type { QualityMetrics } from './metrics';

export interface Experiment {
  id: string;
  name: string;
  datasetId: string;
  datasetName: string;
  datasetChecksum: string;
  algorithm: AlgorithmId;
  implementation: { name: string; version: string };
  params: AlgorithmParams;
  preprocessing: PreprocessingConfig;
  outputDims: OutputDims;
  /** Dataset rows used, in coordinate order. `null` means all rows in dataset order. */
  rowIndices: Uint32Array | null;
  coords: Float32Array;
  diagnostics: ProjectionDiagnostics;
  metrics: QualityMetrics | null;
  runtimeMs: number;
  createdAt: string;
  appVersion: string;
  environment: string;
}

export type ClusteringMethod = 'kmeans' | 'dbscan' | 'hierarchical';

export interface ClusteringResult {
  id: string;
  datasetId: string;
  method: ClusteringMethod;
  /** Feature space the clustering was computed in. */
  space: 'original' | 'projection';
  experimentId: string | null;
  params: Record<string, number | string>;
  /** One assignment per dataset row; -1 = noise (DBSCAN) or not clustered (subsample). */
  assignments: Int32Array;
  clusterCount: number;
  summary: string;
  createdAt: string;
}
