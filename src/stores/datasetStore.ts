import { create } from 'zustand';
import type { Dataset, DatasetSummary, DemoSpec } from '@/types/dataset';
import type { ClusteringResult } from '@/types/experiment';
import { demoDatasetId, loadDemo } from '@/services/datasets/demos';
import { clusteringRepo, datasetRepo, persistenceAvailable } from '@/services/persistence/db';
import { errorMessage } from '@/utils/misc';
import { log } from './logStore';

/** Stable empty list for selectors (a new [] per call would re-render forever). */
export const EMPTY_CLUSTERINGS: ClusteringResult[] = [];

interface DatasetState {
  /** Datasets currently held in memory, by id. */
  datasets: Record<string, Dataset>;
  activeId: string | null;
  /** Datasets saved in IndexedDB (summaries only). */
  library: DatasetSummary[];
  /** Ids of in-memory datasets that are also saved locally. */
  savedIds: string[];
  loading: string | null;
  error: string | null;
  clusterings: Record<string, ClusteringResult[]>;

  addDataset: (dataset: Dataset, activate?: boolean) => void;
  setActive: (id: string | null) => void;
  unload: (id: string) => void;
  loadDemo: (spec: DemoSpec, activate?: boolean) => Promise<Dataset>;
  refreshLibrary: () => Promise<void>;
  saveToLibrary: (id: string) => Promise<void>;
  openFromLibrary: (id: string, activate?: boolean) => Promise<Dataset>;
  renameDataset: (id: string, name: string) => Promise<void>;
  deleteFromLibrary: (id: string) => Promise<void>;
  findByChecksum: (checksum: string) => Promise<Dataset | null>;
  addClustering: (result: ClusteringResult) => void;
  removeClustering: (datasetId: string, id: string) => void;
}

export const useDatasetStore = create<DatasetState>()((set, get) => ({
  datasets: {},
  activeId: null,
  library: [],
  savedIds: [],
  loading: null,
  error: null,
  clusterings: {},

  addDataset: (dataset, activate = true) => {
    set((s) => ({
      datasets: { ...s.datasets, [dataset.id]: dataset },
      activeId: activate ? dataset.id : s.activeId,
    }));
    if (persistenceAvailable()) {
      void clusteringRepo.forDataset(dataset.id).then((stored) => {
        if (stored.length > 0) set((s) => ({ clusterings: { ...s.clusterings, [dataset.id]: stored } }));
      });
    }
  },

  setActive: (id) => set({ activeId: id }),

  unload: (id) =>
    set((s) => {
      const datasets = { ...s.datasets };
      delete datasets[id];
      return { datasets, activeId: s.activeId === id ? null : s.activeId };
    }),

  loadDemo: async (spec, activate = true) => {
    const id = demoDatasetId(spec);
    const existing = get().datasets[id];
    if (existing) {
      if (activate) set({ activeId: id });
      return existing;
    }
    set({ loading: 'Loading demonstration dataset…', error: null });
    try {
      const dataset = await loadDemo(spec);
      get().addDataset(dataset, activate);
      log(
        'info',
        `Loaded demo "${dataset.name}" (${dataset.n} × ${dataset.d}).`,
        `SHA-256 ${dataset.checksum}`,
      );
      return dataset;
    } catch (error) {
      set({ error: errorMessage(error) });
      log('error', 'Failed to load demonstration dataset.', errorMessage(error));
      throw error;
    } finally {
      set({ loading: null });
    }
  },

  refreshLibrary: async () => {
    if (!persistenceAvailable()) return;
    const library = await datasetRepo.list();
    set({ library, savedIds: library.map((d) => d.id) });
  },

  saveToLibrary: async (id) => {
    const dataset = get().datasets[id];
    if (!dataset) throw new Error('Dataset is not loaded.');
    await datasetRepo.save(dataset);
    log('success', `Saved "${dataset.name}" to local browser storage.`);
    await get().refreshLibrary();
  },

  openFromLibrary: async (id, activate = true) => {
    const loaded = get().datasets[id];
    if (loaded) {
      if (activate) set({ activeId: id });
      return loaded;
    }
    const dataset = await datasetRepo.get(id);
    if (!dataset) throw new Error('The dataset is no longer in local storage.');
    get().addDataset(dataset, activate);
    log('info', `Opened "${dataset.name}" from local storage.`);
    return dataset;
  },

  renameDataset: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((s) =>
      s.datasets[id] ? { datasets: { ...s.datasets, [id]: { ...s.datasets[id]!, name: trimmed } } } : {},
    );
    if (get().savedIds.includes(id)) await datasetRepo.rename(id, trimmed);
    await get().refreshLibrary();
  },

  deleteFromLibrary: async (id) => {
    await datasetRepo.remove(id);
    log('info', 'Deleted a dataset from local storage.');
    await get().refreshLibrary();
  },

  findByChecksum: async (checksum) => {
    const inMemory = Object.values(get().datasets).find((d) => d.checksum === checksum);
    if (inMemory) return inMemory;
    if (!persistenceAvailable()) return null;
    return (await datasetRepo.findByChecksum(checksum)) ?? null;
  },

  addClustering: (result) => {
    set((s) => ({
      clusterings: {
        ...s.clusterings,
        [result.datasetId]: [...(s.clusterings[result.datasetId] ?? []), result],
      },
    }));
    if (persistenceAvailable()) void clusteringRepo.save(result);
  },

  removeClustering: (datasetId, id) => {
    set((s) => ({
      clusterings: {
        ...s.clusterings,
        [datasetId]: (s.clusterings[datasetId] ?? []).filter((c) => c.id !== id),
      },
    }));
    if (persistenceAvailable()) void clusteringRepo.remove(id);
  },
}));

export function useActiveDataset(): Dataset | null {
  return useDatasetStore((s) => (s.activeId ? (s.datasets[s.activeId] ?? null) : null));
}
