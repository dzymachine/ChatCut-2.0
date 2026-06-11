/**
 * Project slice — tracks, clips, transforms, effects, recipes, linking.
 *
 * Owns: `project`
 * Actions: initProject, addClipFromMedia, removeClip, transform/filter/effect
 * actions, recipe/preview-proxy setters, clip manipulation (move/trim/split),
 * track add/update, linked-clip actions, and read helpers.
 *
 * CROSS-SLICE WRITES (intentional, documented):
 *   - initProject resets chatMessages, undoStack, redoStack, activeNodeId.
 *   - addClipFromMedia sets ui.selectedClipIds and pushes undo via
 *     the history slice's pushUndo. addTrack also pushes undo.
 *   - removeClip GCs unreferenced `assets`, prunes ui.selectedClipIds, and
 *     resets `playback` when the timeline becomes empty.
 *   - setLinkedSelectionEnabled writes ui.linkedSelectionEnabled.
 */

import type { StateCreator } from 'zustand';
import { v4 as uuid } from 'uuid';
import { getVideoEngine } from '@/lib/engine/video-engine';
import {
  type Project,
  type Track,
  type Clip,
  type MediaFile,
  type Transform,
  type AppliedEffect,
  DEFAULT_TRANSFORM,
} from '@/types/editor';
import { createDefaultEffects, effectsToTransform } from '@/lib/effects/transform-bridge';
import { getEffectDescriptor } from '@/lib/effects/registry';
import { findClipById } from '@/lib/timeline/find-clip';
import { calculateDuration, deriveSequencePatch } from '@/lib/project/sequence';
import type { EditorStore } from './types';

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
 * Track order in the array matches the visual layout (top-to-bottom):
 *   V1 (topmost video — highest compositing priority / foreground)
 *   V2
 *   V3 (bottommost video — lowest compositing priority / background)
 *   A1 (topmost audio — default audio track)
 *   A2
 *   A3 (bottommost audio)
 *
 * Clips default to V3 and A1 (the "main" tracks).
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
  // Minimal defaults: one video track and one audio track. Users add more
  // via the "+ Add track" button in the timeline header. Reduces clutter for
  // common single-clip workflows.
  tracks: [
    { id: uuid(), type: 'video', label: 'V1', ...defaultTrackProps },
    { id: uuid(), type: 'audio', label: 'A1', ...defaultTrackProps },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// ─── Slice ──────────────────────────────────────────────────────────────────

type ProjectSliceKeys =
  | 'project'
  | 'initProject'
  | 'addClipFromMedia'
  | 'removeClip'
  | 'updateTransform'
  | 'updateFilter'
  | 'resetTransform'
  | 'addEffect'
  | 'removeEffect'
  | 'updateEffect'
  | 'toggleEffect'
  | 'getClipEffects'
  | 'setClipRecipe'
  | 'setClipPreviewProxy'
  | 'moveClip'
  | 'trimOverlappingClips'
  | 'moveSelectedClips'
  | 'trimClipStart'
  | 'trimClipEnd'
  | 'splitClip'
  | 'addTrack'
  | 'updateTrack'
  | 'getLinkedClips'
  | 'unlinkClip'
  | 'linkClips'
  | 'toggleLinkForSelection'
  | 'setLinkedSelectionEnabled'
  | 'getActiveClip'
  | 'getClipById'
  | 'getClipAtTime'
  | 'getDuration';

type ProjectSlice = Pick<EditorStore, ProjectSliceKeys>;

export const createProjectSlice: StateCreator<EditorStore, [], [], ProjectSlice> = (set, get) => ({
  // ── Initial State ──
  project: createDefaultProject(),

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
      activeNodeId: null,
    });
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
    const sharedLinkId = mediaFile.kind === 'video' ? uuid() : null;
    const clipDuration = mediaFile.duration;

    const clip: Clip = {
      id: uuid(),
      assetId: mediaFile.id,
      sourceStart: 0,
      sourceEnd: clipDuration,
      timelineStart: startPos,
      linkId: sharedLinkId,
      transform: { ...DEFAULT_TRANSFORM, filters: { ...DEFAULT_TRANSFORM.filters } },
      effects: createDefaultEffects(),
      transitions: [],
    };

    // For video files, also create a linked audio clip. Target the first
    // audio track with free space over the clip's span; if none exists (or
    // all are occupied), append a new audio track. This replaces the old
    // index-based V1→A1 pairing, which broke for video-only track layouts.
    let audioClip: Clip | null = null;
    let audioTrackId: string | null = null;
    let newAudioTrack: Track | null = null;
    if (mediaFile.kind === 'video') {
      const audioTracks = state.project.tracks.filter((t) => t.type === 'audio');
      const clipEnd = startPos + clipDuration;
      const freeTrack = audioTracks.find((t) =>
        !t.locked &&
        t.clips.every((c) => {
          const cEnd = c.timelineStart + (c.sourceEnd - c.sourceStart);
          return cEnd <= startPos || c.timelineStart >= clipEnd;
        })
      );

      if (freeTrack) {
        audioTrackId = freeTrack.id;
      } else {
        newAudioTrack = {
          id: uuid(),
          type: 'audio',
          label: `A${audioTracks.length + 1}`,
          ...defaultTrackProps,
          clips: [],
        };
        audioTrackId = newAudioTrack.id;
      }

      audioClip = {
        id: uuid(),
        assetId: mediaFile.id,
        sourceStart: 0,
        sourceEnd: clipDuration,
        timelineStart: startPos,
        linkId: sharedLinkId,
        transform: { ...DEFAULT_TRANSFORM, filters: { ...DEFAULT_TRANSFORM.filters } },
        effects: createDefaultEffects(),
        transitions: [],
      };
    }

    set((state) => {
      // First real clip in the project? (Checked against pre-update tracks.)
      const isFirstClip = state.project.tracks.every((t) => t.clips.length === 0);

      let newTracks = state.project.tracks.map((track) => {
        if (track.id === targetTrack.id) {
          return { ...track, clips: [...track.clips, clip] };
        }
        if (audioClip && audioTrackId && track.id === audioTrackId) {
          return { ...track, clips: [...track.clips, audioClip] };
        }
        return track;
      });

      // A brand-new audio track is appended at the end (below existing audio).
      if (audioClip && newAudioTrack) {
        newTracks = [...newTracks, { ...newAudioTrack, clips: [audioClip] }];
      }

      // Sequence derivation: duration always; on the FIRST clip also adopt the
      // source's dims + fps so every add path (drop, chat, AI) matches the
      // media instead of the project default.
      const sequencePatch = deriveSequencePatch(newTracks, isFirstClip ? mediaFile : null);

      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, ...sequencePatch },
          updatedAt: Date.now(),
        },
        ui: { ...state.ui, selectedClipIds: [clip.id] },
      };
    });

    get().pushUndo({
      description: 'Add clip',
      previousState: { tracks: prevTracks, playback: prevPlayback },
      nextState: { tracks: get().project.tracks, playback: get().playback },
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

    // Collect all asset IDs referenced by removed clips
    const removedAssetIds = new Set<string>();
    for (const track of prevState.project.tracks) {
      for (const c of track.clips) {
        if (idsToRemove.has(c.id)) {
          removedAssetIds.add(c.assetId);
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

      // GC assets no longer referenced by any clip. Blob preview URLs hold
      // the whole file in memory, so we revoke + drop rather than keeping
      // unreferenced assets in the library. (A persistent library needs lazy
      // URL re-resolution — future work, noted in the W2 plan.)
      let newAssets = state.assets;
      for (const assetId of removedAssetIds) {
        const stillReferenced = newTracks.some((t) =>
          t.clips.some((c) => c.assetId === assetId)
        );
        if (!stillReferenced) {
          if (newAssets === state.assets) {
            newAssets = new Map(state.assets);
          }
          const asset = newAssets.get(assetId);
          if (asset?.previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(asset.previewUrl);
          }
          newAssets.delete(assetId);
          try { getVideoEngine().releasePoolSource(assetId); } catch {}
        }
      }

      return {
        project: {
          ...state.project,
          tracks: newTracks,
          composition: { ...state.project.composition, duration },
          updatedAt: Date.now(),
        },
        assets: newAssets,
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

  // ── Effect Actions ──

  addEffect: (clipId, effectId, parameters) => {
    // Fill in any unspecified parameters from the effect's descriptor defaults.
    // Without this, calling apply_effect("sepia") with no args lands with
    // parameters: {}, which downstream consumers read as amount=0 (no visible
    // effect). Single-parameter effects in particular are unusable otherwise.
    const descriptor = getEffectDescriptor(effectId);
    const userProvided = parameters ?? {};
    const resolvedParameters: Record<string, number> = { ...userProvided };
    if (descriptor) {
      for (const paramDef of descriptor.parameters) {
        if (resolvedParameters[paramDef.id] === undefined && paramDef.default !== undefined) {
          resolvedParameters[paramDef.id] = paramDef.default as number;
        }
      }
    }

    // fade_out smart default: when the caller didn't specify `start`, place
    // the fade at the END of the clip so a request for "fade out the last 1s"
    // produces start = clipDuration - duration, not start = 0. Applies to
    // both the LLM agent path (tool-registry) and the action-mapper path.
    if (effectId === 'fade_out' && userProvided.start === undefined) {
      const state = get();
      let targetClip: Clip | undefined;
      for (const track of state.project.tracks) {
        targetClip = track.clips.find((c) => c.id === clipId);
        if (targetClip) break;
      }
      if (targetClip) {
        const clipDuration = targetClip.sourceEnd - targetClip.sourceStart;
        const fadeDuration = resolvedParameters.duration ?? 1.0;
        resolvedParameters.start = Math.max(0, clipDuration - fadeDuration);
      }
    }

    const newEffect: AppliedEffect = {
      id: uuid(),
      effectId,
      parameters: resolvedParameters,
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
    return findClipById(get().project.tracks, clipId)?.clip.effects ?? [];
  },

  setClipRecipe: (clipId, recipe) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            // Changing the recipe invalidates any existing preview proxy.
            clip.id === clipId ? { ...clip, recipe, previewProxyUrl: undefined } : clip
          ),
        })),
        updatedAt: Date.now(),
      },
    }));
  },

  /**
   * Ephemeral preview-proxy URL setter. Updates only the clip's `previewProxyUrl`
   * — does NOT bump `updatedAt` (avoids spurious autosave) and is NOT wrapped in
   * undo (the proxy is transient view state, not project content). Pass `null`
   * to clear.
   */
  setClipPreviewProxy: (clipId, url) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === clipId ? { ...clip, previewProxyUrl: url ?? undefined } : clip
          ),
        })),
      },
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
      // Const alias so closures below keep the non-null narrowing
      // (`primaryClip` is a `let`, which TS widens inside callbacks).
      const movedClip: Clip = primaryClip;

      const delta = newTimelineStart - movedClip.timelineStart;
      const targetTrackId = newTrackId ?? sourceTrackId;

      // Collect linked clips that should move together
      const linkedIds = new Set<string>();
      if (movedClip.linkId && state.ui.linkedSelectionEnabled) {
        for (const track of state.project.tracks) {
          for (const c of track.clips) {
            if (c.linkId === movedClip.linkId) {
              linkedIds.add(c.id);
            }
          }
        }
      }
      linkedIds.add(clipId);

      const newTracks = state.project.tracks.map((track) => {
        if (sourceTrackId === targetTrackId || !newTrackId) {
          // Same track: apply delta to all linked clips
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

        // Cross-track move
        if (track.id === sourceTrackId) {
          return { ...track, clips: track.clips.filter((c) => c.id !== clipId) };
        }
        if (track.id === targetTrackId) {
          const updatedClip = { ...movedClip, timelineStart: Math.max(0, newTimelineStart) };
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

  // Trim overlapping clips when a clip is dropped
  trimOverlappingClips: (clipId: string) => {
    set((state) => {
      let movedClip: Clip | null = null;
      let trackId: string | null = null;

      // Find the moved clip and its track
      for (const track of state.project.tracks) {
        const found = track.clips.find((c) => c.id === clipId);
        if (found) {
          movedClip = found;
          trackId = track.id;
          break;
        }
      }
      if (!movedClip || !trackId) return state;

      const movedStart = movedClip.timelineStart;
      const movedDuration = movedClip.sourceEnd - movedClip.sourceStart;
      const movedEnd = movedStart + movedDuration;

      const newTracks = state.project.tracks.map((track) => {
        if (track.id !== trackId) return track;

        const trimmedClips = track.clips
          .flatMap((c) => {
            // Skip the moved clip itself
            if (c.id === clipId) return [c];

            const clipStart = c.timelineStart;
            const clipDuration = c.sourceEnd - c.sourceStart;
            const clipEnd = clipStart + clipDuration;

            // Check if there's an overlap
            const overlapStart = Math.max(movedStart, clipStart);
            const overlapEnd = Math.min(movedEnd, clipEnd);

            if (overlapStart >= overlapEnd) {
              // No overlap
              return [c];
            }

            // There's an overlap - trim the underlying clip
            if (overlapStart <= clipStart && overlapEnd >= clipEnd) {
              // The moved clip completely covers this clip - delete it
              return [];
            }

            const result: Clip[] = [];

            if (overlapStart > clipStart) {
              // Keep the part before the overlap
              const beforeEnd = overlapStart;
              const beforeDuration = beforeEnd - clipStart;
              result.push({
                ...c,
                id: uuid(),
                timelineStart: clipStart,
                sourceEnd: c.sourceStart + beforeDuration,
              });
            }

            if (overlapEnd < clipEnd) {
              // Keep the part after the overlap
              const afterStart = overlapEnd;
              const overlapDuration = overlapEnd - overlapStart;
              result.push({
                ...c,
                id: uuid(),
                timelineStart: afterStart,
                sourceStart: c.sourceStart + (overlapStart - clipStart) + overlapDuration,
              });
            }

            return result;
          });

        return {
          ...track,
          clips: trimmedClips,
        };
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
      const assets = state.assets;

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
          const asset = assets.get(clip.assetId);
          const maxEnd = asset?.duration ?? clip.sourceEnd;
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

  addTrack: (type, label) => {
    // capture previous snapshot for undo
    const prevTracks = structuredClone(get().project.tracks);
    const prevPlayback = structuredClone(get().playback);

    const state = get();
    const count = state.project.tracks.filter((t) => t.type === type).length;
    const defaultLabel = type === 'video' ? `V${count + 1}` : `A${count + 1}`;
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

    get().pushUndo({
      description: 'Add track',
      previousState: { tracks: prevTracks, playback: prevPlayback },
      nextState: { tracks: get().project.tracks, playback: get().playback },
    });

    return track;
  },

  updateTrack: (trackId, updates) => {
    set((state) => ({
      project: {
        ...state.project,
        tracks: state.project.tracks.map((t) =>
          t.id === trackId ? { ...t, ...updates } : t
        ),
        updatedAt: Date.now(),
      },
    }));
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
      const targetLinkId = findClipById(state.project.tracks, clipId)?.clip.linkId ?? null;
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
    return findClipById(get().project.tracks, clipId)?.clip ?? null;
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
});

// ─── Utility Functions ──────────────────────────────────────────────────────
// (calculateDuration moved to lib/project/sequence.ts — imported above.)

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
