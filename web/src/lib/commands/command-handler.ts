/**
 * ChatCut — Command Handler
 *
 * Thin wrapper for UI-triggered edit actions that need automatic undo capture.
 * Agent-driven edits go through the tool registry instead; only the razor/cut
 * path is dispatched from the timeline UI today.
 */

import { useEditorStore } from '@/lib/store/editor-store';
import type { CutAction, Track, PlaybackState } from '@/types/editor';

/**
 * Execute a cut (razor split) on a clip, capturing undo state automatically.
 */
export function executeAction(action: CutAction): { success: boolean; message: string } {
  const store = useEditorStore.getState();

  const previousTracks = structuredClone(store.project.tracks);
  const previousPlayback = structuredClone(store.playback);

  try {
    return handleCut(action);
  } finally {
    const afterStore = useEditorStore.getState();
    const afterTracks = structuredClone(afterStore.project.tracks);
    const afterPlayback = structuredClone(afterStore.playback);

    // Only push undo if state actually changed
    if (JSON.stringify(previousTracks) !== JSON.stringify(afterTracks) ||
        JSON.stringify(previousPlayback) !== JSON.stringify(afterPlayback)) {
      store.pushUndo({
        description: `Cut at ${action.time}s`,
        previousState: {
          tracks: previousTracks as Track[],
          playback: previousPlayback as PlaybackState,
        },
        nextState: {
          tracks: afterTracks as Track[],
          playback: afterPlayback as PlaybackState,
        },
      });
    }
  }
}

function handleCut(action: CutAction): { success: boolean; message: string } {
  const store = useEditorStore.getState();
  const result = store.splitClip(action.clipId, action.time);
  if (!result) {
    return { success: false, message: 'Could not split clip — check that the time is within the clip range' };
  }
  const [, clip2] = result;
  return { success: true, message: `Split clip at ${action.time.toFixed(1)}s — created new clip "${clip2.id.slice(0, 6)}…"` };
}
