/**
 * Asset construction helpers — building Assets from native paths or browser
 * Files, including the preview-URL resolution quirks. Pure: no store access.
 */

import { v4 as uuid } from 'uuid';
import type { Asset, AssetKind } from '@/types/media';
import { detectKindFromName, detectMediaType, fileExtension, probeMediaDuration } from './probe';

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
  mkv: 'video/x-matroska', webm: 'video/webm', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
  flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
};

/**
 * Resolve a preview URL for a native file path.
 *
 * Video/audio: read via the FS plugin into a blob URL — the Tauri asset
 * protocol doesn't support the HTTP Range requests <video>/<audio> need for
 * streaming playback on macOS. Images: the asset protocol works fine.
 */
export async function resolvePreviewUrl(filePath: string, kind: AssetKind): Promise<string> {
  if (kind === 'video' || kind === 'audio') {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(filePath);
    const ext = fileExtension(filePath);
    const mime = MIME_BY_EXT[ext] || (kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  }
  const { convertFileSrc } = await import('@/lib/tauri/bridge');
  return convertFileSrc(filePath);
}

/**
 * Build a ready Asset from a native path: resolve preview URL + probe.
 * Throws if the file can't be read (caller decides missing/error semantics).
 */
export async function buildAssetFromPath(
  filePath: string,
  fileName: string,
  id: string = uuid(),
): Promise<Asset> {
  const kind = detectKindFromName(fileName);
  const previewUrl = await resolvePreviewUrl(filePath, kind);

  const asset: Asset = {
    id,
    kind,
    name: fileName,
    nativePath: filePath,
    previewUrl,
    status: 'ready',
    duration: 0,
  };

  if (kind === 'video' || kind === 'audio') {
    const meta = await probeMediaDuration(previewUrl, kind, filePath);
    asset.duration = meta.duration;
    if (meta.width) asset.width = meta.width;
    if (meta.height) asset.height = meta.height;
    if (meta.fps) asset.fps = meta.fps;
  }

  return asset;
}

/** Build a ready Asset from a browser File (blob URL, no native path). */
export async function buildAssetFromFile(file: File, id: string = uuid()): Promise<Asset> {
  const kind = detectMediaType(file);
  const blobUrl = URL.createObjectURL(file);

  const asset: Asset = {
    id,
    kind,
    name: file.name,
    nativePath: null,
    previewUrl: blobUrl,
    status: 'ready',
    duration: 0,
    file,
  };

  if (kind === 'video' || kind === 'audio') {
    const meta = await probeMediaDuration(blobUrl, kind);
    asset.duration = meta.duration;
    if (meta.width) asset.width = meta.width;
    if (meta.height) asset.height = meta.height;
    if (meta.fps) asset.fps = meta.fps;
  }

  return asset;
}

/** Dedup identity for browser Files (no path available). */
export function browserFileIdentity(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}
