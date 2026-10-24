import { create } from 'zustand';
import type { OutputDims } from '@/types/algorithms';
import type { Experiment } from '@/types/experiment';
import type { JobProgress } from '@/workers/protocol';
import { experimentRepo, persistenceAvailable } from '@/services/persistence/db';

export type JobKind = 'projection' | 'metrics' | 'clustering' | 'comparison';

export interface JobState {
  key: string;
  kind: JobKind;
  label: string;
  progress: JobProgress | null;
  startedAt: number;
  cancel: () => void;
}

export interface ProjectionPreview {
  datasetId: string;
  coords: Float32Array;
  dims: OutputDims;
  rowIndices: Uint32Array | null;
  iteration: number;
  total: number;
}

interface ExperimentState {
  experiments: Experiment[];
  activeId: string | null;
  loaded: boolean;
  jobs: Record<string, JobState>;
  preview: ProjectionPreview | null;
  shepard: Record<string, { a: number; b: number }[]>;

  load: () => Promise<void>;
  setActive: (id: string | null) => void;
  add: (experiment: Experiment) => void;
  update: (id: string, patch: Partial<Experiment>) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  startJob: (job: JobState) => void;
  updateJob: (key: string, progress: JobProgress) => void;
  endJob: (key: string) => void;
  setPreview: (p: ProjectionPreview | null) => void;
  setShepard: (experimentId: string, sample: { a: number; b: number }[]) => void;
}

export const useExperimentStore = create<ExperimentState>()((set, get) => ({
  experiments: [],
  activeId: null,
  loaded: false,
  jobs: {},
  preview: null,
  shepard: {},

  load: async () => {
    if (get().loaded || !persistenceAvailable()) {
      set({ loaded: true });
      return;
    }
    try {
      const stored = await experimentRepo.list();
      set((s) => {
        const known = new Set(s.experiments.map((e) => e.id));
        return { experiments: [...s.experiments, ...stored.filter((e) => !known.has(e.id))], loaded: true };
      });
    } catch {
      set({ loaded: true });
    }
  },
  setActive: (activeId) => set({ activeId }),
  add: (experiment) => {
    set((s) => ({ experiments: [experiment, ...s.experiments] }));
    if (persistenceAvailable()) void experimentRepo.save(experiment);
  },
  update: (id, patch) => {
    set((s) => ({ experiments: s.experiments.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    const updated = get().experiments.find((e) => e.id === id);
    if (updated && persistenceAvailable()) void experimentRepo.save(updated);
  },
  rename: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    get().update(id, { name: trimmed });
  },
  remove: (id) => {
    set((s) => ({
      experiments: s.experiments.filter((e) => e.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
    if (persistenceAvailable()) void experimentRepo.remove(id);
  },
  startJob: (job) => set((s) => ({ jobs: { ...s.jobs, [job.key]: job } })),
  updateJob: (key, progress) =>
    set((s) => (s.jobs[key] ? { jobs: { ...s.jobs, [key]: { ...s.jobs[key]!, progress } } } : {})),
  endJob: (key) =>
    set((s) => {
      const jobs = { ...s.jobs };
      delete jobs[key];
      return { jobs };
    }),
  setPreview: (preview) => set({ preview }),
  setShepard: (experimentId, sample) => set((s) => ({ shepard: { ...s.shepard, [experimentId]: sample } })),
}));

export function useActiveExperiment(): Experiment | null {
  return useExperimentStore((s) =>
    s.activeId ? (s.experiments.find((e) => e.id === s.activeId) ?? null) : null,
  );
}
