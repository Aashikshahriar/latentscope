import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ColorBy } from '@/visualization/common/colorMapping';
import type { CategoricalPaletteId, SequentialPaletteId } from '@/visualization/common/palettes';

export type SelectionTool = 'navigate' | 'rectangle' | 'lasso';
export type LegendPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'hidden';
export type BackgroundMode = 'theme' | 'black' | 'white' | 'custom';

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  up: [number, number, number];
}

export interface CameraBookmark {
  id: string;
  name: string;
  experimentId: string;
  camera: CameraState;
}

export interface VisualSettings {
  pointSize: number;
  opacity: number;
  categoricalPalette: CategoricalPaletteId;
  sequentialPalette: SequentialPaletteId;
  background: BackgroundMode;
  customBackground: string;
  showAxes: boolean;
  showGrid: boolean;
  showLabels: boolean;
  legendPosition: LegendPosition;
  shapeEncoding: boolean;
  dimUnselected: boolean;
}

export const DEFAULT_VISUALS: VisualSettings = {
  pointSize: 5,
  opacity: 0.9,
  categoricalPalette: 'latentscope',
  sequentialPalette: 'viridis',
  background: 'theme',
  customBackground: '#0B0F19',
  showAxes: true,
  showGrid: true,
  showLabels: false,
  legendPosition: 'top-right',
  shapeEncoding: false,
  dimUnselected: true,
};

interface ViewState {
  visuals: VisualSettings;
  colorBy: ColorBy;
  /** Category keys hidden from view for the current colour-by. */
  hidden: string[];
  /** Selected dataset row indices (sorted, unique) — shared by all synchronised views. */
  selection: number[];
  /** The observation shown in the inspector. */
  focus: number | null;
  hover: number | null;
  isolateSelection: boolean;
  tool: SelectionTool;
  bookmarks: CameraBookmark[];
  /** Incremented to ask canvases to fit their content. */
  fitRequest: number;
  resetRequest: number;
  pendingCamera: CameraState | null;

  setVisuals: (v: Partial<VisualSettings>) => void;
  resetVisuals: () => void;
  setColorBy: (c: ColorBy) => void;
  toggleHidden: (key: string) => void;
  setHidden: (keys: string[]) => void;
  setSelection: (rows: number[], mode?: 'replace' | 'add' | 'subtract') => void;
  clearSelection: () => void;
  setFocus: (row: number | null) => void;
  setHover: (row: number | null) => void;
  setIsolate: (v: boolean) => void;
  setTool: (t: SelectionTool) => void;
  addBookmark: (b: CameraBookmark) => void;
  removeBookmark: (id: string) => void;
  requestFit: () => void;
  requestReset: () => void;
  restoreCamera: (c: CameraState | null) => void;
}

function normalise(rows: number[]): number[] {
  return [...new Set(rows)].sort((a, b) => a - b);
}

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      visuals: DEFAULT_VISUALS,
      colorBy: { type: 'none' },
      hidden: [],
      selection: [],
      focus: null,
      hover: null,
      isolateSelection: false,
      tool: 'navigate',
      bookmarks: [],
      fitRequest: 0,
      resetRequest: 0,
      pendingCamera: null,

      setVisuals: (v) => set((s) => ({ visuals: { ...s.visuals, ...v } })),
      resetVisuals: () => set({ visuals: DEFAULT_VISUALS }),
      setColorBy: (colorBy) => set({ colorBy, hidden: [] }),
      toggleHidden: (key) =>
        set((s) => ({
          hidden: s.hidden.includes(key) ? s.hidden.filter((k) => k !== key) : [...s.hidden, key],
        })),
      setHidden: (hidden) => set({ hidden }),
      setSelection: (rows, mode = 'replace') =>
        set((s) => {
          if (mode === 'add') return { selection: normalise([...s.selection, ...rows]) };
          if (mode === 'subtract') {
            const remove = new Set(rows);
            return { selection: s.selection.filter((r) => !remove.has(r)) };
          }
          return { selection: normalise(rows) };
        }),
      clearSelection: () => set({ selection: [], isolateSelection: false }),
      setFocus: (focus) => set({ focus }),
      setHover: (hover) => set({ hover }),
      setIsolate: (isolateSelection) => set({ isolateSelection }),
      setTool: (tool) => set({ tool }),
      addBookmark: (b) => set((s) => ({ bookmarks: [...s.bookmarks, b] })),
      removeBookmark: (id) => set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),
      requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
      requestReset: () => set((s) => ({ resetRequest: s.resetRequest + 1 })),
      restoreCamera: (pendingCamera) => set({ pendingCamera }),
    }),
    {
      name: 'latentscope.view.v1',
      version: 1,
      partialize: (s) => ({ visuals: s.visuals, bookmarks: s.bookmarks }),
    },
  ),
);

/** Called when the active dataset changes: selection and filters refer to rows of one dataset. */
export function resetViewForDataset(colorBy: ColorBy): void {
  useViewStore.setState({
    colorBy,
    hidden: [],
    selection: [],
    focus: null,
    hover: null,
    isolateSelection: false,
  });
}
