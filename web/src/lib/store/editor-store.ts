/**
 * ChatCut Editor — Central State Store
 *
 * Uses Zustand with slices for organization.
 * The store is the single source of truth for the entire editor.
 *
 * IMPORTANT: The VideoEngine reads from this store DIRECTLY (not through React)
 * via `useEditorStore.getState()` to avoid rendering-induced frame drops.
 */

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import {
  type Project,
  type Track,
  type Clip,
  type MediaFile,
  type PlaybackState,
  type ChatMessage,
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

  // ── Effect Actions ──
  addEffect: (clipId: string, effectId: string, parameters?: Record<string, number>) => AppliedEffect | null;
  removeEffect: (clipId: string, appliedEffectId: string) => void;
  updateEffect: (clipId: string, appliedEffectId: string, parameters: Record<string, number>) => void;
  toggleEffect: (clipId: string, appliedEffectId: string, enabled: boolean) => void;
  getClipEffects: (clipId: string) => AppliedEffect[];

  // ── Timeline Actions ──
  setTimelineZoom: (pixelsPerSecond: number) => void;
  setTimelinePanelHeight: (height: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setActiveTool: (tool: TimelineTool) => void;

  // ── Clip Manipulation (Timeline) ──
  moveClip: (clipId: string, newTimelineStart: number, newTrackId?: string) => void;
  trimClipStart: (clipId: string, newSourceStart: number, newTimelineStart: number) => void;
  trimClipEnd: (clipId: string, newSourceEnd: number) => void;
  splitClip: (clipId: string, splitTimeSeconds: number) => [Clip, Clip] | null;
  addTrack: (type: TrackType, label?: string) => Track;

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
  setSelectedClip: (clipId: string | null) => void;
  toggleChat: () => void;

  // ── Undo/Redo ──
  pushUndo: (command: Omit<Command, 'id' | 'timestamp'>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // ── Helpers ──
  getActiveClip: () => Clip | null;
  getClipById: (clipId: string) => Clip | null;
  getClipAtTime: (time: number) => Clip | null;
  getDuration: () => number;
}

// ─── Default Project ────────────────────────────────────────────────────────

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
    {
      id: uuid(),
      type: 'video',
      label: 'Video 1',
      clips: [],
      muted: false,
      locked: false,
      visible: true,
    },
    {
      id: uuid(),
      type: 'audio',
      label: 'Audio 1',
      clips: [],
      muted: false,
      locked: false,
      visible: true,
    },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// ─── Store Implementation ───────────────────────────────────────────────────

export const useEditorStore = create<EditorStore>((set, get) => ({
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
    const state = get();
    // Find the target track (first video track by default)
    const targetTrack = trackId
      ? state.project.tracks.find((t) => t.id === trackId)
      : state.project.tracks.find((t) => t.type === 'video');

    if (!targetTrack) throw new Error('No suitable track found');

    // Place the clip at the specified position, or after existing clips
    const startPos = timelineStart ?? targetTrack.clips.reduce(
      (max, clip) => Math.max(max, clip.timelineStart + (clip.sourceEnd - clip.sourceStart)),
      0
    );

    const clip: Clip = {
      id: uuid(),
      type: mediaFile.type === 'video' ? 'video' : mediaFile.type === 'audio' ? 'audio' : 'image',
      sourceFileId: mediaFile.id,
      sourceStart: 0,
      sourceEnd: mediaFile.duration,
      timelineStart: startPos,
      transform: { ...DEFAULT_TRANSFORM, filters: { ...DEFAULT_TRANSFORM.filters } },
      effects: createDefaultEffects(),
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
          transform: { ...DEFAULT_TRANSFORM, filters: { ...DEFAULT_TRANSFORM.filters } },
          effects: createDefaultEffects(),
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
        ui: { ...state.ui, selectedClipId: clip.id },
      };
    });

    return clip;
  },

  removeClip: (clipId: string) => {
    const prevState = get();

    // Find the clip being removed so we can clean up its media file
    let removedClip: Clip | null = null;
    for (const track of prevState.project.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) { removedClip = found; break; }
    }

    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((c) => c.id !== clipId),
      }));
      const duration = calculateDuration(newTracks);
      const hasClipsLeft = newTracks.some((t) => t.clips.length > 0);

      // Build updated media files — revoke blob URL if no other clip
      // references this media file.
      let newMediaFiles = state.mediaFiles;
      if (removedClip) {
        const sourceId = removedClip.sourceFileId;
        const stillReferenced = newTracks.some((t) =>
          t.clips.some((c) => c.sourceFileId === sourceId)
        );
        if (!stillReferenced) {
          newMediaFiles = new Map(state.mediaFiles);
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
          selectedClipId:
            state.ui.selectedClipId === clipId ? null : state.ui.selectedClipId,
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

  getClipEffects: (clipId) => {
    const state = get();
    for (const track of state.project.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip.effects;
    }
    return [];
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
      let sourceTrackId: string | null = null;
      let clip: Clip | null = null;

      // Find the clip and its current track
      for (const track of state.project.tracks) {
        const found = track.clips.find((c) => c.id === clipId);
        if (found) {
          clip = found;
          sourceTrackId = track.id;
          break;
        }
      }
      if (!clip || !sourceTrackId) return state;

      const targetTrackId = newTrackId ?? sourceTrackId;
      const updatedClip = { ...clip, timelineStart: Math.max(0, newTimelineStart) };

      const newTracks = state.project.tracks.map((track) => {
        if (sourceTrackId === targetTrackId) {
          // Same track — just update the clip
          if (track.id === sourceTrackId) {
            return {
              ...track,
              clips: track.clips.map((c) => (c.id === clipId ? updatedClip : c)),
            };
          }
          return track;
        }
        // Cross-track move
        if (track.id === sourceTrackId) {
          return { ...track, clips: track.clips.filter((c) => c.id !== clipId) };
        }
        if (track.id === targetTrackId) {
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

  trimClipStart: (clipId, newSourceStart, newTimelineStart) => {
    set((state) => {
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== clipId) return clip;
          // Clamp: can't trim past sourceEnd, can't go below 0
          const clampedSourceStart = Math.max(0, Math.min(newSourceStart, clip.sourceEnd - 0.05));
          return {
            ...clip,
            sourceStart: clampedSourceStart,
            timelineStart: Math.max(0, newTimelineStart),
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
      const newTracks = state.project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          if (clip.id !== clipId) return clip;
          const mediaFile = mediaFiles.get(clip.sourceFileId);
          const maxEnd = mediaFile?.duration ?? clip.sourceEnd;
          // Clamp: can't trim past media duration, can't go below sourceStart
          const clampedSourceEnd = Math.min(maxEnd, Math.max(newSourceEnd, clip.sourceStart + 0.05));
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

    // Split time must be within the clip (not at the very edges)
    if (splitTimeSeconds <= clip.timelineStart + 0.01 || splitTimeSeconds >= clipEnd - 0.01) {
      return null;
    }

    const splitOffset = splitTimeSeconds - clip.timelineStart;
    const newSourceSplit = clip.sourceStart + splitOffset;

    // First half: original clip truncated
    const clipA: Clip = {
      ...clip,
      sourceEnd: newSourceSplit,
    };

    // Second half: new clip (deep copy effects)
    const clipB: Clip = {
      ...clip,
      id: uuid(),
      sourceStart: newSourceSplit,
      timelineStart: splitTimeSeconds,
      effects: clip.effects.map((e) => ({ ...e, parameters: { ...e.parameters }, keyframes: [...e.keyframes] })),
    };

    set((state) => {
      const newTracks = state.project.tracks.map((track) => {
        if (track.id !== trackId) return track;
        const newClips = track.clips.map((c) => (c.id === clipId ? clipA : c));
        // Insert clipB right after clipA
        const idx = newClips.findIndex((c) => c.id === clipId);
        newClips.splice(idx + 1, 0, clipB);
        return { ...track, clips: newClips };
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

  addTrack: (type, label) => {
    const state = get();
    const count = state.project.tracks.filter((t) => t.type === type).length;
    const track: Track = {
      id: uuid(),
      type,
      label: label ?? `${type.charAt(0).toUpperCase() + type.slice(1)} ${count + 1}`,
      clips: [],
      muted: false,
      locked: false,
      visible: true,
    };

    set((state) => ({
      project: {
        ...state.project,
        tracks: [...state.project.tracks, track],
        updatedAt: Date.now(),
      },
    }));

    return track;
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
    set((state) => ({
      playback: { ...state.playback, volume: Math.max(0, Math.min(1, volume)) },
    }));
  },

  toggleMute: () => {
    set((state) => ({
      playback: { ...state.playback, isMuted: !state.playback.isMuted },
    }));
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

  setSelectedClip: (clipId) => {
    set((state) => ({ ui: { ...state.ui, selectedClipId: clipId } }));
  },

  toggleChat: () => {
    set((state) => ({
      ui: { ...state.ui, isChatOpen: !state.ui.isChatOpen },
    }));
  },

  // ── Undo/Redo ──

  pushUndo: (command) => {
    const fullCommand: Command = {
      ...command,
      id: uuid(),
      timestamp: Date.now(),
    };
    set((state) => ({
      undoStack: [...state.undoStack, fullCommand],
      redoStack: [], // clear redo stack on new action
    }));
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

  // ── Helpers ──

  getActiveClip: () => {
    const state = get();
    const clipId = state.ui.selectedClipId;
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
    return await new Promise<{ duration: number; width?: number; height?: number }>((resolve, reject) => {
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
  } catch (browserError) {
    // If browser probe failed and we have a native path, try FFprobe
    if (nativePath) {
      try {
        const { probeMedia } = await import('@/lib/tauri/bridge');
        const result = await probeMedia(nativePath);
        return {
          duration: result.duration,
          width: result.width ?? undefined,
          height: result.height ?? undefined,
        };
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
