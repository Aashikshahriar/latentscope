import type { Experiment } from '@/types/experiment';
import { useConfigStore } from '@/stores/configStore';

/** Copies an experiment's configuration into the explorer controls. */
export function duplicateConfiguration(e: Experiment): void {
  const config = useConfigStore.getState();
  config.setAlgorithm(e.algorithm);
  config.setOutputDims(e.outputDims);
  if (e.params.algorithm === 'pca') config.setPca(e.params);
  if (e.params.algorithm === 'tsne') config.setTsne(e.params);
  if (e.params.algorithm === 'umap') config.setUmap(e.params);
  config.setPreprocessing(e.preprocessing);
}
