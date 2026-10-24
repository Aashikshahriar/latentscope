import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type BottomTab = 'metrics' | 'comparison' | 'distributions' | 'history' | 'logs' | 'table';

interface UiState {
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  bottomHeight: number;
  importOpen: boolean;
  exportOpen: boolean;
  shareOpen: boolean;
  mobilePanel: 'controls' | 'inspector' | 'analysis' | null;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  setBottomOpen: (v: boolean) => void;
  setBottomTab: (t: BottomTab) => void;
  setBottomHeight: (h: number) => void;
  setImportOpen: (v: boolean) => void;
  setExportOpen: (v: boolean) => void;
  setShareOpen: (v: boolean) => void;
  setMobilePanel: (p: UiState['mobilePanel']) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      leftOpen: true,
      rightOpen: true,
      bottomOpen: true,
      bottomTab: 'metrics',
      bottomHeight: 260,
      importOpen: false,
      exportOpen: false,
      shareOpen: false,
      mobilePanel: null,
      setLeftOpen: (leftOpen) => set({ leftOpen }),
      setRightOpen: (rightOpen) => set({ rightOpen }),
      setBottomOpen: (bottomOpen) => set({ bottomOpen }),
      setBottomTab: (bottomTab) => set({ bottomTab, bottomOpen: true }),
      setBottomHeight: (bottomHeight) => set({ bottomHeight }),
      setImportOpen: (importOpen) => set({ importOpen }),
      setExportOpen: (exportOpen) => set({ exportOpen }),
      setShareOpen: (shareOpen) => set({ shareOpen }),
      setMobilePanel: (mobilePanel) => set({ mobilePanel }),
    }),
    {
      name: 'latentscope.ui.v1',
      version: 1,
      partialize: (s) => ({
        leftOpen: s.leftOpen,
        rightOpen: s.rightOpen,
        bottomOpen: s.bottomOpen,
        bottomTab: s.bottomTab,
        bottomHeight: s.bottomHeight,
      }),
    },
  ),
);
