/**
 * ChatCut Editor — Central State Store
 *
 * Uses Zustand with slices for organization.
 * The store is the single source of truth for the entire editor.
 *
 * ──── SLICE INDEPENDENCE ────
 *
 * The store is divided into independent slices. Each slice's actions should
 * ONLY modify their own slice. Cross-slice interactions must be explicitly
 * documented. This prevents feature additions (e.g. clip linking) from
 * accidentally breaking unrelated features (e.g. playback).
 *
 *   PLAYBACK SLICE (playback.*):
 *     Modified by: setPlaying, setCurrentTime, setVolume, toggleMute,
 *                  setPlaybackRate, VideoEngine render loop
 *     Cross-slice: removeClip resets playback when timeline becomes empty
 *
 *   PROJECT SLICE (project.*):
 *     Modified by: clip/track actions (add, remove, move, trim, split, link)
 *     Cross-slice: NEVER modifies playback state (except removeClip edge case)
 *
 *   UI SLICE (ui.*):
 *     Modified by: setActivePanel, togglePanel, setSelectedClip
 *     Cross-slice: addClipFromMedia sets selectedClipIds
 *
 *   TIMELINE SLICE (timeline.*):
 *     Modified by: setTimelineZoom, setSnapEnabled, setActiveTool
 *     Cross-slice: none
 *
 * IMPORTANT: The VideoEngine reads from this store DIRECTLY (not through React)
 * via `useEditorStore.getState()` to avoid rendering-induced frame drops.
 */

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import { getVideoEngine } from '@/lib/engine/video-engine';
import {
  type Project,
  type Track,
  type Clip,
  type MediaFile,
  type PlaybackState,
  type ChatMessage,
  type EditorPanel,
  type UIState,
  type TimelineState,
  type TimelineTool,
  type TrackType,
  type Transform,
  type FilterState,
  type Command,
  type AppliedEffect,
  DEFAULT_PLAYBACK,
  DEFAULT_TRANSFORM,
  DEFAULT_UI_STATE,
  DEFAULT_TIMELINE_STATE,
} from '@/types/editor';
import { createDefaultEffects, effectsToTransform } from '@/lib/effects/transform-bridge';
import type { EffectKeyframe } from '@/types/effects';

// ─── Store Interface ────────────────────────────────────────────────────────

export interface EditorStore {
  // ── Project State ──
  project: Project;
  mediaFiles: Map<string, MediaFile>;

  // ── Playback ──
  playback: PlaybackState;

  // ── Chat ──
  chatMessages: ChatMessage[];
  isChatLoading: boolean;

  // ── UI ──
  ui: UIState;

  // ── Timeline ──
  timeline: TimelineState;

  // ── Undo/Redo ──
  undoStack: Command[];
  redoStack: Command[];
  _undoBatch: { description: string; snapshotTracks: Track[]; snapshotPlayback: PlaybackState } | null;

  // ── Project Actions ──
  initProject: (name: string, width: number, height: number, fps: number) => void;
  addMediaFile: (file: File) => Promise<MediaFile>;
  addMediaFileFromPath: (filePath: string, fileName: string) => Promise<MediaFile>;
  addClipFromMedia: (mediaFile: MediaFile, trackId?: string, timelineStart?: number) => Clip;
  removeClip: (clipId: string) => void;

  // ── Transform Actions ──
  updateTransform: (clipId: string, transform: Partial<Transform>) => void;
  updateFilter: (clipId: string, filter: keyof FilterState, value: number) => void;
  resetTransform: (clipId: string) => void;
  batchUpdateTransform: (clipIds: string[], delta: Partial<Transform>) => void;

  // ── Effect Actions ──
  addEffect: (clipId: string, effectId: string, parameters?: Record<string, number>) => AppliedEffect | null;
  removeEffect: (clipId: string, appliedEffectId: string) => void;
  updateEffect: (clipId: string, appliedEffectId: string, parameters: Record<string, number>) => void;
  toggleEffect: (clipId: string, appliedEffectId: string, enabled: boolean) => void;
  reorderEffects: (clipId: string, appliedEffectIds: string[]) => void;
  getClipEffects: (clipId: string) => AppliedEffect[];

  // ── Keyframe Actions ──
  addKeyframe: (clipId: string, effectId: string, parameterId: string, time: number, value: number, interpolation?: import('@/types/effects').KeyframeInterpolation) => import('@/types/effects').EffectKeyframe;
  removeKeyframe: (clipId: string, effectId: string, keyframeId: string) => void;
  updateKeyframe: (clipId: string, effectId: string, keyframeId: string, updates: Partial<Pick<import('@/types/effects').EffectKeyframe, 'time' | 'value' | 'interpolation' | 'bezierHandles'>>) => void;
  getPropertyKeyframes: (clipId: string, effectId: string, parameterId: string) => import('@/types/effects').EffectKeyframe[];
  clearPropertyKeyframes: (clipId: string, effectId: string, parameterId: string) => void;

  // ── Timeline Actions ──
  setTimelineZoom: (pixelsPerSecond: number) => void;
  setTimelinePanelHeight: (height: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setActiveTool: (tool: TimelineTool) => void;

  // ── Clip Manipulation (Timeline) ──
  moveClip: (clipId: string, newTimelineStart: number, newTrackId?: string) => void;
  moveSelectedClips: (deltaSeconds: number, basePositions?: Record<string, number>) => void;
  trimClipStart: (clipId: string, newSourceStart: number, newTimelineStart: number) => void;
  trimClipEnd: (clipId: string, newSourceEnd: number) => void;
  splitClip: (clipId: string, splitTimeSeconds: number) => [Clip, Clip] | null;
  freezeFrame: (clipId: string, atTime: number, duration?: number) => Clip | null;
  addTrack: (type: TrackType, label?: string) => Track;

  // ── Linked Clip Actions ──
  getLinkedClips: (clipId: string) => Clip[];
  unlinkClip: (clipId: string) => void;
  linkClips: (clipIds: string[]) => void;
  toggleLinkForSelection: () => void;
  setLinkedSelectionEnabled: (enabled: boolean) => void;

  // ── Playback Actions ──
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;

  // ── Chat Actions ──
  addChatMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateChatMessage: (id: string, updates: Partial<ChatMessage>) => void;
  setChatLoading: (loading: boolean) => void;
  clearChat: () => void;

  // ── UI Actions ──
  setActivePanel: (panel: UIState['activePanel']) => void;
  togglePanel: (panel: EditorPanel) => void;
  setSelectedClip: (clipId: string | null) => void;
  toggleClipSelection: (clipId: string) => void;

  // ── Provenance Actions ──
  setProvenance: (clipId: string, path: string, entry: import('@/types/editor').ProvenanceEntry) => void;
  clearPropertyProvenance: (clipId: string, path: string) => void;
  acceptAIChange: (clipId: string, path: string) => void;
  revertAIChange: (clipId: string, path: string) => void;
  acceptAllAIChanges: (clipId: string) => void;
  revertAllAIChanges: (clipId: string) => void;

  // ── Undo/Redo ──
  pushUndo: (command: Omit<Command, 'id' | 'timestamp'>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  beginUndoBatch: (description: string) => void;
  commitUndoBatch: () => void;
  cancelUndoBatch: () => void;

  // ── Helpers ──
  getActiveClip: () => Clip | null;
  getClipById: (clipId: string) => Clip | null;
  getClipAtTime: (time: number) => Clip | null;
  getDuration: () => number;
}

// ─── Default Project ────────────────────────────────────────────────────────

/** Default track properties shared by all new tracks. */
const defaultTrackProps = {
  clips: [] as Clip[],
  muted: false,
  locked: false,
  visible: true,
  volume: 1,
  pan: 0,
  solo: false,
} as const;

/**
 * Creates the default project with 3 video tracks and 3 audio tracks.
 *
 * Track order in the array matches the Premiere Pro visual layout (top-to-bottom):
 *   V3 (topmost video — highest compositing priority / foreground)
 *   V2
 *   V1 (bottommost video — lowest compositing priority / background)
 *   A1 (topmost audio — default audio track)
 *   A2
 *   A3 (bottommost audio)
 *
 * Clips default to V1 and A1 (the "main" tracks).
 */
const createDefaultProject = (): Project => ({
  id: uuid(),
  name: 'Untitled Project',
  composition: {
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 0,
  },
  tracks: [
    { id: uuid(), type: 'video', label: 'V3', ...defaultTrackProps },
    { id: uuid(), type: 'video', label: 'V2', ...defaultTrackProps },
    { id: uuid(), type: 'video', label: 'V1', ...defaultTrackProps },
    { id: uuid(), type: 'audio', label: 'A1', ...defaultTrackProps },
    { id: uuid(), type: 'audio', label: 'A2', ...defaultTrackProps },
    { id: uuid(), type: 'audio', label: 'A3', ...defaultTrackProps },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

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
  return create<EditorStore>((set, get) => ({
  // ── Initial State ──
  project: createDefaultProject(),
  mediaFiles: new Map(),
  playback: { ...DEFAULT_PLAYBACK },
  chatMessages: [],
  isChatLoading: false,
  ui: { ...DEFAULT_UI_STATE },
  timeline: { ...DEFAULT_TIMELINE_STATE },
  undoStack: [],
  redoStack: [],
  _undoBatch: null,

  // ── Project Actions ──

  initProject: (name, width, height, fps) => {
    set({
      project: {
        ...createDefaultProject(),
        name,
        composition: { width, height, fps, duration: 0 },
      },
      chatMessages: [],
      undoStack: [],
      redoStack: [],
    });
  },

  addMediaFile: async (file: File): Promise<MediaFile> => {
    const blobUrl = URL.createObjectURL(file);
    const mediaFile: MediaFile = {
      id: uuid(),
      name: file.name,
      type: detectMediaType(file),
      previewUrl: blobUrl,
      nativePath: null, // Browser mode — no native path
      file,
      duration: 0,
      width: undefined,
      height: undefined,
    };

    // Probe video/audio for duration and dimensions
    if (mediaFile.type === 'video' || mediaFile.type === 'audio') {
      const metadata = await probeMediaDuration(blobUrl, mediaFile.type);
      mediaFile.duration = metadata.duration;
      if (metadata.width) mediaFile.width = metadata.width;
      if (metadata.height) mediaFile.height = metadata.height;
    }

    set((state) => {
      const newMap = new Map(state.mediaFiles);
      newMap.set(mediaFile.id, mediaFile);
      return { mediaFiles: newMap };
    });

    return mediaFile;
  },

  addMediaFileFromPath: async (filePath: string, fileName: string): Promise<MediaFile> => {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'];
    const audioExts = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'];
    const fileType: 'video' | 'audio' | 'image' = videoExts.includes(ext)
      ? 'video'
      : audioExts.includes(ext)
        ? 'audio'
        : 'image';

    // For video/audio: always read via the FS plugin and create a blob URL.
    // The Tauri asset protocol doesn't support HTTP Range requests that
    // <video>/<audio> elements need for streaming playback on macOS.
    // For images: the asset protocol works fine (no range requests needed).
    let previewUrl: string;

    if (fileType === 'video' || fileType === 'audio') {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(filePath);
      const mimeMap: Record<string, string> = {
        mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
        mkv: 'video/x-matroska', webm: 'video/webm', m4v: 'video/x-m4v',
        mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
        flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
      };
      const mime = mimeMap[ext] || (fileType === 'audio' ? 'audio/mpeg' : 'video/mp4');
      const blob = new Blob([bytes], { type: mime });
      previewUrl = URL.createObjectURL(blob);
    } else {
      const { convertFileSrc } = await import('@/lib/tauri/bridge');
      previewUrl = await convertFileSrc(filePath);
    }

    const mediaFile: MediaFile = {
      id: uuid(),
      name: fileName,
      type: fileType,
      previewUrl,
      nativePath: filePath,
      duration: 0,
      width: undefined,
      height: undefined,
    };

    // Probe for duration/dimensions
    if (mediaFile.type === 'video' || mediaFile.type === 'audio') {
      const metadata = await probeMediaDuration(previewUrl, mediaFile.type, filePath);
      mediaFile.duration = metadata.duration;
      if (metadata.width) mediaFile.width = metadata.width;
      if (metadata.height) mediaFile.height = metadata.height;
    }

    set((state) => {
      const newMap = new Map(state.mediaFiles);
      newMap.set(mediaFile.id, mediaFile);
      return { mediaFiles: newMap };
    });

    return mediaFile;
  },

  addClipFromMedia: (mediaFile: MediaFile, trackId?: string, timelineStart?: number) => {
    // capture previous project state for undo
    const prevTracks = structuredClone(get().project.tracks);
    const prevPlayback = structuredClone(get().playback);

    const state = get();
    // Find the target track.
    // Default: V1 (the last video track in the array — the background/main track).
    // This matches Premiere Pro behavior where new clips go to the lowest video track.
    const videoTracks = state.project.tracks.filter((t) => t.type === 'video');
    const targetTrack = trackId
      ? state.project.tracks.find((t) => t.id === trackId)
      : videoTracks[videoTracks.length - 1];

    if (!targetTrack) throw new Error('No suitable track found');

    // Place the clip at the specified position, or after existing clips
    const startPos = timelineStart ?? targetTrack.clips.reduce(
      (max, clip) => Math.max(max, clip.timelineStart + (clip.sourceEnd - clip.sourceStart)),
      0
    );

    // For video files, create a shared linkId for the video+audio pair
    const sharedLinkId = mediaFile.type === 'video' ? uuid() : null;

    const clip: Clip = {
      id: uuid(),
      type: mediaFile.type === 'video' ? 'video' : mediaFile.type === 'audio' ? 'audio' : 'image',
      sourceFileId: mediaFile.id,
      sourceStart: 0,
      sourceEnd: mediaFile.duration,
      timelineStart: startPos,
      linkId: sharedLinkId,
      transform: { ...DEFAULT_TRANSFORM, filters: { ...DEFAULT_TRANSFORM.filters } },
      effects: createDefaultEffects(),
      provenance: {},
      transitions: [],
    };

    // For video files, also create a linked audio clip on the audio track
    let audioClip: Clip | null = null;
    if (mediaFile.type === 'video') {
      const audioTrack = state.project.tracks.find((t) => t.type === 'audio');
      if (audioTrack) {
        audioClip = {
          id: uuid(),
          type: 'audio',
          sourceFileId: mediaFile.id,
          sourceStart: 0,
          sourceEnd: mediaFile.duration,
          timelineStart: startPos,
          linkId: sharedLinkId,
          transform: { ...DEFAULT_TRANSFORM, filters: { ...DEFAULT_TRANSFORM.filters } },
          effects: createDefaultEffects(),
          provenance: {},
          transitions: [],
        };
      }
    }

    set((state) => {
      const audioTrack = state.project.tracks.find((t) => t.type === 'audio');
      const newTracks = state.project.tracks.map((track) => {
        if (track.id === targetTrack.id) {
          return { ...track, clips: [...track.clips, clip] };
        }
        if (audioClip && audioTrack && track.id === audioTrack.id) {
          return { ...track, clips: [...track.clips, audioClip] };
        }
        return track;
      });

      // Recalculate composition duration
      const duration = calculateDuration(newTracks);

      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, duration },
          updatedAt: Date.now(),
        },
        ui: { ...state.ui, selectedClipIds: [clip.id] },
      };
    });

    // push undo entry for clip addition
    const afterTracks = structuredClone(get().project.tracks);
    const afterPlayback = structuredClone(get().playback);
    get().pushUndo({
      description: 'Add clip',
      previousState: { tracks: prevTracks, playback: prevPlayback },
      nextState: { tracks: afterTracks, playback: afterPlayback },
    });

    return clip;
  },

  removeClip: (clipId: string) => {
    const prevState = get();

    // Find the clip being removed so we can determine linked clips
    let removedClip: Clip | null = null;
    for (const track of prevState.project.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) { removedClip = found; break; }
    }

    // Collect all clip IDs to remove (include linked clips when linked selection is on)
    const idsToRemove = new Set<string>([clipId]);
    if (removedClip?.linkId && prevState.ui.linkedSelectionEnabled) {
      for (const track of prevState.project.tracks) {
        for (const c of track.clips) {
          if (c.linkId === removedClip.linkId) {
            idsToRemove.add(c.id);
          }
        }
      }
    }

    // Collect all source file IDs referenced by removed clips
    const removedSourceIds = new Set<string>();
    for (const track of prevState.project.tracks) {
      for (const c of track.clips) {
        if (idsToRemove.has(c.id)) {
          removedSourceIds.add(c.sourceFileId);
        }
      }
    }

    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((c) => !idsToRemove.has(c.id)),
      }));
      const duration = calculateDuration(newTracks);
      const hasClipsLeft = newTracks.some((t) => t.clips.length > 0);

      // Revoke blob URLs for media files no longer referenced
      let newMediaFiles = state.mediaFiles;
      for (const sourceId of removedSourceIds) {
        const stillReferenced = newTracks.some((t) =>
          t.clips.some((c) => c.sourceFileId === sourceId)
        );
        if (!stillReferenced) {
          if (newMediaFiles === state.mediaFiles) {
            newMediaFiles = new Map(state.mediaFiles);
          }
          const mediaFile = newMediaFiles.get(sourceId);
          if (mediaFile?.previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(mediaFile.previewUrl);
          }
          newMediaFiles.delete(sourceId);
        }
      }

      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, duration },
          updatedAt: Date.now(),
        },
        mediaFiles: newMediaFiles,
        ui: {
          ...state.ui,
          selectedClipIds: state.ui.selectedClipIds.filter((id) => !idsToRemove.has(id)),
        },
        // Reset playback when the timeline becomes empty
        ...(hasClipsLeft
          ? {}
          : { playback: { ...state.playback, isPlaying: false, currentTime: 0 } }),
      };
    });
  },

  // ── Transform Actions ──

  updateTransform: (clipId, transformUpdate) => {
    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id === clipId) {
            const newTransform = { ...clip.transform, ...transformUpdate };
            // Sync built-in effects from the updated transform
            const newEffects = syncEffectsFromTransform(clip.effects, newTransform);
            return {
              ...clip,
              transform: newTransform,
              effects: newEffects,
            };
          }
          return clip;
        }),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  updateFilter: (clipId, filter, value) => {
    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id === clipId) {
            const newTransform = {
              ...clip.transform,
              filters: { ...clip.transform.filters, [filter]: value },
            };
            const newEffects = syncEffectsFromTransform(clip.effects, newTransform);
            return {
              ...clip,
              transform: newTransform,
              effects: newEffects,
            };
          }
          return clip;
        }),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  resetTransform: (clipId) => {
    get().updateTransform(clipId, { ...DEFAULT_TRANSFORM, filters: { ...DEFAULT_TRANSFORM.filters } });
    // Also reset the effects array to defaults
    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id === clipId) {
            return { ...clip, effects: createDefaultEffects() };
          }
          return clip;
        }),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  batchUpdateTransform: (clipIds, delta) => {
    set((state) => {
      const idSet = new Set(clipIds);
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (!idSet.has(clip.id)) return clip;
          const newTransform = { ...clip.transform };
          if (delta.positionX !== undefined) newTransform.positionX += delta.positionX;
          if (delta.positionY !== undefined) newTransform.positionY += delta.positionY;
          if (delta.scale !== undefined) newTransform.scale += delta.scale;
          if (delta.rotation !== undefined) newTransform.rotation += delta.rotation;
          if (delta.opacity !== undefined) newTransform.opacity = Math.max(0, Math.min(1, clip.transform.opacity + delta.opacity));
          const newEffects = syncEffectsFromTransform(clip.effects, newTransform);
          return { ...clip, transform: newTransform, effects: newEffects };
        }),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  // ── Effect Actions ──

  addEffect: (clipId, effectId, parameters) => {
    const newEffect: AppliedEffect = {
      id: uuid(),
      effectId,
      parameters: parameters ?? {},
      keyframes: [],
      enabled: true,
    };

    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id === clipId) {
            const newEffects = [...clip.effects, newEffect];
            return {
              ...clip,
              effects: newEffects,
              transform: effectsToTransform(newEffects),
            };
          }
          return clip;
        }),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });

    return newEffect;
  },

  removeEffect: (clipId, appliedEffectId) => {
    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id === clipId) {
            const newEffects = clip.effects.filter((e) => e.id !== appliedEffectId);
            return {
              ...clip,
              effects: newEffects,
              transform: effectsToTransform(newEffects),
            };
          }
          return clip;
        }),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  updateEffect: (clipId, appliedEffectId, parameters) => {
    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id === clipId) {
            const newEffects = clip.effects.map((e) => {
              if (e.id === appliedEffectId) {
                return { ...e, parameters: { ...e.parameters, ...parameters } };
              }
              return e;
            });
            return {
              ...clip,
              effects: newEffects,
              transform: effectsToTransform(newEffects),
            };
          }
          return clip;
        }),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  toggleEffect: (clipId, appliedEffectId, enabled) => {
    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id === clipId) {
            const newEffects = clip.effects.map((e) => {
              if (e.id === appliedEffectId) {
                return { ...e, enabled };
              }
              return e;
            });
            return {
              ...clip,
              effects: newEffects,
              transform: effectsToTransform(newEffects),
            };
          }
          return clip;
        }),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  reorderEffects: (clipId, appliedEffectIds) => {
    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== clipId) return clip;
          const effectMap = new Map(clip.effects.map((e) => [e.id, e]));
          const reordered: AppliedEffect[] = [];
          for (const id of appliedEffectIds) {
            const effect = effectMap.get(id);
            if (effect) reordered.push(effect);
          }
          for (const e of clip.effects) {
            if (!appliedEffectIds.includes(e.id)) reordered.push(e);
          }
          return {
            ...clip,
            effects: reordered,
            transform: effectsToTransform(reordered),
          };
        }),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  getClipEffects: (clipId) => {
    const state = get();
    for (const track of state.project.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip.effects;
    }
    return [];
  },

  // ── Keyframe Actions ──

  addKeyframe: (clipId, effectId, parameterId, time, value, interpolation = 'linear') => {
    const kf: EffectKeyframe = {
      id: uuid(),
      time,
      parameterId,
      value,
      interpolation,
    };
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            return {
              ...clip,
              effects: clip.effects.map((e) =>
                e.id === effectId
                  ? { ...e, keyframes: [...e.keyframes, kf].sort((a, b) => a.time - b.time) }
                  : e
              ),
            };
          }),
        })),
        updatedAt: Date.now(),
      },
    }));
    return kf;
  },

  removeKeyframe: (clipId, effectId, keyframeId) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            return {
              ...clip,
              effects: clip.effects.map((e) =>
                e.id === effectId
                  ? { ...e, keyframes: e.keyframes.filter((k) => k.id !== keyframeId) }
                  : e
              ),
            };
          }),
        })),
        updatedAt: Date.now(),
      },
    }));
  },

  updateKeyframe: (clipId, effectId, keyframeId, updates) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            return {
              ...clip,
              effects: clip.effects.map((e) =>
                e.id === effectId
                  ? {
                      ...e,
                      keyframes: e.keyframes
                        .map((k) => (k.id === keyframeId ? { ...k, ...updates } : k))
                        .sort((a, b) => a.time - b.time),
                    }
                  : e
              ),
            };
          }),
        })),
        updatedAt: Date.now(),
      },
    }));
  },

  getPropertyKeyframes: (clipId, effectId, parameterId) => {
    const state = get();
    for (const track of state.project.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) {
        const effect = clip.effects.find((e) => e.id === effectId);
        if (effect) return effect.keyframes.filter((k) => k.parameterId === parameterId);
      }
    }
    return [];
  },

  clearPropertyKeyframes: (clipId, effectId, parameterId) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            return {
              ...clip,
              effects: clip.effects.map((e) =>
                e.id === effectId
                  ? { ...e, keyframes: e.keyframes.filter((k) => k.parameterId !== parameterId) }
                  : e
              ),
            };
          }),
        })),
        updatedAt: Date.now(),
      },
    }));
  },

  // ── Timeline Actions ──

  setTimelineZoom: (pixelsPerSecond) => {
    set((state) => ({
      timeline: {
        ...state.timeline,
        pixelsPerSecond: Math.max(10, Math.min(600, pixelsPerSecond)),
      },
    }));
  },

  setTimelinePanelHeight: (height) => {
    set((state) => ({
      timeline: {
        ...state.timeline,
        panelHeight: Math.max(
          state.timeline.panelMinHeight,
          Math.min(height, (typeof window !== 'undefined' ? window.innerHeight : 900) * state.timeline.panelMaxHeightRatio)
        ),
      },
    }));
  },

  setSnapEnabled: (enabled) => {
    set((state) => ({
      timeline: { ...state.timeline, snapEnabled: enabled },
    }));
  },

  setActiveTool: (tool) => {
    set((state) => ({
      timeline: { ...state.timeline, activeTool: tool },
    }));
  },

  // ── Clip Manipulation ──

  moveClip: (clipId, newTimelineStart, newTrackId) => {
    set((state) => {
      let primaryClip: Clip | null = null;
      let sourceTrackId: string | null = null;

      // Find the primary clip and its current track
      for (const track of state.project.tracks) {
        const found = track.clips.find((c) => c.id === clipId);
        if (found) {
          primaryClip = found;
          sourceTrackId = track.id;
          break;
        }
      }
      if (!primaryClip || !sourceTrackId) return state;

      const delta = newTimelineStart - primaryClip.timelineStart;
      const targetTrackId = newTrackId ?? sourceTrackId;

      // Collect linked clips that should move together
      const linkedIds = new Set<string>();
      if (primaryClip.linkId && state.ui.linkedSelectionEnabled) {
        for (const track of state.project.tracks) {
          for (const c of track.clips) {
            if (c.linkId === primaryClip.linkId) {
              linkedIds.add(c.id);
            }
          }
        }
      }
      linkedIds.add(clipId);

      const newTracks = state.project.tracks.map((track) => {
        if (sourceTrackId === targetTrackId || !newTrackId) {
          // Same track or no cross-track: apply delta to all linked clips
          return {
            ...track,
            clips: track.clips.map((c) => {
              if (linkedIds.has(c.id)) {
                return { ...c, timelineStart: Math.max(0, c.timelineStart + delta) };
              }
              return c;
            }),
          };
        }
        // Cross-track move only for the primary clip (linked clips stay on their tracks)
        if (track.id === sourceTrackId) {
          return { ...track, clips: track.clips.filter((c) => c.id !== clipId) };
        }
        if (track.id === targetTrackId) {
          const updatedClip = { ...primaryClip!, timelineStart: Math.max(0, newTimelineStart) };
          return { ...track, clips: [...track.clips, updatedClip] };
        }
        return track;
      });

      const duration = calculateDuration(newTracks);
      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, duration },
          updatedAt: Date.now(),
        },
      };
    });
  },

  moveSelectedClips: (deltaSeconds, basePositions) => {
    set((state) => {
      const selected = state.ui.selectedClipIds ?? [];
      if (selected.length === 0) return state;

      // Find anchor point
      let minStart = Infinity;
      const clips = new Map<string, Clip>();

      for (const track of state.project.tracks) {
        for (const clip of track.clips) {
          if (selected.includes(clip.id)) {
            clips.set(clip.id, clip);
            const origin = basePositions?.[clip.id] ?? clip.timelineStart;
            minStart = Math.min(minStart, origin);
          }
        }
      }

      if (minStart === Infinity) return state;

      // Calculate offsets from the minimum start
      const offsets = new Map<string, number>();
      for (const clipId of selected) {
        const clip = clips.get(clipId);
        if (clip) {
          const origin = basePositions?.[clipId] ?? clip.timelineStart;
          offsets.set(clipId, origin - minStart)
        }
      }

      // Reposition clips based on relative offsets
      const newMinStart = Math.max(0, minStart + deltaSeconds);
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (!selected.includes(clip.id)) return clip;
          const offset = offsets.get(clip.id) ?? 0;
          const newStart = newMinStart + offset;
          return {...clip, timelineStart: newStart};
        }),
      }));

      const duration = calculateDuration(newTracks);
      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, duration },
          updatedAt: Date.now(),
        },
      };
    });
  },

  trimClipStart: (clipId, newSourceStart, newTimelineStart) => {
    set((state) => {
      // Find the primary clip to get its linkId and compute delta
      let primaryClip: Clip | null = null;
      for (const track of state.project.tracks) {
        const found = track.clips.find((c) => c.id === clipId);
        if (found) { primaryClip = found; break; }
      }
      if (!primaryClip) return state;

      const sourceStartDelta = newSourceStart - primaryClip.sourceStart;
      const timelineStartDelta = newTimelineStart - primaryClip.timelineStart;

      // Collect linked clip IDs
      const linkedIds = new Set<string>([clipId]);
      if (primaryClip.linkId && state.ui.linkedSelectionEnabled) {
        for (const track of state.project.tracks) {
          for (const c of track.clips) {
            if (c.linkId === primaryClip.linkId) linkedIds.add(c.id);
          }
        }
      }

      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (!linkedIds.has(clip.id)) return clip;
          const clampedSourceStart = Math.max(0, Math.min(clip.sourceStart + sourceStartDelta, clip.sourceEnd - 0.05));
          return {
            ...clip,
            sourceStart: clampedSourceStart,
            timelineStart: Math.max(0, clip.timelineStart + timelineStartDelta),
          };
        }),
      }));
      const duration = calculateDuration(newTracks);
      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, duration },
          updatedAt: Date.now(),
        },
      };
    });
  },

  trimClipEnd: (clipId, newSourceEnd) => {
    set((state) => {
      const mediaFiles = state.mediaFiles;

      // Find the primary clip to get its linkId and compute delta
      let primaryClip: Clip | null = null;
      for (const track of state.project.tracks) {
        const found = track.clips.find((c) => c.id === clipId);
        if (found) { primaryClip = found; break; }
      }
      if (!primaryClip) return state;

      const sourceEndDelta = newSourceEnd - primaryClip.sourceEnd;

      // Collect linked clip IDs
      const linkedIds = new Set<string>([clipId]);
      if (primaryClip.linkId && state.ui.linkedSelectionEnabled) {
        for (const track of state.project.tracks) {
          for (const c of track.clips) {
            if (c.linkId === primaryClip.linkId) linkedIds.add(c.id);
          }
        }
      }

      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (!linkedIds.has(clip.id)) return clip;
          const mediaFile = mediaFiles.get(clip.sourceFileId);
          const maxEnd = mediaFile?.duration ?? clip.sourceEnd;
          const clampedSourceEnd = Math.min(maxEnd, Math.max(clip.sourceEnd + sourceEndDelta, clip.sourceStart + 0.05));
          return { ...clip, sourceEnd: clampedSourceEnd };
        }),
      }));
      const duration = calculateDuration(newTracks);
      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, duration },
          updatedAt: Date.now(),
        },
      };
    });
  },

  splitClip: (clipId, splitTimeSeconds) => {
    const state = get();
    let clip: Clip | null = null;
    let trackId: string | null = null;

    for (const track of state.project.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        clip = found;
        trackId = track.id;
        break;
      }
    }

    if (!clip || !trackId) return null;

    const clipDuration = clip.sourceEnd - clip.sourceStart;
    const clipEnd = clip.timelineStart + clipDuration;

    if (splitTimeSeconds <= clip.timelineStart + 0.01 || splitTimeSeconds >= clipEnd - 0.01) {
      return null;
    }

    // Collect all linked clips that should also be split
    const linkedClips: Array<{ clip: Clip; trackId: string }> = [];
    if (clip.linkId && state.ui.linkedSelectionEnabled) {
      for (const track of state.project.tracks) {
        for (const c of track.clips) {
          if (c.linkId === clip.linkId && c.id !== clipId) {
            // Only split if the split time falls within this clip's range
            const cEnd = c.timelineStart + (c.sourceEnd - c.sourceStart);
            if (splitTimeSeconds > c.timelineStart + 0.01 && splitTimeSeconds < cEnd - 0.01) {
              linkedClips.push({ clip: c, trackId: track.id });
            }
          }
        }
      }
    }

    // Generate new linkIds for the two halves (A and B)
    const hasLinkedClips = linkedClips.length > 0;
    const linkIdA = hasLinkedClips ? uuid() : clip.linkId;
    const linkIdB = hasLinkedClips ? uuid() : clip.linkId;

    const splitOffset = splitTimeSeconds - clip.timelineStart;
    const newSourceSplit = clip.sourceStart + splitOffset;

    const clipA: Clip = {
      ...clip,
      sourceEnd: newSourceSplit,
      linkId: linkIdA,
    };

    const clipB: Clip = {
      ...clip,
      id: uuid(),
      sourceStart: newSourceSplit,
      timelineStart: splitTimeSeconds,
      linkId: linkIdB,
      effects: clip.effects.map((e) => ({ ...e, parameters: { ...e.parameters }, keyframes: [...e.keyframes] })),
    };

    // Build split pairs for all linked clips
    const linkedSplits = new Map<string, { a: Clip; b: Clip; trackId: string }>();
    for (const { clip: lc, trackId: ltId } of linkedClips) {
      const lcSplitOffset = splitTimeSeconds - lc.timelineStart;
      const lcSourceSplit = lc.sourceStart + lcSplitOffset;
      linkedSplits.set(lc.id, {
        a: { ...lc, sourceEnd: lcSourceSplit, linkId: linkIdA },
        b: {
          ...lc,
          id: uuid(),
          sourceStart: lcSourceSplit,
          timelineStart: splitTimeSeconds,
          linkId: linkIdB,
          effects: lc.effects.map((e) => ({ ...e, parameters: { ...e.parameters }, keyframes: [...e.keyframes] })),
        },
        trackId: ltId,
      });
    }

    set((state) => {
      const newTracks = state.project.tracks.map((track) => {
        if (track.id === trackId) {
          const newClips = track.clips.map((c) => (c.id === clipId ? clipA : c));
          const idx = newClips.findIndex((c) => c.id === clipId);
          newClips.splice(idx + 1, 0, clipB);
          return { ...track, clips: newClips };
        }
        // Check if any linked clip on this track needs splitting
        let modified = false;
        let newClips = [...track.clips];
        for (const [lcId, split] of linkedSplits) {
          if (split.trackId === track.id) {
            newClips = newClips.map((c) => (c.id === lcId ? split.a : c));
            const idx = newClips.findIndex((c) => c.id === lcId);
            newClips.splice(idx + 1, 0, split.b);
            modified = true;
          }
        }
        return modified ? { ...track, clips: newClips } : track;
      });

      const duration = calculateDuration(newTracks);
      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, duration },
          updatedAt: Date.now(),
        },
      };
    });

    return [clipA, clipB];
  },

  freezeFrame: (clipId, atTime, duration = 2.0) => {
    const state = get();
    let clip: Clip | null = null;
    let trackId: string | null = null;

    for (const track of state.project.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) { clip = found; trackId = track.id; break; }
    }
    if (!clip || !trackId) return null;

    const clipEnd = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
    if (atTime <= clip.timelineStart + 0.01 || atTime >= clipEnd - 0.01) return null;

    const splitOffset = atTime - clip.timelineStart;
    const freezeSourceTime = clip.sourceStart + splitOffset;

    const freezeClip: Clip = {
      id: uuid(),
      type: clip.type,
      sourceFileId: clip.sourceFileId,
      sourceStart: freezeSourceTime,
      sourceEnd: freezeSourceTime + 0.001,
      timelineStart: atTime,
      linkId: clip.linkId,
      transform: { ...clip.transform, filters: { ...clip.transform.filters } },
      effects: clip.effects.map((e) => ({ ...e, parameters: { ...e.parameters }, keyframes: [...e.keyframes] })),
      provenance: {},
      transitions: [],
    };

    const tailClip: Clip = {
      ...clip,
      id: uuid(),
      sourceStart: freezeSourceTime,
      timelineStart: atTime + duration,
      linkId: clip.linkId,
      effects: clip.effects.map((e) => ({ ...e, parameters: { ...e.parameters }, keyframes: [...e.keyframes] })),
      provenance: {},
    };

    const headClip: Clip = {
      ...clip,
      sourceEnd: freezeSourceTime,
    };

    set((state) => {
      const newTracks = state.project.tracks.map((track) => {
        if (track.id !== trackId) return track;
        const newClips: Clip[] = [];
        for (const c of track.clips) {
          if (c.id === clipId) {
            newClips.push(headClip, freezeClip, tailClip);
          } else if (c.timelineStart >= atTime && c.id !== clipId) {
            newClips.push({ ...c, timelineStart: c.timelineStart + duration });
          } else {
            newClips.push(c);
          }
        }
        return { ...track, clips: newClips };
      });
      const dur = calculateDuration(newTracks);
      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, duration: dur },
          updatedAt: Date.now(),
        },
      };
    });

    return freezeClip;
  },

  addTrack: (type, label) => {
    // capture previous snapshot for undo
    const prevTracks = structuredClone(get().project.tracks);
    const prevPlayback = structuredClone(get().playback);

    const state = get();
    const count = state.project.tracks.filter((t) => t.type === type).length;
    const defaultLabel = type === 'video'
      ? `V${count + 1}`
      : type === 'audio'
        ? `A${count + 1}`
        : `${type.charAt(0).toUpperCase() + type.slice(1)} ${count + 1}`;
    const track: Track = {
      id: uuid(),
      type,
      label: label ?? defaultLabel,
      ...defaultTrackProps,
    };

    set((state) => {
      const newTracks = [...state.project.tracks];
      if (type === 'video') {
        // Insert at position 0 (topmost video track = highest compositing priority)
        newTracks.splice(0, 0, track);
      } else if (type === 'audio') {
        // Append after all existing tracks
        newTracks.push(track);
      } else {
        newTracks.push(track);
      }
      return {
        project: {
          ...state.project,
          tracks: newTracks,
          updatedAt: Date.now(),
        },
      };
    });

    // push undo entry
    const afterTracks = structuredClone(get().project.tracks);
    const afterPlayback = structuredClone(get().playback);
    get().pushUndo({
      description: 'Add track',
      previousState: { tracks: prevTracks, playback: prevPlayback },
      nextState: { tracks: afterTracks, playback: afterPlayback },
    });

    return track;
  },

  // ── Linked Clip Actions ──

  getLinkedClips: (clipId) => {
    const state = get();
    let primaryClip: Clip | null = null;
    for (const track of state.project.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) { primaryClip = found; break; }
    }
    if (!primaryClip?.linkId) return [];

    const linked: Clip[] = [];
    for (const track of state.project.tracks) {
      for (const c of track.clips) {
        if (c.linkId === primaryClip.linkId && c.id !== clipId) {
          linked.push(c);
        }
      }
    }
    return linked;
  },

  unlinkClip: (clipId) => {
    set((state) => {
      let targetLinkId: string | null = null;
      for (const track of state.project.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) { targetLinkId = clip.linkId; break; }
      }
      if (!targetLinkId) return state;

      // Remove linkId from all clips in this link group
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.linkId === targetLinkId ? { ...clip, linkId: null } : clip
        ),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  linkClips: (clipIds) => {
    if (clipIds.length < 2) return;
    const newLinkId = uuid();
    set((state) => {
      const idSet = new Set(clipIds);
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          idSet.has(clip.id) ? { ...clip, linkId: newLinkId } : clip
        ),
      }));
      return {
        project: { ...state.project, tracks: newTracks, updatedAt: Date.now() },
      };
    });
  },

  toggleLinkForSelection: () => {
    const state = get();
    const selectedIds = state.ui.selectedClipIds;
    if (selectedIds.length === 0) return;

    const selectedClips: Clip[] = [];
    for (const track of state.project.tracks) {
      for (const c of track.clips) {
        if (selectedIds.includes(c.id)) selectedClips.push(c);
      }
    }
    if (selectedClips.length === 0) return;

    const firstLinkId = selectedClips[0].linkId;
    const allSameLinkId = firstLinkId !== null &&
      selectedClips.every((c) => c.linkId === firstLinkId);

    if (allSameLinkId) {
      get().unlinkClip(selectedClips[0].id);
    } else if (selectedClips.length >= 2) {
      get().linkClips(selectedIds);
    } else if (selectedClips.length === 1 && selectedClips[0].linkId) {
      get().unlinkClip(selectedClips[0].id);
    }
  },

  setLinkedSelectionEnabled: (enabled) => {
    set((state) => ({
      ui: { ...state.ui, linkedSelectionEnabled: enabled },
    }));
  },

  // ── Playback Actions ──

  setPlaying: (playing) => {
    set((state) => ({
      playback: { ...state.playback, isPlaying: playing },
    }));
  },

  setCurrentTime: (time) => {
    set((state) => ({
      playback: { ...state.playback, currentTime: time },
    }));
  },

  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    set((state) => ({
      playback: { ...state.playback, volume: clamped },
    }));
    // sync with video engine
    const engine = getVideoEngine();
    engine.setVolume(clamped);
    // if the user increases volume while muted, unmute
    const isMuted = get().playback.isMuted;
    if (clamped > 0 && isMuted) {
      get().toggleMute();
    }
  },

  toggleMute: () => {
    set((state) => {
      const newMuted = !state.playback.isMuted;
      // also update engine
      const engine = getVideoEngine();
      engine.setMuted(newMuted);
      return { playback: { ...state.playback, isMuted: newMuted } };
    });
  },

  setPlaybackRate: (rate) => {
    set((state) => ({
      playback: { ...state.playback, playbackRate: rate },
    }));
  },

  // ── Chat Actions ──

  addChatMessage: (message) => {
    const id = uuid();
    set((state) => ({
      chatMessages: [
        ...state.chatMessages,
        { ...message, id, timestamp: Date.now() },
      ],
    }));
    return id;
  },

  updateChatMessage: (id, updates) => {
    set((state) => ({
      chatMessages: state.chatMessages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    }));
  },

  setChatLoading: (loading) => {
    set({ isChatLoading: loading });
  },

  clearChat: () => {
    set({ chatMessages: [] });
  },

  // ── UI Actions ──

  setActivePanel: (panel) => {
    set((state) => ({ ui: { ...state.ui, activePanel: panel } }));
  },

  togglePanel: (panel: EditorPanel) => {
    set((state) => ({
      ui: {
        ...state.ui,
        activePanel: state.ui.activePanel === panel ? null : panel,
      },
    }));
  },

  setSelectedClip: (clipId) => {
    set((state) => {
      const newUi = { ...state.ui, selectedClipIds: clipId ? [clipId] : [] };
      if (clipId && state.ui.activePanel !== 'effects') {
        newUi.activePanel = 'effects';
      }
      return { ui: newUi };
    });
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

  // ── Provenance Actions ──

  setProvenance: (clipId, path, entry) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === clipId
              ? { ...clip, provenance: { ...clip.provenance, [path]: entry } }
              : clip
          ),
        })),
      },
    }));
  },

  clearPropertyProvenance: (clipId, path) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            const { [path]: _, ...rest } = clip.provenance;
            return { ...clip, provenance: rest };
          }),
        })),
      },
    }));
  },

  acceptAIChange: (clipId, path) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId || !clip.provenance[path]) return clip;
            return {
              ...clip,
              provenance: {
                ...clip.provenance,
                [path]: { ...clip.provenance[path], accepted: true },
              },
            };
          }),
        })),
      },
    }));
  },

  revertAIChange: (clipId, path) => {
    const state = get();
    let targetClip: Clip | undefined;
    for (const track of state.project.tracks) {
      targetClip = track.clips.find((c) => c.id === clipId);
      if (targetClip) break;
    }
    if (!targetClip) return;

    const entry = targetClip.provenance[path];
    if (!entry || entry.source === 'user') return;

    const prevVal = entry.previousValue;

    set((s) => ({
      project: {
        ...s.project,
        tracks: s.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            const { [path]: _, ...restProv } = clip.provenance;
            const updated = { ...clip, provenance: restProv };

            if (path.startsWith('effect:')) {
              // Effect paths: "effect:<appliedId>" (new effect) or "effect:<appliedId>.<paramId>" (param change)
              const rest = path.slice(7); // strip "effect:"
              const dotIdx = rest.indexOf('.');
              if (dotIdx >= 0) {
                // Parameter change — revert the parameter value
                const appliedEffectId = rest.slice(0, dotIdx);
                const paramId = rest.slice(dotIdx + 1);
                updated.effects = clip.effects.map((e) =>
                  e.id === appliedEffectId
                    ? { ...e, parameters: { ...e.parameters, [paramId]: prevVal as number } }
                    : e
                );
              } else {
                // New effect was added by AI — remove it entirely
                const appliedEffectId = rest;
                updated.effects = clip.effects.filter((e) => e.id !== appliedEffectId);
              }
              updated.transform = effectsToTransform(updated.effects);
            } else {
              const parts = path.split('.');
              if (parts[0] === 'transform' && parts.length === 2) {
                const key = parts[1] as keyof Transform;
                updated.transform = { ...clip.transform, [key]: prevVal };
                updated.effects = syncEffectsFromTransform(clip.effects, updated.transform);
              } else if (parts[0] === 'transform' && parts[1] === 'filters' && parts.length === 3) {
                const filterKey = parts[2] as keyof FilterState;
                updated.transform = {
                  ...clip.transform,
                  filters: { ...clip.transform.filters, [filterKey]: prevVal },
                };
                updated.effects = syncEffectsFromTransform(clip.effects, updated.transform);
              }
            }

            return updated;
          }),
        })),
        updatedAt: Date.now(),
      },
    }));
  },

  acceptAllAIChanges: (clipId) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            const newProv = { ...clip.provenance };
            for (const key of Object.keys(newProv)) {
              if (newProv[key].source === 'ai' || newProv[key].source === 'ai-suggested') {
                newProv[key] = { ...newProv[key], accepted: true };
              }
            }
            return { ...clip, provenance: newProv };
          }),
        })),
      },
    }));
  },

  revertAllAIChanges: (clipId) => {
    const state = get();
    let targetClip: Clip | undefined;
    for (const track of state.project.tracks) {
      targetClip = track.clips.find((c) => c.id === clipId);
      if (targetClip) break;
    }
    if (!targetClip) return;

    const aiPaths = Object.entries(targetClip.provenance)
      .filter(([, e]) => e.source === 'ai' || e.source === 'ai-suggested')
      .map(([p]) => p);

    for (const p of aiPaths) {
      get().revertAIChange(clipId, p);
    }
  },

  // ── Undo/Redo ──

  pushUndo: (command) => {
    const MAX_UNDO = 50;
    const fullCommand: Command = {
      ...command,
      id: uuid(),
      timestamp: Date.now(),
    };
    set((state) => {
      const stack = [...state.undoStack, fullCommand];
      if (stack.length > MAX_UNDO) stack.splice(0, stack.length - MAX_UNDO);
      return {
        undoStack: stack,
        redoStack: [],
      };
    });
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;

    const command = state.undoStack[state.undoStack.length - 1];
    const newUndoStack = state.undoStack.slice(0, -1);

    // Apply the previous state
    const updates: Partial<EditorStore> = {};
    if (command.previousState.tracks) {
      updates.project = {
        ...state.project,
        tracks: command.previousState.tracks,
        composition: {
          ...state.project.composition,
          duration: calculateDuration(command.previousState.tracks),
        },
      };
    }
    if (command.previousState.playback) {
      updates.playback = command.previousState.playback;
    }

    set({
      ...updates,
      undoStack: newUndoStack,
      redoStack: [...state.redoStack, command],
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;

    const command = state.redoStack[state.redoStack.length - 1];
    const newRedoStack = state.redoStack.slice(0, -1);

    const updates: Partial<EditorStore> = {};
    if (command.nextState.tracks) {
      updates.project = {
        ...state.project,
        tracks: command.nextState.tracks,
        composition: {
          ...state.project.composition,
          duration: calculateDuration(command.nextState.tracks),
        },
      };
    }
    if (command.nextState.playback) {
      updates.playback = command.nextState.playback;
    }

    set({
      ...updates,
      undoStack: [...state.undoStack, command],
      redoStack: newRedoStack,
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  beginUndoBatch: (description) => {
    const state = get();
    if (state._undoBatch) {
      console.warn('[EditorStore] beginUndoBatch called while batch already active — committing previous batch');
      state.commitUndoBatch();
    }
    set({
      _undoBatch: {
        description,
        snapshotTracks: structuredClone(state.project.tracks),
        snapshotPlayback: structuredClone(state.playback),
      },
    });
  },

  commitUndoBatch: () => {
    const state = get();
    const batch = state._undoBatch;
    if (!batch) return;

    const afterTracks = state.project.tracks;
    const afterPlayback = state.playback;

    const tracksChanged = JSON.stringify(batch.snapshotTracks) !== JSON.stringify(afterTracks);
    const playbackChanged = JSON.stringify(batch.snapshotPlayback) !== JSON.stringify(afterPlayback);

    if (tracksChanged || playbackChanged) {
      state.pushUndo({
        description: batch.description,
        previousState: {
          tracks: batch.snapshotTracks,
          ...(playbackChanged ? { playback: batch.snapshotPlayback } : {}),
        },
        nextState: {
          tracks: structuredClone(afterTracks),
          ...(playbackChanged ? { playback: structuredClone(afterPlayback) } : {}),
        },
      });
    }

    set({ _undoBatch: null });
  },

  cancelUndoBatch: () => {
    set({ _undoBatch: null });
  },

  // ── Helpers ──

  getActiveClip: () => {
    const state = get();
    const clipId = state.ui.selectedClipIds[0] ?? null;
    if (!clipId) {
      // If no clip is selected, return the first video clip
      for (const track of state.project.tracks) {
        if (track.type === 'video' && track.clips.length > 0) {
          return track.clips[0];
        }
      }
      return null;
    }
    return get().getClipById(clipId);
  },

  getClipById: (clipId) => {
    const state = get();
    for (const track of state.project.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  },

  getClipAtTime: (time) => {
    const state = get();
    for (const track of state.project.tracks) {
      if (track.type !== 'video') continue;
      for (const clip of track.clips) {
        const clipEnd = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
        if (time >= clip.timelineStart && time < clipEnd) {
          return clip;
        }
      }
    }
    return null;
  },

  getDuration: () => {
    return get().project.composition.duration;
  },
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
      typeof s.toggleClipSelection === 'function'
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

// ─── Utility Functions ──────────────────────────────────────────────────────

function calculateDuration(tracks: Track[]): number {
  let maxEnd = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
      maxEnd = Math.max(maxEnd, clipEnd);
    }
  }
  return maxEnd;
}

/**
 * Sync built-in effects from a Transform value.
 * Updates existing built-in effects or creates them if missing.
 * Non-built-in (user-applied) effects are preserved as-is.
 */
function syncEffectsFromTransform(effects: AppliedEffect[], transform: Transform): AppliedEffect[] {
  const result = [...effects];

  // Map of built-in effect IDs to their new parameter values
  const builtinUpdates: Record<string, Record<string, number>> = {
    scale: { scale: transform.scale },
    position: { positionX: transform.positionX, positionY: transform.positionY },
    rotation: { degrees: transform.rotation },
    opacity: { opacity: transform.opacity },
  };

  // Update existing built-in effects
  for (let i = 0; i < result.length; i++) {
    const effect = result[i];
    if (effect.id.startsWith('builtin-') && builtinUpdates[effect.effectId]) {
      result[i] = {
        ...effect,
        parameters: { ...effect.parameters, ...builtinUpdates[effect.effectId] },
      };
      delete builtinUpdates[effect.effectId];
    }
  }

  // Create missing built-in effects
  for (const [effectId, params] of Object.entries(builtinUpdates)) {
    result.unshift({
      id: `builtin-${effectId}`,
      effectId,
      parameters: params,
      keyframes: [],
      enabled: true,
    });
  }

  // Sync filter-based effects
  const filterMap: Record<string, { effectId: string; paramName: string; value: number; defaultVal: number }> = {
    blur: { effectId: 'gaussian_blur', paramName: 'sigma', value: transform.filters.blur, defaultVal: 0 },
    brightness: { effectId: 'brightness', paramName: 'brightness', value: transform.filters.brightness - 1.0, defaultVal: 0 },
    contrast: { effectId: 'contrast', paramName: 'contrast', value: transform.filters.contrast, defaultVal: 1.0 },
    saturate: { effectId: 'saturation', paramName: 'saturation', value: transform.filters.saturate, defaultVal: 1.0 },
    grayscale: { effectId: 'grayscale', paramName: 'amount', value: transform.filters.grayscale, defaultVal: 0 },
    sepia: { effectId: 'sepia', paramName: 'amount', value: transform.filters.sepia, defaultVal: 0 },
    hueRotate: { effectId: 'hue_rotate', paramName: 'degrees', value: transform.filters.hueRotate, defaultVal: 0 },
  };

  for (const [filterKey, mapping] of Object.entries(filterMap)) {
    const idx = result.findIndex((e) => e.id === `builtin-${filterKey}` || (e.id.startsWith('builtin-') && e.effectId === mapping.effectId));
    if (mapping.value !== mapping.defaultVal) {
      if (idx >= 0) {
        result[idx] = { ...result[idx], parameters: { [mapping.paramName]: mapping.value } };
      } else {
        result.push({
          id: `builtin-${filterKey}`,
          effectId: mapping.effectId,
          parameters: { [mapping.paramName]: mapping.value },
          keyframes: [],
          enabled: true,
        });
      }
    } else if (idx >= 0) {
      // Remove the effect if it's back to default
      result.splice(idx, 1);
    }
  }

  return result;
}

/**
 * Probe a media file for duration/dimensions using a temporary HTML element.
 * Includes a timeout so the promise never hangs indefinitely.
 * If the browser probe fails in Tauri mode, falls back to FFprobe via the Rust backend.
 */
async function probeMediaDuration(
  url: string,
  type: 'video' | 'audio',
  nativePath?: string | null,
): Promise<{ duration: number; width?: number; height?: number }> {
  const TIMEOUT_MS = 8000;

  try {
    const raw = await new Promise<{ duration: number; width?: number; height?: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Media metadata probe timed out'));
      }, TIMEOUT_MS);

      if (type === 'video') {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve({
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
          });
          video.src = '';
        };
        video.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Failed to load video metadata via browser'));
        };
        video.src = url;
      } else {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve({ duration: audio.duration });
        };
        audio.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Failed to load audio metadata via browser'));
        };
        audio.src = url;
      }
    });

    if (!Number.isFinite(raw.duration) || raw.duration <= 0) {
      console.warn('[probeMediaDuration] Invalid duration from browser:', raw.duration);
      throw new Error(`Invalid media duration: ${raw.duration}`);
    }
    return raw;
  } catch (browserError) {
    if (nativePath) {
      try {
        const { probeMedia } = await import('@/lib/tauri/bridge');
        const result = await probeMedia(nativePath);
        if (Number.isFinite(result.duration) && result.duration > 0) {
          return {
            duration: result.duration,
            width: result.width ?? undefined,
            height: result.height ?? undefined,
          };
        }
        console.warn('[probeMediaDuration] FFprobe returned invalid duration:', result.duration);
      } catch (ffprobeError) {
        console.warn('[probeMediaDuration] FFprobe fallback also failed:', ffprobeError);
      }
    }
    throw browserError;
  }
}

// ─── Media Type Detection ────────────────────────────────────────────────────
// Some platforms (e.g. macOS WKWebView / Tauri) don't always set `file.type`
// correctly, so we fall back to extension checks.

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogv', 'ogg', 'ts', 'mts']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma']);

function fileExtension(name: string): string {
  return (name.split('.').pop() || '').toLowerCase();
}

/** Detect whether a File is video, audio, or image. */
function detectMediaType(file: File): 'video' | 'audio' | 'image' {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  // MIME type missing — fall back to extension
  const ext = fileExtension(file.name);
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'image';
}

/** Check if a File looks like a supported video (MIME or extension). */
export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return VIDEO_EXTENSIONS.has(fileExtension(file.name));
}
