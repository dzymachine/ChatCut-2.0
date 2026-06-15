/**
 * Cross-component export status — a tiny standalone signal so the preview-proxy
 * trigger (usePreviewProxy, mounted in the engine) knows when an export is
 * running and stands down, while ExportDialog owns the actual export. Transient
 * view state: never persisted, never undoable.
 */

import { create } from 'zustand';

interface ExportStatusState {
  isExporting: boolean;
  setExporting: (value: boolean) => void;
}

export const useExportStatusStore = create<ExportStatusState>((set) => ({
  isExporting: false,
  setExporting: (isExporting) => set({ isExporting }),
}));
