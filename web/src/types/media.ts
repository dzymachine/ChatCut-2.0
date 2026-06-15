/**
 * ChatCut — Media Asset Model
 *
 * An Asset is one imported source media file. Assets are unique per source:
 * importing the same file twice yields the SAME asset (dedup by nativePath
 * on desktop, by name+size+mtime in browser mode). Clips reference assets by
 * `assetId` and never own media metadata themselves.
 *
 * Lifecycle: inserted as 'probing' → patched to 'ready' (with probed
 * duration/dims/fps) or 'error'. Project load marks unresolvable sources as
 * 'missing' so the UI can badge clips and exports can refuse cleanly.
 */

export type AssetKind = 'video' | 'audio' | 'image';

export type AssetStatus = 'probing' | 'ready' | 'missing' | 'error';

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  /** Absolute native path on disk (Tauri). Dedup key. Null in browser mode. */
  nativePath: string | null;
  /** URL usable in <video>/<audio>/<img>: blob URL or asset-protocol URL. */
  previewUrl: string;
  status: AssetStatus;
  duration: number; // seconds
  width?: number;
  height?: number;
  /** Source frame rate — used to set composition fps on first clip. */
  fps?: number;
  /** Original File (browser mode) — ephemeral, used for dedup. Not serialized. */
  file?: File;
}
