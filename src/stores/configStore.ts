import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AlgorithmId,
  OutputDims,
  PcaParams,
  PreprocessingConfig,
  TsneParams,
  UmapParams,
} from '@/types/algorithms';
import type { MetricsRequestOptions } from '@/types/metrics';
import { DEFAULT_PREPROCESSING } from '@/algorithms/preprocessing/preprocess';
import { TSNE_DEFAULTS } from '@/algorithms/tsne/tsne';
import { UMAP_DEFAULTS } from '@/algorithms/umap/umap';

export const PCA_DEFAULTS: PcaParams = { algorithm: 'pca', solver: 'auto', seed: 0 };

export const METRIC_DEFAULTS: MetricsRequestOptions = {
  k: 10,
  maxQueries: 5000,
  maxSilhouette: 2000,
  distancePairs: 20000,
  seed: 0,
};

/** Explorer configuration for the next run. Persisted per browser as a convenience. */
interface ConfigState {
  algorithm: AlgorithmId;
  outputDims: OutputDims;
  pca: PcaParams;
  tsne: TsneParams;
  umap: UmapParams;
  preprocessing: PreprocessingConfig;
  metrics: MetricsRequestOptions;
  autoMetrics: boolean;
  setAlgorithm: (a: AlgorithmId) => void;
  setOutputDims: (d: OutputDims) => void;
  setPca: (p: Partial<PcaParams>) => void;
  setTsne: (p: Partial<TsneParams>) => void;
  setUmap: (p: Partial<UmapParams>) => void;
  setPreprocessing: (p: Partial<PreprocessingConfig>) => void;
  setMetrics: (p: Partial<MetricsRequestOptions>) => void;
  setAutoMetrics: (v: boolean) => void;
  resetParams: (a: AlgorithmId) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      algorithm: 'pca',
      outputDims: 2,
      pca: PCA_DEFAULTS,
      tsne: TSNE_DEFAULTS,
      umap: UMAP_DEFAULTS,
      preprocessing: DEFAULT_PREPROCESSING,
      metrics: METRIC_DEFAULTS,
      autoMetrics: true,
      setAlgorithm: (algorithm) => set({ algorithm }),
      setOutputDims: (outputDims) => set({ outputDims }),
      setPca: (p) => set((s) => ({ pca: { ...s.pca, ...p } })),
      setTsne: (p) => set((s) => ({ tsne: { ...s.tsne, ...p } })),
      setUmap: (p) => set((s) => ({ umap: { ...s.umap, ...p } })),
      setPreprocessing: (p) => set((s) => ({ preprocessing: { ...s.preprocessing, ...p } })),
      setMetrics: (p) => set((s) => ({ metrics: { ...s.metrics, ...p } })),
      setAutoMetrics: (autoMetrics) => set({ autoMetrics }),
      resetParams: (a) =>
        set(
          a === 'pca'
            ? { pca: PCA_DEFAULTS }
            : a === 'tsne'
              ? { tsne: TSNE_DEFAULTS }
              : { umap: UMAP_DEFAULTS },
        ),
    }),
    { name: 'latentscope.config.v2', version: 2 },
  ),
);

export function currentParams(state: Pick<ConfigState, 'algorithm' | 'pca' | 'tsne' | 'umap'>) {
  return state.algorithm === 'pca' ? state.pca : state.algorithm === 'tsne' ? state.tsne : state.umap;
}
