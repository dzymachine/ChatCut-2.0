/**
 * Assets slice — imported source media (dedup by nativePath / file identity).
 *
 * Owns: `assets`
 * Actions: addMediaFile, addMediaFileFromPath
 */

import type { StateCreator } from 'zustand';
import type { MediaFile } from '@/types/editor';
import { isTauri } from '@/lib/tauri/bridge';
import {
  buildAssetFromFile,
  buildAssetFromPath,
  browserFileIdentity,
} from '@/lib/media/asset-manager';
import type { EditorStore } from './types';

type AssetsSlice = Pick<EditorStore, 'assets' | 'addMediaFile' | 'addMediaFileFromPath'>;

export const createAssetsSlice: StateCreator<EditorStore, [], [], AssetsSlice> = (set, get) => ({
  // ── Initial State ──
  assets: new Map(),

  addMediaFile: async (file: File): Promise<MediaFile> => {
    // desktop drop/file-picker yields a File object that also has a native
    // `path` property; we prefer using the path handler so that we can
    // access the real file via the Tauri FS plugin (avoids sandbox issues).
    if (isTauri() && file.path) {
      return get().addMediaFileFromPath(file.path, file.name || '');
    }

    // Dedup: importing the same browser File twice returns the same asset.
    const identity = browserFileIdentity(file);
    for (const existing of get().assets.values()) {
      if (existing.file && browserFileIdentity(existing.file) === identity) {
        return existing;
      }
    }

    const asset = await buildAssetFromFile(file);
    set((state) => {
      const newMap = new Map(state.assets);
      newMap.set(asset.id, asset);
      return { assets: newMap };
    });
    return asset;
  },

  addMediaFileFromPath: async (filePath: string, fileName: string, preferredId?: string): Promise<MediaFile> => {
    // Dedup by native path: importing the same file twice returns the SAME
    // asset (one library entry, N clips). A 'missing' asset is re-resolved.
    const existing = [...get().assets.values()].find((a) => a.nativePath === filePath);
    if (existing && existing.status !== 'missing' && existing.status !== 'error') {
      return existing;
    }

    const asset = await buildAssetFromPath(filePath, fileName, existing?.id ?? preferredId);
    set((state) => {
      const newMap = new Map(state.assets);
      newMap.set(asset.id, asset);
      return { assets: newMap };
    });
    return asset;
  },
});
