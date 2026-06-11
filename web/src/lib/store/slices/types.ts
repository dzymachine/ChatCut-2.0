/**
 * EditorStore — the full store interface, shared by every slice.
 *
 * Each slice file implements a Pick<> of this interface via a
 * StateCreator typed against the FULL EditorStore, so cross-slice
 * get()/set() calls stay type-safe.
 */

import type {
  Project,
  Track,
  Clip,
  MediaFile,
  PlaybackState,
  ChatMessage,

  UIState,
  TimelineState,
  TimelineTool,
  TrackType,
  Transform,
  FilterState,
  Command,
  AppliedEffect,
} from '@/types/editor';
import type { EditNode } from '@/lib/agent/types';
import type { Asset } from '@/types/media';

// ─── Store Interface ────────────────────────────────────────────────────────

export interface EditorStore {
  // ── Project State ──
  project: Project;
  /** Imported source assets, unique per file (dedup by nativePath / file identity). */
  assets: Map<string, Asset>;

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
  _undoBatch: {
    description: string;
    snapshotTracks: Track[];
    snapshotPlayback: PlaybackState;
    snapshotEditHistory: EditNode[];
  } | null;

  // ── Edit History (Agent) ──
  editHistory: EditNode[];
  activeNodeId: string | null;

  // ── Project Actions ──
  initProject: (name: string, width: number, height: number, fps: number) => void;
  addMediaFile: (file: File) => Promise<MediaFile>;
  addMediaFileFromPath: (filePath: string, fileName: string, preferredId?: string) => Promise<MediaFile>;
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
  setClipRecipe: (clipId: string, recipe: import('../../../../src-shared/recipe').Recipe) => void;
  /** Ephemeral: set/clear a clip's live-preview proxy URL. Not persisted, not undoable. */
  setClipPreviewProxy: (clipId: string, url: string | null) => void;

  // ── Timeline Actions ──
  setTimelineZoom: (pixelsPerSecond: number) => void;
  setTimelinePanelHeight: (height: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setActiveTool: (tool: TimelineTool) => void;

  // ── Clip Manipulation (Timeline) ──
  moveClip: (clipId: string, newTimelineStart: number, newTrackId?: string) => void;
  trimOverlappingClips: (clipId: string) => void;
  moveSelectedClips: (deltaSeconds: number, basePositions?: Record<string, number>) => void;
  trimClipStart: (clipId: string, newSourceStart: number, newTimelineStart: number) => void;
  trimClipEnd: (clipId: string, newSourceEnd: number) => void;
  splitClip: (clipId: string, splitTimeSeconds: number) => [Clip, Clip] | null;
  addTrack: (type: TrackType, label?: string) => Track;
  updateTrack: (trackId: string, updates: Partial<Track>) => void;

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

  // ── UI Actions ──
  setSelectedClip: (clipId: string | null) => void;
  toggleClipSelection: (clipId: string) => void;

  // ── Undo/Redo ──
  pushUndo: (command: Omit<Command, 'id' | 'timestamp'>) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  beginUndoBatch: (description: string) => void;
  commitUndoBatch: () => void;
  cancelUndoBatch: () => void;

  // ── Edit History (Agent) ──
  appendEditNode: (node: Omit<EditNode, 'id' | 'createdAt' | 'parentId' | 'snapshot'>) => string;
  activateNode: (nodeId: string) => void;
  rollbackToNode: (nodeId: string) => void;
  updateEditNodeSummary: (nodeId: string, summary: string) => void;
  toggleEditNode: (nodeId: string) => void;
  deleteEditNode: (nodeId: string) => void;

  // ── Helpers ──
  getActiveClip: () => Clip | null;
  getClipById: (clipId: string) => Clip | null;
  getClipAtTime: (time: number) => Clip | null;
  getDuration: () => number;
}
