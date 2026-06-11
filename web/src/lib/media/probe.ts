/**
 * Media probing & type detection — pure media-layer helpers, no store access.
 * Extracted from editor-store so the import pipeline owns probing, not the store.
 */

// Some platforms (e.g. macOS WKWebView / Tauri) don't always set `file.type`
// correctly, so we fall back to extension checks.
export const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogv', 'ogg', 'ts', 'mts']);
export const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma']);

export function fileExtension(name: string): string {
  return (name.split('.').pop() || '').toLowerCase();
}

/** Detect whether a File is video, audio, or image. */
export function detectMediaType(file: File): 'video' | 'audio' | 'image' {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  // MIME type missing — fall back to extension
  return detectKindFromName(file.name);
}

/** Detect media kind from a file name/path (extension-based). */
export function detectKindFromName(name: string): 'video' | 'audio' | 'image' {
  const ext = fileExtension(name);
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'image';
}

/** Check if a File looks like a supported video (MIME or extension). */
export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return VIDEO_EXTENSIONS.has(fileExtension(file.name));
}

/**
 * Probe a media file for duration/dimensions using a temporary HTML element.
 * Includes a timeout so the promise never hangs indefinitely.
 * If the browser probe fails in Tauri mode, falls back to FFprobe via the Rust backend.
 */
export async function probeMediaDuration(
  url: string,
  type: 'video' | 'audio',
  nativePath?: string | null,
): Promise<{ duration: number; width?: number; height?: number; fps?: number }> {
  const TIMEOUT_MS = 8000;

  // The browser <video>/<audio> element exposes duration + dimensions but
  // NOT frame rate. When a native path is available (Tauri), fetch fps from
  // ffprobe so composition.fps can match the source. Best-effort.
  const fetchFps = async (): Promise<number | undefined> => {
    if (!nativePath) return undefined;
    try {
      const { probeMedia } = await import('@/lib/tauri/bridge');
      const result = await probeMedia(nativePath);
      return result.fps && result.fps > 0 ? result.fps : undefined;
    } catch {
      return undefined;
    }
  };

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
    // Browser probe gave duration/dims; augment with fps from ffprobe.
    const fps = type === 'video' ? await fetchFps() : undefined;
    return { ...raw, fps };
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
            fps: result.fps && result.fps > 0 ? result.fps : undefined,
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
