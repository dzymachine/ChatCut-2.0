/**
 * UI slice — selection and panel state.
 *
 * Owns: `ui`
 * Actions: setSelectedClip, toggleClipSelection
 *
 * Cross-slice notes: the project slice's addClipFromMedia sets
 * ui.selectedClipIds, removeClip prunes it, and setLinkedSelectionEnabled
 * writes ui.linkedSelectionEnabled.
 */

import type { StateCreator } from 'zustand';
import { DEFAULT_UI_STATE } from '@/types/editor';
import type { EditorStore } from './types';

type UiSlice = Pick<EditorStore, 'ui' | 'setSelectedClip' | 'toggleClipSelection'>;

export const createUiSlice: StateCreator<EditorStore, [], [], UiSlice> = (set) => ({
  // ── Initial State ──
  ui: { ...DEFAULT_UI_STATE },

  // ── UI Actions ──

  setSelectedClip: (clipId) => {
    set((state) => ({
      ui: { ...state.ui, selectedClipIds: clipId ? [clipId] : [] },
    }));
  },

  toggleClipSelection: (clipId) => {
    set((state) => {
      const current = state.ui.selectedClipIds;
      const idx = current.indexOf(clipId);
      if (idx >= 0) {
        return { ui: { ...state.ui, selectedClipIds: current.filter((id) => id !== clipId) } };
      }
      return { ui: { ...state.ui, selectedClipIds: [clipId, ...current] } };
    });
  },
});
