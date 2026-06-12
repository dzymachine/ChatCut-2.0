/**
 * Live generation progress — a tiny standalone store the chat UI reads to
 * show a progress chip while the generate_video_clip tool polls Rust.
 * Deliberately outside the editor store: transient view state, never
 * persisted, never undoable.
 */

import { create } from 'zustand';
import type { GenerationProgress } from '@/lib/tauri/bridge';

interface GenerationUiState {
  /** The in-flight generation, or null. One at a time for now. */
  active: GenerationProgress | null;
  setActive: (progress: GenerationProgress | null) => void;
}

export const useGenerationStore = create<GenerationUiState>((set) => ({
  active: null,
  setActive: (active) => set({ active }),
}));
