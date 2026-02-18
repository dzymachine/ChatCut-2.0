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

import { useEditorStore, type EditorStore } from '@/lib/store/editor-store';
import {
  isTauri,
  saveProjectDialog,
  openProjectDialog,
  getAppDataDir,
} from '@/lib/tauri/bridge';
import type { Project, Clip, Track } from '@/types/editor';
import type { AppliedEffect } from '@/types/effects';

// ─── Project File Format ────────────────────────────────────────────────────

/** Version of the project file format. Increment when breaking changes occur. */
const PROJECT_FORMAT_VERSION = 1;

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
  tracks: SerializedTrack[];
  createdAt: number;
  updatedAt: number;
}

interface SerializedTrack {
  id: string;
  type: string;
  label: string;
  clips: SerializedClip[];
  muted: boolean;
  locked: boolean;
  visible: boolean;
}

interface SerializedClip {
  id: string;
  type: string;
  /** For desktop: the original file path on disk.
   *  For dev mode: the file name (used to re-match when re-opening). */
  sourceFilePath: string;
  sourceFileName: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  effects: AppliedEffect[];
  transitions: unknown[];
}

// ─── Serialize (Save) ───────────────────────────────────────────────────────

/**
 * Serialize the current editor state to a .chatcut project file format.
 */
export function serializeProject(): ChatCutProjectFile {
  const state = useEditorStore.getState();
  const { project, mediaFiles } = state;

  const serializedTracks: SerializedTrack[] = project.tracks.map((track) => ({
    id: track.id,
    type: track.type,
    label: track.label,
    clips: track.clips.map((clip) => {
      const mediaFile = mediaFiles.get(clip.sourceFileId);
      return {
        id: clip.id,
        type: clip.type,
        sourceFilePath: mediaFile?.nativePath ?? '', // Native disk path for Tauri; empty in browser
        sourceFileName: mediaFile?.name ?? '',
        sourceStart: clip.sourceStart,
        sourceEnd: clip.sourceEnd,
        timelineStart: clip.timelineStart,
        effects: clip.effects.map((e) => ({
          id: e.id,
          effectId: e.effectId,
          parameters: { ...e.parameters },
          keyframes: [...e.keyframes],
          enabled: e.enabled,
        })),
        transitions: clip.transitions,
      };
    }),
    muted: track.muted,
    locked: track.locked,
    visible: track.visible,
  }));

  return {
    version: PROJECT_FORMAT_VERSION,
    appVersion: '0.1.0',
    savedAt: Date.now(),
    project: {
      id: project.id,
      name: project.name,
      composition: { ...project.composition },
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
  const parsed = JSON.parse(json) as ChatCutProjectFile;

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
export async function applyLoadedProject(file: ChatCutProjectFile): Promise<void> {
  const p = file.project;

  // Collect all unique source file paths from clips
  const clipSourceMap = new Map<string, SerializedClip[]>();
  for (const track of p.tracks) {
    for (const clip of track.clips) {
      if (clip.sourceFilePath) {
        const list = clipSourceMap.get(clip.sourceFilePath) ?? [];
        list.push(clip);
        clipSourceMap.set(clip.sourceFilePath, list);
      }
    }
  }

  // Re-load media files from their native paths and build ID mappings
  const store = useEditorStore.getState();
  const mediaIdByPath = new Map<string, string>();

  for (const [filePath] of clipSourceMap) {
    if (!filePath) continue;
    try {
      const mediaFile = await store.addMediaFileFromPath(
        filePath,
        filePath.split(/[/\\]/).pop() || 'media'
      );
      mediaIdByPath.set(filePath, mediaFile.id);
    } catch (err) {
      console.warn(`[Project Load] Could not load media: ${filePath}`, err);
    }
  }

  // Build track/clip structures with re-mapped sourceFileId
  const tracks: Track[] = p.tracks.map((track) => ({
    id: track.id,
    type: track.type as Track['type'],
    label: track.label,
    clips: track.clips.map((clip) => ({
      id: clip.id,
      type: clip.type as Clip['type'],
      sourceFileId: mediaIdByPath.get(clip.sourceFilePath) ?? '',
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
      timelineStart: clip.timelineStart,
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
    })),
    muted: track.muted,
    locked: track.locked,
    visible: track.visible,
  }));

  // Apply to store — replace default project with loaded one
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
    undoStack: [],
    redoStack: [],
  }));
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
  await applyLoadedProject(projectFile);

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
