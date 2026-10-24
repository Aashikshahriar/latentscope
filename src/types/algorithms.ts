export type AlgorithmId = 'pca' | 'tsne' | 'umap';
export type OutputDims = 2 | 3;
export type DistanceMetric = 'euclidean' | 'cosine';

export interface PcaParams {
  algorithm: 'pca';
  /** 'auto' picks an exact method by shape; 'randomized' trades exactness for speed. */
  solver: 'auto' | 'exact' | 'randomized';
  seed: number;
}

export interface TsneParams {
  algorithm: 'tsne';
  perplexity: number;
  /** `null` selects the automatic rate max(N / exaggeration / 4, 50) (Belkina et al., 2019). */
  learningRate: number | null;
  iterations: number;
  earlyExaggeration: number;
  earlyExaggerationIterations: number;
  init: 'pca' | 'random';
  method: 'auto' | 'exact' | 'barnes-hut';
  theta: number;
  /** Reduce inputs to this many principal components first; 0 disables. */
  pcaDims: number;
  seed: number;
}

export interface UmapParams {
  algorithm: 'umap';
  nNeighbors: number;
  minDist: number;
  spread: number;
  metric: DistanceMetric;
  /** 0 lets umap-js choose (500 epochs for ≤ 2 500 points, fewer for larger graphs). */
  nEpochs: number;
  /** 'auto' uses exact brute-force neighbours for N ≤ 4 000 and NN-descent above. */
  knn: 'auto' | 'exact' | 'approximate';
  seed: number;
}

export type AlgorithmParams = PcaParams | TsneParams | UmapParams;

export type MissingValuePolicy = 'reject' | 'drop-rows' | 'impute-mean';

export interface PreprocessingConfig {
  /** Subtract per-feature means. PCA always centres. */
  center: boolean;
  /** Divide by per-feature sample standard deviation (constant features are left at 0). */
  standardize: boolean;
  /** Scale each observation to unit Euclidean norm. Applied before centring. */
  l2Normalize: boolean;
  subsample: SubsampleConfig | null;
}

export interface SubsampleConfig {
  size: number;
  seed: number;
}

export interface PcaDiagnostics {
  kind: 'pca';
  method: 'svd' | 'covariance-eigendecomposition' | 'gram-eigendecomposition' | 'randomized-svd';
  exact: boolean;
  /** Variance captured by each of the computed components (descending). */
  explainedVariance: number[];
  explainedVarianceRatio: number[];
  totalVariance: number;
  /** k × D loadings, row-major, for the computed components. */
  components: number[][];
  componentCount: number;
  rank: number;
  warnings: string[];
}

export interface TsneDiagnostics {
  kind: 'tsne';
  method: 'exact' | 'barnes-hut';
  klDivergence: number;
  klHistory: { iteration: number; kl: number }[];
  learningRate: number;
  effectivePerplexity: number;
  inputDims: number;
  pcaPreReduced: boolean;
  warnings: string[];
}

export interface UmapDiagnostics {
  kind: 'umap';
  knnMethod: 'exact' | 'nn-descent';
  epochs: number;
  warnings: string[];
}

export type ProjectionDiagnostics = PcaDiagnostics | TsneDiagnostics | UmapDiagnostics;

export interface ProjectionResult {
  coords: Float32Array;
  dims: OutputDims;
  diagnostics: ProjectionDiagnostics;
}
