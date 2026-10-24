import { create } from 'zustand';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
  detail?: string;
}

interface LogState {
  entries: LogEntry[];
  log: (level: LogLevel, message: string, detail?: string) => void;
  clear: () => void;
}

let nextId = 1;
const MAX_ENTRIES = 500;

export const useLogStore = create<LogState>()((set) => ({
  entries: [],
  log: (level, message, detail) =>
    set((state) => ({
      entries: [
        ...state.entries.slice(-(MAX_ENTRIES - 1)),
        { id: nextId++, time: new Date().toISOString(), level, message, detail },
      ],
    })),
  clear: () => set({ entries: [] }),
}));

export const log = (level: LogLevel, message: string, detail?: string) =>
  useLogStore.getState().log(level, message, detail);
