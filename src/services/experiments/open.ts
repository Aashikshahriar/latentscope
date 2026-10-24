import type { Experiment } from '@/types/experiment';
import { useDatasetStore } from '@/stores/datasetStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { demoDatasetId } from '@/services/datasets/demos';
import type { Dataset, DemoSpec } from '@/types/dataset';

/**
 * Re-opens a stored experiment. Its dataset must be available with the same checksum: in memory,
 * in local storage, or — for demonstrations — regenerated from the recorded specification.
 */
export async function openExperiment(e: Experiment): Promise<void> {
  const store = useDatasetStore.getState();
  let dataset: Dataset | null = store.datasets[e.datasetId] ?? null;
  if (!dataset) dataset = await store.findByChecksum(e.datasetChecksum);
  if (!dataset && e.datasetId.startsWith('demo:')) {
    const spec = demoSpecFromId(e.datasetId);
    if (spec) dataset = await store.loadDemo(spec, false);
  }
  if (!dataset) {
    throw new Error(
      `The dataset “${e.datasetName}” (SHA-256 ${e.datasetChecksum.slice(0, 12)}…) is not loaded. Import the same file again and re-open this experiment.`,
    );
  }
  if (dataset.checksum !== e.datasetChecksum) {
    throw new Error(
      `The loaded “${dataset.name}” differs from the data this experiment was computed on (checksum mismatch).`,
    );
  }
  if (!store.datasets[dataset.id]) store.addDataset(dataset, false);
  // The experiment refers to its dataset by id; if a matching dataset was found under another id
  // (re-imported file), point the experiment at it.
  if (dataset.id !== e.datasetId) useExperimentStore.getState().update(e.id, { datasetId: dataset.id });
  useDatasetStore.getState().setActive(dataset.id);
  useExperimentStore.getState().setActive(e.id);
}

/** Inverse of demoDatasetId for the generator-based demos. */
export function demoSpecFromId(id: string): DemoSpec | null {
  let m = /^demo:gaussian:k(\d+)-d(\d+)-m(\d+)-sep([\d.]+)-noise([\d.]+)-seed(-?\d+)$/.exec(id);
  if (m) {
    return {
      kind: 'gaussian-clusters',
      clusters: +m[1]!,
      dimensions: +m[2]!,
      pointsPerCluster: +m[3]!,
      separation: +m[4]!,
      noise: +m[5]!,
      seed: +m[6]!,
    };
  }
  m = /^demo:swiss-roll:n(\d+)-noise([\d.]+)-seed(-?\d+)$/.exec(id);
  if (m) return { kind: 'swiss-roll', points: +m[1]!, noise: +m[2]!, seed: +m[3]! };
  m = /^demo:multimodal-(a|b):seed(-?\d+)$/.exec(id);
  if (m) return { kind: 'multimodal', modality: m[1] as 'a' | 'b', seed: +m[2]! };
  m = /^demo:(iris|digits|text-minilm|text-bge)$/.exec(id);
  if (m) return { kind: 'static', demo: m[1] as 'iris' | 'digits' | 'text-minilm' | 'text-bge' };
  return null;
}

export function isDemoId(id: string): boolean {
  return demoSpecFromId(id) !== null && demoDatasetId(demoSpecFromId(id)!) === id;
}
