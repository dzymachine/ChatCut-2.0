/**
 * ChatCut — Project Serializer
 *
 * Handles saving and loading .chatcut project files.
 * Projects are stored as JSON with all project state (tracks, clips, effects).
 *
 * Media files themselves are NOT stored in the project file — only references
 * (file paths). When loading a project, media files are re-loaded from disk.
 *
 * File format: .chatcut (JSON with a version header for future migrations)
 */

import { v4 as uuid } from 'uuid';
import { useEditorStore } from '@/lib/store/editor-store';
import {
  isTauri,
  saveProjectDialog,
  openProjectDialog,
  getAppDataDir,
} from '@/lib/tauri/bridge';
import type { Clip, Track, MediaFile } from '@/types/editor';
import type { Asset } from '@/types/media';
import type { AppliedEffect } from '@/types/effects';
import { detectKindFromName } from '@/lib/media/probe';

// ─── Project File Format ────────────────────────────────────────────────────

/** Version of the project file format. Increment when breaking changes occur.
 *  v1 → clips embed sourceFilePath/sourceFileName/type.
 *  v2 → top-level assets[]; clips reference assets by assetId. The loader is
 *       tolerant: it still resolves v1-style clips (and clips written by the
 *       Rust MCP server) via their embedded path. */
const PROJECT_FORMAT_VERSION = 2;

/** The structure stored on disk as a .chatcut file */
interface ChatCutProjectFile {
  /** File format version for future migration support */
  version: number;
  /** Application version that saved this file */
  appVersion: string;
  /** When this file was saved */
  savedAt: number;
  /** The project data */
  project: SerializedProject;
}

/** A serialized project — the on-disk representation.
 *  Strips non-serializable fields (blob URLs, File refs). */
interface SerializedProject {
  id: string;
  name: string;
  composition: {
    width: number;
    height: number;
    fps: number;
    duration: number;
  };
  /** v2: the source-asset library. Absent in v1 files. */
  assets?: SerializedAsset[];
  tracks: SerializedTrack[];
  createdAt: number;
  updatedAt: number;
}

/** One imported source file (v2). Probed metadata is persisted so a missing
 *  file can still render a sensibly-sized placeholder. */
interface SerializedAsset {
  id: string;
  /** Absolute native path. Empty string for browser-mode (blob-only) assets. */
  path: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
}

interface SerializedTrack {
  id: string;
  type: string;
  label: string;
  clips: SerializedClip[];
  muted: boolean;
  locked: boolean;
  visible: boolean;
  /** Absent in project files saved before track gain/pan/solo existed. */
  volume?: number;
  pan?: number;
  solo?: boolean;
}

interface SerializedClip {
  id: string;
  /** v2: reference into the project's assets[]. */
  assetId?: string;
  /** v1 legacy fields — read for migration and for clips written by the
   *  Rust MCP server; not written by the v2 saver. */
  type?: string;
  sourceFilePath?: string;
  sourceFileName?: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  /** Linked clip group ID — null if unlinked. */
  linkId: string | null;
  effects: AppliedEffect[];
  transitions: unknown[];
  recipe?: import('../../../src-shared/recipe').Recipe;
}

// ─── Serialize (Save) ───────────────────────────────────────────────────────

/**
 * Serialize the current editor state to a .chatcut project file format.
 */
export function serializeProject(): ChatCutProjectFile {
  const state = useEditorStore.getState();
  const { project, assets } = state;

  const serializedAssets: SerializedAsset[] = [...assets.values()].map((a) => ({
    id: a.id,
    path: a.nativePath ?? '',
    name: a.name,
    kind: a.kind,
    duration: a.duration,
    ...(a.width ? { width: a.width } : {}),
    ...(a.height ? { height: a.height } : {}),
    ...(a.fps ? { fps: a.fps } : {}),
  }));

  const serializedTracks: SerializedTrack[] = project.tracks.map((track) => ({
    id: track.id,
    type: track.type,
    label: track.label,
    clips: track.clips.map((clip) => ({
      id: clip.id,
      assetId: clip.assetId,
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
      timelineStart: clip.timelineStart,
      linkId: clip.linkId,
      effects: clip.effects.map((e) => ({
        id: e.id,
        effectId: e.effectId,
        parameters: { ...e.parameters },
        keyframes: [...e.keyframes],
        enabled: e.enabled,
      })),
      transitions: clip.transitions,
      ...(clip.recipe && { recipe: clip.recipe }),
    })),
    muted: track.muted,
    locked: track.locked,
    visible: track.visible,
    volume: track.volume,
    pan: track.pan,
    solo: track.solo,
  }));

  return {
    version: PROJECT_FORMAT_VERSION,
    appVersion: '0.1.0',
    savedAt: Date.now(),
    project: {
      id: project.id,
      name: project.name,
      composition: { ...project.composition },
      assets: serializedAssets,
      tracks: serializedTracks,
      createdAt: project.createdAt,
      updatedAt: Date.now(),
    },
  };
}

/**
 * Convert a serialized project file to a JSON string.
 */
export function projectToJSON(): string {
  return JSON.stringify(serializeProject(), null, 2);
}

// ─── Deserialize (Load) ─────────────────────────────────────────────────────

/**
 * Load a project from a JSON string (from a .chatcut file).
 * Note: Media files need to be re-loaded separately after this.
 */
export function loadProjectFromJSON(json: string): ChatCutProjectFile {
  let parsed: ChatCutProjectFile;
  try {
    parsed = JSON.parse(json) as ChatCutProjectFile;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Project file is not valid JSON: ${msg}`);
  }

  // Version check
  if (!parsed.version || parsed.version > PROJECT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported project file version: ${parsed.version}. ` +
      `This version of ChatCut supports up to version ${PROJECT_FORMAT_VERSION}.`
    );
  }

  return parsed;
}

/**
 * Apply a loaded project file to the editor store.
 * This replaces the current project state and re-maps media files from disk.
 */
export async function applyLoadedProject(
  file: ChatCutProjectFile,
): Promise<{ missingAssets: string[] }> {
  const p = file.project;
  const store = useEditorStore.getState();

  // ── 1. Collect every asset the file references ──
  // v2 files carry assets[]; v1 files (and MCP-written clips) embed paths on
  // clips, for which we synthesize asset entries keyed by path.
  const wanted = new Map<string, SerializedAsset>();
  for (const a of p.assets ?? []) {
    wanted.set(a.id, a);
  }
  const synthIdByPath = new Map<string, string>();
  for (const track of p.tracks) {
    for (const clip of track.clips) {
      if (clip.assetId || !clip.sourceFilePath) continue;
      let sid = synthIdByPath.get(clip.sourceFilePath);
      if (!sid) {
        sid = uuid();
        synthIdByPath.set(clip.sourceFilePath, sid);
        wanted.set(sid, {
          id: sid,
          path: clip.sourceFilePath,
          name: clip.sourceFileName || clip.sourceFilePath.split(/[/\\]/).pop() || 'media',
          kind: detectKindFromName(clip.sourceFilePath),
          duration: Math.max(0, (clip.sourceEnd ?? 0) - 0),
        });
      }
    }
  }

  // ── 2. Resolve assets: import from disk, or register a 'missing' placeholder ──
  // Every wanted asset resolves to SOMETHING — clips never end up orphaned.
  const idMap = new Map<string, string>(); // serialized id → live asset id
  const placeholders: Asset[] = [];
  const missingAssets: string[] = [];

  for (const w of wanted.values()) {
    if (w.path) {
      try {
        const asset = await store.addMediaFileFromPath(w.path, w.name, w.id);
        idMap.set(w.id, asset.id);
        continue;
      } catch (err) {
        console.warn(`[Project Load] Could not load media: ${w.path}`, err);
      }
    }
    placeholders.push({
      id: w.id,
      kind: w.kind,
      name: w.name,
      nativePath: w.path || null,
      previewUrl: '',
      status: 'missing',
      duration: w.duration ?? 0,
      width: w.width,
      height: w.height,
      fps: w.fps,
    });
    idMap.set(w.id, w.id);
    missingAssets.push(w.name);
  }

  const resolveClipAsset = (clip: SerializedClip): string => {
    if (clip.assetId) return idMap.get(clip.assetId) ?? clip.assetId;
    if (clip.sourceFilePath) {
      const sid = synthIdByPath.get(clip.sourceFilePath);
      if (sid) return idMap.get(sid) ?? sid;
    }
    return '';
  };

  // ── 3. Rebuild tracks/clips with live asset ids ──
  const tracks: Track[] = p.tracks.map((track) => ({
    id: track.id,
    type: track.type === 'audio' ? 'audio' : 'video',
    label: track.label,
    clips: track.clips.map((clip) => ({
      id: clip.id,
      assetId: resolveClipAsset(clip),
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
      timelineStart: clip.timelineStart,
      linkId: clip.linkId ?? null,
      transform: {
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
      },
      effects: clip.effects ?? [],
      transitions: (clip.transitions ?? []) as Clip['transitions'],
      ...(clip.recipe && { recipe: clip.recipe }),
    })),
    muted: track.muted,
    locked: track.locked,
    visible: track.visible,
    volume: track.volume ?? 1,
    pan: track.pan ?? 0,
    solo: track.solo ?? false,
  }));

  // ── 4. Apply — assets map = freshly imported ∪ missing placeholders ──
  const newAssets = new Map<string, MediaFile>();
  for (const id of idMap.values()) {
    const asset = useEditorStore.getState().assets.get(id);
    if (asset) newAssets.set(id, asset);
  }
  for (const ph of placeholders) {
    newAssets.set(ph.id, ph);
  }

  useEditorStore.setState((state) => ({
    project: {
      ...state.project,
      id: p.id,
      name: p.name,
      tracks,
      composition: p.composition,
      createdAt: p.createdAt,
      updatedAt: Date.now(),
    },
    assets: newAssets,
    undoStack: [],
    redoStack: [],
  }));

  return { missingAssets };
}

// ─── Save / Load via Tauri ──────────────────────────────────────────────────

/**
 * Save the current project to a .chatcut file.
 * Opens a native save dialog if no path is provided.
 *
 * Returns the saved file path, or null if cancelled.
 */
export async function saveProject(filePath?: string): Promise<string | null> {
  const json = projectToJSON();

  if (!isTauri()) {
    // Browser fallback: download as file
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${useEditorStore.getState().project.name || 'project'}.chatcut`;
    a.click();
    URL.revokeObjectURL(url);
    return a.download;
  }

  // Desktop: use native save dialog or provided path
  const savePath = filePath ?? await saveProjectDialog(
    `${useEditorStore.getState().project.name || 'project'}.chatcut`
  );

  if (!savePath) return null;

  // Write via Tauri fs plugin
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(savePath, json);

  return savePath;
}

/**
 * Load a project from a .chatcut file.
 * Opens a native file dialog.
 *
 * Returns the loaded file path, or null if cancelled.
 */
export async function loadProject(): Promise<string | null> {
  if (!isTauri()) {
    // Browser fallback: file input
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.chatcut';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const text = await file.text();
        const projectFile = loadProjectFromJSON(text);
        await applyLoadedProject(projectFile);
        resolve(file.name);
      };
      input.click();
    });
  }

  // Desktop: native file dialog
  const filePath = await openProjectDialog();
  if (!filePath) return null;

  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const text = await readTextFile(filePath);
  const projectFile = loadProjectFromJSON(text);
  const { missingAssets } = await applyLoadedProject(projectFile);

  if (missingAssets.length > 0) {
    const { showToast } = await import('@/components/ui/toast-notification');
    showToast(
      'error',
      `${missingAssets.length} source file${missingAssets.length > 1 ? 's' : ''} missing — affected clips won't preview or export (${missingAssets.slice(0, 3).join(', ')}${missingAssets.length > 3 ? '…' : ''})`,
    );
  }

  return filePath;
}

// ─── Auto-Save ──────────────────────────────────────────────────────────────

let autoSaveInterval: ReturnType<typeof setInterval> | null = null;
let lastAutoSavePath: string | null = null;

/**
 * Start auto-saving the project every `intervalMs` milliseconds.
 * Saves to the app data directory.
 */
export async function startAutoSave(intervalMs: number = 60_000): Promise<void> {
  stopAutoSave();

  if (!isTauri()) return; // Only auto-save in desktop mode

  try {
    const appDataDir = await getAppDataDir();
    lastAutoSavePath = `${appDataDir}/autosave.chatcut`;
  } catch {
    console.warn('[AutoSave] Could not get app data directory');
    return;
  }

  autoSaveInterval = setInterval(async () => {
    if (!lastAutoSavePath) return;

    try {
      const json = projectToJSON();
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(lastAutoSavePath, json);
      console.log('[AutoSave] Project saved');
    } catch (err) {
      console.warn('[AutoSave] Failed:', err);
    }
  }, intervalMs);
}

/**
 * Stop auto-saving.
 */
export function stopAutoSave(): void {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}
