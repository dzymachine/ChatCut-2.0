/**
 * ChatCut Editor — Core Type Definitions
 *
 * This is the single source of truth for every data structure in the editor.
 * Designed for the full vision (multi-track, keyframes, transitions) even
 * though the MVP only uses a subset.
 *
 * RULES:
 *  - Every type here must be JSON-serializable (no functions, no DOM refs).
 *  - IDs use uuid v4 strings.
 *  - Times are in SECONDS (floating point).
 *  - Positions are in PIXELS relative to the composition dimensions.
 *  - Scale is a multiplier (1.0 = 100%).
 */

// Import effect types for local use in the EditAction union
import type {
  AppliedEffect as _AppliedEffect,
  EffectKeyframe as _EffectKeyframe,
  ApplyEffectAction as _ApplyEffectAction,
  RemoveEffectAction as _RemoveEffectAction,
  UpdateEffectAction as _UpdateEffectAction,
  ToggleEffectAction as _ToggleEffectAction,
  EffectAction as _EffectAction,
} from './effects';

// Re-export effect types so consumers can import from one place
export type AppliedEffect = _AppliedEffect;
export type EffectKeyframe = _EffectKeyframe;
export type ApplyEffectAction = _ApplyEffectAction;
export type RemoveEffectAction = _RemoveEffectAction;
export type UpdateEffectAction = _UpdateEffectAction;
export type ToggleEffectAction = _ToggleEffectAction;
export type EffectAction = _EffectAction;

// ─── Composition ────────────────────────────────────────────────────────────

/** The top-level project structure. */
export interface Project {
  id: string;
  name: string;
  composition: Composition;
  tracks: Track[];
  createdAt: number; // unix timestamp ms
  updatedAt: number;
}

/** Output dimensions and timing. */
export interface Composition {
  width: number;  // pixels (e.g. 1920)
  height: number; // pixels (e.g. 1080)
  fps: number;    // frames per second (e.g. 30)
  duration: number; // total duration in seconds (derived from clips)
}

// ─── Tracks & Clips ─────────────────────────────────────────────────────────

export type TrackType = 'video' | 'audio' | 'text' | 'effect';

export interface Track {
  id: string;
  type: TrackType;
  label: string;
  clips: Clip[];
  muted: boolean;
  locked: boolean;
  visible: boolean;
}

export interface Clip {
  id: string;
  type: ClipType;

  // Source reference — the original media file
  sourceFileId: string; // references a loaded MediaFile

  // What portion of the source to use
  sourceStart: number; // seconds into the original file
  sourceEnd: number;   // seconds into the original file

  // Where it sits on the timeline
  timelineStart: number; // seconds from the start of the composition

  // Visual transforms (zoom, position, rotation, opacity, filters)
  // Legacy field — kept for backward compat with Canvas 2D preview engine.
  // In Phase 2 (WebGL), this will be derived from the effects array.
  transform: Transform;

  // Effect stack — the new unified effect system.
  // Each entry references an EffectDescriptor from the registry.
  // Effects are applied in order (first to last).
  effects: import('./effects').AppliedEffect[];

  // Future: per-clip transitions, keyframes
  transitions: Transition[];
}

export type ClipType = 'video' | 'audio' | 'image' | 'text';

// ─── Media Files ────────────────────────────────────────────────────────────

/** A loaded media file. Stored separately from clips so multiple clips can
 *  reference the same source. */
export interface MediaFile {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  /** URL safe for use in <video>/<audio> elements.
   *  In browser mode: blob URL from URL.createObjectURL().
   *  In Tauri mode: asset protocol URL from convertFileSrc(). */
  previewUrl: string;
  /** Absolute native file path on disk (Tauri desktop only).
   *  Used for FFmpeg export and project serialization.
   *  Null in browser mode where we only have blob URLs. */
  nativePath: string | null;
  /** Original File reference (not serializable — ephemeral). */
  file?: File;
  duration: number; // seconds
  width?: number;
  height?: number;
}

// ─── Transforms ─────────────────────────────────────────────────────────────

export interface Transform {
  scale: number;       // 1.0 = 100%, 1.5 = 150%
  positionX: number;   // px offset from center
  positionY: number;   // px offset from center
  rotation: number;    // degrees
  opacity: number;     // 0–1
  filters: FilterState;
}

export interface FilterState {
  blur: number;        // px (0 = none)
  brightness: number;  // multiplier (1.0 = normal)
  contrast: number;    // multiplier (1.0 = normal)
  saturate: number;    // multiplier (1.0 = normal)
  grayscale: number;   // 0–1
  sepia: number;       // 0–1
  hueRotate: number;   // degrees
}

/** Default transform — no changes. */
export const DEFAULT_TRANSFORM: Transform = {
  scale: 1.0,
  positionX: 0,
  positionY: 0,
  rotation: 0,
  opacity: 1.0,
  filters: {
    blur: 0,
    brightness: 1.0,
    contrast: 1.0,
    saturate: 1.0,
    grayscale: 0,
    sepia: 0,
    hueRotate: 0,
  },
};

// ─── Transitions (Phase 2+) ────────────────────────────────────────────────

export type TransitionType = 'fade' | 'crossDissolve' | 'wipe' | 'slide';

export interface Transition {
  id: string;
  type: TransitionType;
  duration: number; // seconds
  position: 'in' | 'out';
}

// ─── Playback State ─────────────────────────────────────────────────────────

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number; // seconds
  volume: number;      // 0–1
  isMuted: boolean;
  playbackRate: number; // 1.0 = normal
  loop: boolean;
}

export const DEFAULT_PLAYBACK: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
  volume: 1.0,
  isMuted: false,
  playbackRate: 1.0,
  loop: false,
};

// ─── Chat / AI ──────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  /** If the assistant message triggered editing actions, store them here. */
  actions?: EditAction[];
  isLoading?: boolean;
  isError?: boolean;
}

// ─── Edit Actions ───────────────────────────────────────────────────────────
// These mirror the action types from the FastAPI backend's function schemas.
// Every action that the AI can trigger is typed here.

export type EditAction =
  | ZoomAction
  | PositionAction
  | OpacityAction
  | RotationAction
  | FilterAction
  | VolumeAction
  | PlaybackRateAction
  | CutAction
  | TrimAction
  | DeleteClipAction
  | ApplyEffectAction
  | RemoveEffectAction
  | UpdateEffectAction
  | ToggleEffectAction;

export interface ZoomAction {
  type: 'zoom';
  scale: number; // target scale (e.g. 1.5 = 150%)
  animated?: boolean;
  duration?: number; // animation duration in seconds
}

export interface PositionAction {
  type: 'position';
  x: number;
  y: number;
  animated?: boolean;
  duration?: number;
}

export interface OpacityAction {
  type: 'opacity';
  value: number; // 0–1
  animated?: boolean;
  duration?: number;
}

export interface RotationAction {
  type: 'rotation';
  degrees: number;
  animated?: boolean;
  duration?: number;
}

export interface FilterAction {
  type: 'filter';
  filter: keyof FilterState;
  value: number;
  animated?: boolean;
  duration?: number;
}

export interface VolumeAction {
  type: 'volume';
  value: number; // 0–1
}

export interface PlaybackRateAction {
  type: 'playbackRate';
  value: number;
}

export interface CutAction {
  type: 'cut';
  clipId: string;
  time: number; // seconds — where to split
}

export interface TrimAction {
  type: 'trim';
  clipId: string;
  start?: number; // new source start
  end?: number;   // new source end
}

export interface DeleteClipAction {
  type: 'deleteClip';
  clipId: string;
}

// ─── Commands (for undo/redo) ───────────────────────────────────────────────

export interface Command {
  id: string;
  description: string;
  timestamp: number;
  /** State snapshot before this command was applied. */
  previousState: Partial<ProjectSnapshot>;
  /** State snapshot after this command was applied. */
  nextState: Partial<ProjectSnapshot>;
}

/** A partial snapshot used for undo/redo. Only includes the fields that changed. */
export interface ProjectSnapshot {
  tracks: Track[];
  playback: PlaybackState;
}

// ─── UI State ───────────────────────────────────────────────────────────────

export type EditorPanel = 'chat' | 'properties' | 'media';

export interface UIState {
  activePanel: EditorPanel;
  selectedClipId: string | null;
  selectedTrackId: string | null;
  isChatOpen: boolean;
  isDragging: boolean;
  zoomLevel: number; // timeline zoom (1.0 = default)
}

export const DEFAULT_UI_STATE: UIState = {
  activePanel: 'chat',
  selectedClipId: null,
  selectedTrackId: null,
  isChatOpen: true,
  isDragging: false,
  zoomLevel: 1.0,
};

// ─── Timeline State ─────────────────────────────────────────────────────────

/** Tool modes for timeline interaction. */
export type TimelineTool = 'select' | 'razor' | 'slip';

/** Persistent timeline panel state stored in the editor store. */
export interface TimelineState {
  /** Pixels per second — the fundamental zoom metric. */
  pixelsPerSecond: number;
  /** Whether magnetic snapping is enabled. */
  snapEnabled: boolean;
  /** Snap distance threshold in pixels. */
  snapThresholdPx: number;
  /** Active timeline tool. */
  activeTool: TimelineTool;
  /** Height of the timeline panel in pixels. */
  panelHeight: number;
  /** Minimum panel height in pixels. */
  panelMinHeight: number;
  /** Maximum panel height as a fraction of viewport height. */
  panelMaxHeightRatio: number;
}

export const DEFAULT_TIMELINE_STATE: TimelineState = {
  pixelsPerSecond: 100,
  snapEnabled: true,
  snapThresholdPx: 8,
  activeTool: 'select',
  panelHeight: 250,
  panelMinHeight: 120,
  panelMaxHeightRatio: 0.55,
};

/** Track height constants (in pixels). */
export const TRACK_HEIGHT = 48;
export const RULER_HEIGHT = 28;
export const TRACK_HEADER_WIDTH = 180;
