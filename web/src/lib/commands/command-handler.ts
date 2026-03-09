/**
 * ChatCut — Command Handler
 *
 * Every edit in the editor goes through this system. This enables:
 *  1. Undo/redo — every command captures before/after state
 *  2. Consistency — both AI actions and manual UI actions use the same path
 *  3. Logging — every edit is recorded with a description
 *  4. Future: replay, collaboration, macro recording
 *
 * The AI action mapper produces EditActions → this handler converts them
 * into Commands and applies them to the store.
 */

import { useEditorStore } from '@/lib/store/editor-store';
import { getVideoEngine } from '@/lib/engine/video-engine';
import type {
  EditAction,
  ZoomAction,
  PositionAction,
  OpacityAction,
  RotationAction,
  FilterAction,
  VolumeAction,
  PlaybackRateAction,
  ApplyEffectAction,
  RemoveEffectAction,
  UpdateEffectAction,
  ToggleEffectAction,
  Track,
  PlaybackState,
} from '@/types/editor';
import { getEffectDescriptor } from '@/lib/effects/registry';

/**
 * Execute an editing action from the AI or from the UI.
 * Captures undo state automatically.
 */
export function executeAction(action: EditAction): { success: boolean; message: string } {
  const store = useEditorStore.getState();
  const clip = store.getActiveClip();
  const engine = getVideoEngine();

  // Capture state before the action for undo
  const previousTracks = structuredClone(store.project.tracks);
  const previousPlayback = structuredClone(store.playback);

  try {
    switch (action.type) {
      case 'zoom':
        return handleZoom(action, clip?.id);

      case 'position':
        return handlePosition(action, clip?.id);

      case 'opacity':
        return handleOpacity(action, clip?.id);

      case 'rotation':
        return handleRotation(action, clip?.id);

      case 'filter':
        return handleFilter(action, clip?.id);

      case 'volume':
        return handleVolume(action, engine);

      case 'playbackRate':
        return handlePlaybackRate(action, engine);

      case 'cut':
        return handleCut(action);

      case 'trim':
        return handleTrim(action);

      case 'deleteClip':
        return handleDeleteClip(action);

      case 'applyEffect':
        return handleApplyEffect(action, clip?.id);

      case 'removeEffect':
        return handleRemoveEffect(action, clip?.id);

      case 'updateEffect':
        return handleUpdateEffect(action, clip?.id);

      case 'toggleEffect':
        return handleToggleEffect(action, clip?.id);

      default:
        return { success: false, message: `Unknown action type: ${(action as EditAction).type}` };
    }
  } finally {
    // Capture state after the action
    const afterStore = useEditorStore.getState();
    const afterTracks = structuredClone(afterStore.project.tracks);
    const afterPlayback = structuredClone(afterStore.playback);

    // Only push undo if state actually changed
    if (JSON.stringify(previousTracks) !== JSON.stringify(afterTracks) ||
        JSON.stringify(previousPlayback) !== JSON.stringify(afterPlayback)) {
      store.pushUndo({
        description: describeAction(action),
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

/**
 * Execute multiple actions in sequence.
 */
export function executeActions(actions: EditAction[]): { success: boolean; message: string }[] {
  return actions.map((action) => executeAction(action));
}

// ─── Individual Action Handlers ─────────────────────────────────────────────

function handleZoom(action: ZoomAction, clipId?: string | null): { success: boolean; message: string } {
  if (!clipId) return { success: false, message: 'No clip selected' };

  const store = useEditorStore.getState();
  const engine = getVideoEngine();

  if (action.animated && action.duration) {
    engine.animateTransform(clipId, 'scale', action.scale, action.duration);
    return { success: true, message: `Animating zoom to ${Math.round(action.scale * 100)}% over ${action.duration}s` };
  }

  store.updateTransform(clipId, { scale: action.scale });
  return { success: true, message: `Zoomed to ${Math.round(action.scale * 100)}%` };
}

function handlePosition(action: PositionAction, clipId?: string | null): { success: boolean; message: string } {
  if (!clipId) return { success: false, message: 'No clip selected' };

  const store = useEditorStore.getState();
  const engine = getVideoEngine();

  if (action.animated && action.duration) {
    engine.animateTransform(clipId, 'positionX', action.x, action.duration);
    engine.animateTransform(clipId, 'positionY', action.y, action.duration);
    return { success: true, message: `Animating position to (${action.x}, ${action.y}) over ${action.duration}s` };
  }

  store.updateTransform(clipId, { positionX: action.x, positionY: action.y });
  return { success: true, message: `Moved to position (${action.x}, ${action.y})` };
}

function handleOpacity(action: OpacityAction, clipId?: string | null): { success: boolean; message: string } {
  if (!clipId) return { success: false, message: 'No clip selected' };

  const store = useEditorStore.getState();
  const engine = getVideoEngine();

  if (action.animated && action.duration) {
    engine.animateTransform(clipId, 'opacity', action.value, action.duration);
    return { success: true, message: `Animating opacity to ${Math.round(action.value * 100)}% over ${action.duration}s` };
  }

  store.updateTransform(clipId, { opacity: action.value });
  return { success: true, message: `Set opacity to ${Math.round(action.value * 100)}%` };
}

function handleRotation(action: RotationAction, clipId?: string | null): { success: boolean; message: string } {
  if (!clipId) return { success: false, message: 'No clip selected' };

  const store = useEditorStore.getState();
  const engine = getVideoEngine();

  if (action.animated && action.duration) {
    engine.animateTransform(clipId, 'rotation', action.degrees, action.duration);
    return { success: true, message: `Animating rotation to ${action.degrees}° over ${action.duration}s` };
  }

  store.updateTransform(clipId, { rotation: action.degrees });
  return { success: true, message: `Rotated to ${action.degrees}°` };
}

function handleFilter(action: FilterAction, clipId?: string | null): { success: boolean; message: string } {
  if (!clipId) return { success: false, message: 'No clip selected' };

  const store = useEditorStore.getState();
  const engine = getVideoEngine();

  if (action.animated && action.duration) {
    engine.animateTransform(clipId, `filters.${action.filter}`, action.value, action.duration);
    return { success: true, message: `Animating ${action.filter} to ${action.value} over ${action.duration}s` };
  }

  store.updateFilter(clipId, action.filter, action.value);
  return { success: true, message: `Set ${action.filter} to ${action.value}` };
}

function handleVolume(action: VolumeAction, engine: ReturnType<typeof getVideoEngine>): { success: boolean; message: string } {
  const store = useEditorStore.getState();
  store.setVolume(action.value);
  engine.setVolume(action.value);
  return { success: true, message: `Set volume to ${Math.round(action.value * 100)}%` };
}

function handlePlaybackRate(action: PlaybackRateAction, engine: ReturnType<typeof getVideoEngine>): { success: boolean; message: string } {
  const store = useEditorStore.getState();
  store.setPlaybackRate(action.value);
  engine.setPlaybackRate(action.value);
  return { success: true, message: `Set playback speed to ${action.value}x` };
}

function handleCut(action: { type: 'cut'; clipId: string; time: number }): { success: boolean; message: string } {
  const store = useEditorStore.getState();
  const result = store.splitClip(action.clipId, action.time);
  if (!result) {
    return { success: false, message: 'Could not split clip — check that the time is within the clip range' };
  }
  const [, clip2] = result;
  return { success: true, message: `Split clip at ${action.time.toFixed(1)}s — created new clip "${clip2.id.slice(0, 6)}…"` };
}

function handleTrim(action: { type: 'trim'; clipId: string; start?: number; end?: number }): { success: boolean; message: string } {
  const store = useEditorStore.getState();

  // Find the clip to get current values
  let clip: import('@/types/editor').Clip | undefined;
  for (const track of store.project.tracks) {
    clip = track.clips.find((c) => c.id === action.clipId);
    if (clip) break;
  }
  if (!clip) return { success: false, message: 'Clip not found' };

  if (action.start !== undefined) {
    const newTimelineStart = clip.timelineStart + (action.start - clip.sourceStart);
    store.trimClipStart(action.clipId, action.start, newTimelineStart);
  }
  if (action.end !== undefined) {
    store.trimClipEnd(action.clipId, action.end);
  }

  const parts: string[] = [];
  if (action.start !== undefined) parts.push(`start to ${action.start.toFixed(1)}s`);
  if (action.end !== undefined) parts.push(`end to ${action.end.toFixed(1)}s`);
  return { success: true, message: `Trimmed clip ${parts.join(' and ')}` };
}

function handleDeleteClip(action: { type: 'deleteClip'; clipId: string }): { success: boolean; message: string } {
  const store = useEditorStore.getState();
  store.removeClip(action.clipId);
  return { success: true, message: 'Clip deleted' };
}

// ─── Effect Action Handlers ─────────────────────────────────────────────────

function handleApplyEffect(action: ApplyEffectAction, clipId?: string | null): { success: boolean; message: string } {
  const targetClipId = action.clipId ?? clipId;
  if (!targetClipId) return { success: false, message: 'No clip selected' };

  const descriptor = getEffectDescriptor(action.effectId);
  if (!descriptor) return { success: false, message: `Unknown effect: ${action.effectId}` };

  const store = useEditorStore.getState();

  // Merge descriptor defaults with provided parameters
  const params: Record<string, number> = {};
  for (const paramDef of descriptor.parameters) {
    params[paramDef.id] = action.parameters[paramDef.id] ?? paramDef.default;
  }

  const result = store.addEffect(targetClipId, action.effectId, params);
  if (!result) return { success: false, message: 'Failed to add effect' };

  return { success: true, message: `Applied ${descriptor.name}` };
}

function handleRemoveEffect(action: RemoveEffectAction, clipId?: string | null): { success: boolean; message: string } {
  const targetClipId = action.clipId ?? clipId;
  if (!targetClipId) return { success: false, message: 'No clip selected' };

  const store = useEditorStore.getState();
  store.removeEffect(targetClipId, action.appliedEffectId);
  return { success: true, message: 'Effect removed' };
}

function handleUpdateEffect(action: UpdateEffectAction, clipId?: string | null): { success: boolean; message: string } {
  const targetClipId = action.clipId ?? clipId;
  if (!targetClipId) return { success: false, message: 'No clip selected' };

  const store = useEditorStore.getState();
  store.updateEffect(targetClipId, action.appliedEffectId, action.parameters);
  return { success: true, message: 'Effect updated' };
}

function handleToggleEffect(action: ToggleEffectAction, clipId?: string | null): { success: boolean; message: string } {
  const targetClipId = action.clipId ?? clipId;
  if (!targetClipId) return { success: false, message: 'No clip selected' };

  const store = useEditorStore.getState();
  store.toggleEffect(targetClipId, action.appliedEffectId, action.enabled);
  return { success: true, message: action.enabled ? 'Effect enabled' : 'Effect disabled' };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function describeAction(action: EditAction): string {
  switch (action.type) {
    case 'zoom': return `Zoom to ${Math.round(action.scale * 100)}%`;
    case 'position': return `Move to (${action.x}, ${action.y})`;
    case 'opacity': return `Opacity to ${Math.round(action.value * 100)}%`;
    case 'rotation': return `Rotate to ${action.degrees}°`;
    case 'filter': return `Set ${action.filter} to ${action.value}`;
    case 'volume': return `Volume to ${Math.round(action.value * 100)}%`;
    case 'playbackRate': return `Speed to ${action.value}x`;
    case 'cut': return `Cut at ${action.time}s`;
    case 'trim': return `Trim clip`;
    case 'deleteClip': return `Delete clip`;
    case 'applyEffect': {
      const desc = getEffectDescriptor(action.effectId);
      return `Apply ${desc?.name ?? action.effectId}`;
    }
    case 'removeEffect': return `Remove effect`;
    case 'updateEffect': return `Update effect`;
    case 'toggleEffect': return `${action.enabled ? 'Enable' : 'Disable'} effect`;
    default: return 'Unknown action';
  }
}
