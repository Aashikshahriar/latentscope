import Dexie, { type EntityTable } from 'dexie';
import type { Dataset, DatasetSummary } from '@/types/dataset';
import type { ClusteringResult, Experiment } from '@/types/experiment';

/**
 * Local persistence in IndexedDB. Nothing here leaves the browser. Typed arrays are stored
 * natively via the structured-clone algorithm.
 */
class LatentScopeDB extends Dexie {
  datasets!: EntityTable<Dataset, 'id'>;
  experiments!: EntityTable<Experiment, 'id'>;
  clusterings!: EntityTable<ClusteringResult, 'id'>;

  constructor() {
    super('latentscope');
    this.version(1).stores({
      datasets: 'id, name, checksum, createdAt',
      experiments: 'id, datasetId, datasetChecksum, algorithm, createdAt',
      clusterings: 'id, datasetId, createdAt',
    });
  }
}

let instance: LatentScopeDB | null = null;

function db(): LatentScopeDB {
  instance ??= new LatentScopeDB();
  return instance;
}

export function persistenceAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export const datasetRepo = {
  async save(dataset: Dataset): Promise<void> {
    await db().datasets.put(dataset);
  },
  async get(id: string): Promise<Dataset | undefined> {
    return db().datasets.get(id);
  },
  async findByChecksum(checksum: string): Promise<Dataset | undefined> {
    return db().datasets.where('checksum').equals(checksum).first();
  },
  async list(): Promise<DatasetSummary[]> {
    const all = await db().datasets.toArray();
    return all
      .map((d) => ({
        id: d.id,
        name: d.name,
        n: d.n,
        d: d.d,
        checksum: d.checksum,
        source: d.source,
        createdAt: d.createdAt,
        sizeBytes: d.values.byteLength,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async rename(id: string, name: string): Promise<void> {
    await db().datasets.update(id, { name });
  },
  async remove(id: string): Promise<void> {
    await db().transaction('rw', db().datasets, db().clusterings, async () => {
      await db().datasets.delete(id);
      await db().clusterings.where('datasetId').equals(id).delete();
    });
  },
};

export const experimentRepo = {
  async save(experiment: Experiment): Promise<void> {
    await db().experiments.put(experiment);
  },
  async list(): Promise<Experiment[]> {
    return (await db().experiments.toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async rename(id: string, name: string): Promise<void> {
    await db().experiments.update(id, { name });
  },
  async remove(id: string): Promise<void> {
    await db().experiments.delete(id);
  },
};

export const clusteringRepo = {
  async save(result: ClusteringResult): Promise<void> {
    await db().clusterings.put(result);
  },
  async forDataset(datasetId: string): Promise<ClusteringResult[]> {
    return db().clusterings.where('datasetId').equals(datasetId).sortBy('createdAt');
  },
  async remove(id: string): Promise<void> {
    await db().clusterings.delete(id);
  },
};

export async function clearAllLocalData(): Promise<void> {
  await db().transaction('rw', db().datasets, db().experiments, db().clusterings, async () => {
    await db().datasets.clear();
    await db().experiments.clear();
    await db().clusterings.clear();
  });
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
