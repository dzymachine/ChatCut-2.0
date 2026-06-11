/**
 * ChatCut Editor — Central State Store (composition root)
 *
 * Uses Zustand with slices for organization. The store is the single source
 * of truth for the entire editor. Each slice lives in ./slices/* and is
 * spread into ONE create<EditorStore>() call below — zustand's `set` merges
 * top-level keys, so slices behave exactly like one flat store.
 *
 * ──── SLICE INDEPENDENCE / CROSS-SLICE CONTRACT ────
 *
 * The store is divided into independent slices. Each slice's actions should
 * ONLY modify their own slice. Cross-slice interactions must be explicitly
 * documented. This prevents feature additions (e.g. clip linking) from
 * accidentally breaking unrelated features (e.g. playback).
 *
 *   PLAYBACK SLICE (playback.*) — slices/playback-slice.ts:
 *     Modified by: setPlaying, setCurrentTime, setVolume, toggleMute,
 *                  setPlaybackRate, VideoEngine render loop
 *     Cross-slice: removeClip resets playback when timeline becomes empty;
 *                  undo/redo/activateNode restore playback from snapshots
 *
 *   PROJECT SLICE (project.*) — slices/project-slice.ts:
 *     Modified by: clip/track actions (add, remove, move, trim, split, link)
 *     Cross-slice: NEVER modifies playback state (except removeClip edge case).
 *                  addClipFromMedia/addTrack push undo via the history slice's
 *                  pushUndo; removeClip resets playback + prunes
 *                  ui.selectedClipIds + GCs assets; addClipFromMedia sets
 *                  ui.selectedClipIds; initProject clears chat + undo state
 *
 *   ASSETS SLICE (assets) — slices/assets-slice.ts:
 *     Modified by: addMediaFile, addMediaFileFromPath (dedup import)
 *     Cross-slice: removeClip (project slice) GCs unreferenced assets
 *
 *   UI SLICE (ui.*) — slices/ui-slice.ts:
 *     Modified by: setSelectedClip, toggleClipSelection
 *     Cross-slice: addClipFromMedia sets selectedClipIds
 *
 *   TIMELINE SLICE (timeline.*) — slices/timeline-view-slice.ts:
 *     Modified by: setTimelineZoom, setSnapEnabled, setActiveTool
 *     Cross-slice: none
 *
 *   CHAT SLICE (chatMessages, isChatLoading) — slices/chat-slice.ts:
 *     Cross-slice: initProject clears chatMessages
 *
 *   HISTORY SLICE (undoStack/redoStack/_undoBatch/editHistory/activeNodeId)
 *   — slices/history-slice.ts:
 *     Cross-slice: undo/redo/activateNode write project.tracks + playback;
 *                  toggleEditNode/deleteEditNode call toggleEffect/removeEffect
 *
 * IMPORTANT: The VideoEngine reads from this store DIRECTLY (not through React)
 * via `useEditorStore.getState()` to avoid rendering-induced frame drops.
 */

import { create } from 'zustand';
import type { EditorStore } from './slices/types';
import { createAssetsSlice } from './slices/assets-slice';
import { createProjectSlice } from './slices/project-slice';
import { createPlaybackSlice } from './slices/playback-slice';
import { createChatSlice } from './slices/chat-slice';
import { createUiSlice } from './slices/ui-slice';
import { createTimelineViewSlice } from './slices/timeline-view-slice';
import { createHistorySlice } from './slices/history-slice';

// Re-exported so timeline drop handlers keep a single import point.
export { isVideoFile } from '@/lib/media/probe';

// Re-exported so consumers (e.g. video-engine.ts) keep importing the store
// type from this module.
export type { EditorStore } from './slices/types';

// ─── Store Implementation ───────────────────────────────────────────────────
//
// HMR RESILIENCE: The store is persisted on globalThis so it survives Hot
// Module Replacement. Without this, every code edit in dev mode re-evaluates
// this module, calling create() again and producing a fresh empty store —
// wiping the user's loaded clips, media files, and timeline state. The engine
// (also on globalThis) would then hold a stale getState() reference to the
// OLD store while components bind to the NEW empty one, breaking playback.

const STORE_KEY = '__chatcut_editor_store__' as const;

function createStore() {
  return create<EditorStore>((...args) => ({
    ...createAssetsSlice(...args),
    ...createProjectSlice(...args),
    ...createPlaybackSlice(...args),
    ...createChatSlice(...args),
    ...createUiSlice(...args),
    ...createTimelineViewSlice(...args),
    ...createHistorySlice(...args),
  }));
}

/**
 * Validate that a cached store's state shape matches the current schema.
 * Returns false if any expected field is missing or has the wrong type,
 * which triggers a fresh store creation. This makes globalThis caching
 * automatically self-healing after schema changes — no manual version
 * bumps needed.
 */
function isStoreShapeValid(store: ReturnType<typeof createStore>): boolean {
  try {
    const s = store.getState();
    return (
      s != null &&
      typeof s.project === 'object' &&
      Array.isArray(s.project?.tracks) &&
      s.project.tracks.every((t) =>
        typeof t.visible === 'boolean' && typeof t.volume === 'number'
      ) &&
      typeof s.ui === 'object' &&
      Array.isArray(s.ui?.selectedClipIds) &&
      typeof s.ui?.linkedSelectionEnabled === 'boolean' &&
      typeof s.timeline === 'object' &&
      typeof s.timeline?.pixelsPerSecond === 'number' &&
      typeof s.setSelectedClip === 'function' &&
      typeof s.toggleClipSelection === 'function' &&
      Array.isArray(s.editHistory) &&
      (s.editHistory.length === 0 || 'snapshot' in s.editHistory[0]) &&
      'activeNodeId' in s &&
      (s.activeNodeId === null || typeof s.activeNodeId === 'string') &&
      // W2 Asset model: a pre-rename cached store (mediaFiles key) is stale.
      s.assets instanceof Map
    );
  } catch {
    return false;
  }
}

const cached = (globalThis as Record<string, unknown>)[STORE_KEY] as ReturnType<typeof createStore> | undefined;
export const useEditorStore = (cached && isStoreShapeValid(cached)) ? cached : (() => {
  const store = createStore();
  (globalThis as Record<string, unknown>)[STORE_KEY] = store;
  return store;
})();

// DEV-ONLY: Expose store on window for debugging.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>).__chatcut_store__ = useEditorStore;
}

// ─── Undo Helpers ───────────────────────────────────────────────────────────

/**
 * Wraps a synchronous operation in an undo batch. Captures state before,
 * runs the function, then pushes a single undo entry for the entire change.
 * Use for one-shot operations like delete. For drag gestures, use
 * beginUndoBatch/commitUndoBatch directly.
 */
export function withUndo(description: string, fn: () => void): void {
  const store = useEditorStore.getState();
  store.beginUndoBatch(description);
  try {
    fn();
    store.commitUndoBatch();
  } catch (e) {
    store.cancelUndoBatch();
    throw e;
  }
}
