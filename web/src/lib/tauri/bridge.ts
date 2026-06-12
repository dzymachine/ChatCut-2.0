/**
 * Tauri Bridge — Provides a unified interface for Tauri native commands.
 *
 * All Tauri-specific imports are lazy-loaded so the app still works
 * in a regular browser during development (graceful degradation).
 */

export interface FileMetadata {
  name: string;
  path: string;
  size_bytes: number;
  extension: string;
  is_video: boolean;
  is_audio: boolean;
}

/** Returns true if running inside the Tauri desktop shell */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Convert a native file path to a URL that can be used in <video>/<img> src.
 * Uses the Tauri asset protocol. On macOS this produces `asset://localhost/...`,
 * on Windows `https://asset.localhost/...`.
 * Returns the original path unchanged in browser mode.
 */
export async function convertFileSrc(filePath: string): Promise<string> {
  if (!isTauri()) return filePath;
  const { convertFileSrc: tauriConvert } = await import('@tauri-apps/api/core');
  return tauriConvert(filePath);
}

/**
 * Invoke a Tauri command. Falls back to a warning in browser mode.
 * Wraps @tauri-apps/api/core invoke() with error handling.
 */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(
      `Tauri command "${cmd}" called outside of desktop app. ` +
      `This feature requires the desktop version of ChatCut.`
    );
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// ─── File System Commands ────────────────────────────────────────────

/** Get metadata for a file at the given path */
export async function getFileMetadata(path: string): Promise<FileMetadata> {
  return tauriInvoke<FileMetadata>("get_file_metadata", { path });
}

/** List all media files in a directory */
export async function listMediaFiles(directory: string): Promise<FileMetadata[]> {
  return tauriInvoke<FileMetadata[]>("list_media_files", { directory });
}

/** Get the app data directory path */
export async function getAppDataDir(): Promise<string> {
  return tauriInvoke<string>("get_app_data_dir");
}

// ─── FFmpeg Commands ─────────────────────────────────────────────────

/** Check if FFmpeg is installed and return version string */
export async function checkFFmpeg(): Promise<string> {
  return tauriInvoke<string>("check_ffmpeg");
}

// ─── Export Commands ─────────────────────────────────────────────────

/** An applied effect for export (mirrors Rust struct) */
export interface ExportEffect {
  id: string;
  effectId: string;
  parameters: Record<string, number>;
  enabled: boolean;
}

/** A clip in the export data */
export interface ExportClip {
  sourcePath: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  effects: ExportEffect[];
  recipe?: import('../../../src-shared/recipe').Recipe;
}

/** Export settings */
export interface ExportSettings {
  outputPath: string;
  format: string;
  codec: string;
  width: number;
  height: number;
  fps: number;
  quality: string;
  audioCodec: string;
  audioBitrate: string;
}

/** Export progress information */
export interface ExportProgress {
  percent: number;
  frame: number;
  totalFrames: number;
  speed: string;
  eta: number;
  running: boolean;
  error: string | null;
}

/** Media probe result */
export interface MediaProbeResult {
  duration: number;
  width: number | null;
  height: number | null;
  codec: string | null;
  fps: number | null;
  audioCodec: string | null;
  sampleRate: number | null;
  bitRate: number | null;
}

/** Start exporting a video with the given clips and settings */
export async function exportVideo(
  clips: ExportClip[],
  settings: ExportSettings
): Promise<string> {
  return tauriInvoke<string>("export_video", { clips, settings });
}

/** Get the current export progress */
export async function getExportProgress(): Promise<ExportProgress> {
  return tauriInvoke<ExportProgress>("get_export_progress");
}

/** Cancel the current export */
export async function cancelExport(): Promise<string> {
  return tauriInvoke<string>("cancel_export");
}

/** Probe a media file for metadata using ffprobe */
export async function probeMedia(path: string): Promise<MediaProbeResult> {
  return tauriInvoke<MediaProbeResult>("probe_media", { path });
}

/**
 * Render a low-res, recipe-baked preview proxy (mp4) — or a single still frame
 * (png) when `singleFrame` is a timestamp (proxy-local seconds, 0-based within
 * the clip's trimmed segment). Returns the native output file path; wrap with
 * `convertFileSrc()` before assigning to a `<video>`/`<img>` src. Cached by
 * content hash on the backend; a re-applied recipe is an instant hit.
 */
export async function renderRecipePreview(args: {
  clip: ExportClip;
  clipId: string;
  outWidth: number;
  outHeight: number;
  fps: number;
  singleFrame?: number | null;
}): Promise<string> {
  return tauriInvoke<string>("render_recipe_preview", {
    clip: args.clip,
    clipId: args.clipId,
    outWidth: args.outWidth,
    outHeight: args.outHeight,
    fps: args.fps,
    singleFrame: args.singleFrame ?? null,
  });
}

// ─── Generation Commands ─────────────────────────────────────────────

export interface GenerationProgress {
  id: string;
  stage: 'extracting' | 'enriching' | 'uploading' | 'generating' | 'downloading' | 'done' | 'failed' | 'cancelled';
  percent: number;
  message: string;
  outputPath: string | null;
  error: string | null;
  running: boolean;
}

/** Start a Runway video-to-video generation; returns the generation id. */
export async function startGeneration(request: {
  sourcePath: string;
  sourceStart: number;
  sourceEnd: number;
  prompt: string;
  runwayApiKey: string;
  anthropicApiKey?: string | null;
}): Promise<string> {
  return tauriInvoke<string>('start_generation', { request });
}

export async function getGenerationProgress(id: string): Promise<GenerationProgress> {
  return tauriInvoke<GenerationProgress>('get_generation_progress', { id });
}

export async function cancelGeneration(id: string): Promise<void> {
  return tauriInvoke<void>('cancel_generation', { id });
}

// ─── Dialog Commands (via Tauri plugin) ──────────────────────────────

/** Open a native file picker dialog for selecting video files */
export async function openVideoFileDialog(): Promise<string | null> {
  if (!isTauri()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    multiple: false,
    filters: [
      {
        name: "Video Files",
        extensions: ["mp4", "mov", "avi", "mkv", "webm", "m4v"],
      },
      {
        name: "Audio Files",
        extensions: ["mp3", "wav", "aac", "flac", "ogg", "m4a"],
      },
      {
        name: "All Files",
        extensions: ["*"],
      },
    ],
  });

  return result ?? null;
}

/** Open a native folder picker dialog */
export async function openFolderDialog(): Promise<string | null> {
  if (!isTauri()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    directory: true,
    multiple: false,
  });

  return result ?? null;
}

/** Open a save file dialog for export */
export async function saveFileDialog(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;

  const { save } = await import("@tauri-apps/plugin-dialog");
  const result = await save({
    defaultPath: defaultName,
    filters: [
      {
        name: "Video Files",
        extensions: ["mp4", "mov", "webm"],
      },
    ],
  });

  return result ?? null;
}

/** Open a save file dialog for ChatCut project files */
export async function saveProjectDialog(defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;

  const { save } = await import("@tauri-apps/plugin-dialog");
  const result = await save({
    defaultPath: defaultName,
    filters: [
      {
        name: "ChatCut Project",
        extensions: ["chatcut"],
      },
    ],
  });

  return result ?? null;
}

/** Open a file picker dialog for ChatCut project files */
export async function openProjectDialog(): Promise<string | null> {
  if (!isTauri()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    multiple: false,
    filters: [
      {
        name: "ChatCut Project",
        extensions: ["chatcut"],
      },
    ],
  });

  return result ?? null;
}
