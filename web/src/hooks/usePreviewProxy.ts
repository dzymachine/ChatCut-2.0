"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { findClipById } from "@/lib/timeline/find-clip";
import {
  convertFileSrc,
  isTauri,
  renderRecipePreview,
  type ExportClip,
  type ExportEffect,
} from "@/lib/tauri/bridge";

const DEBOUNCE_MS = 400;
const PROXY_OUT_WIDTH = 640;

/**
 * Phase B trigger: watches the currently-SELECTED clip's recipe (plus trim
 * and source dims) and renders a low-res, recipe-baked preview proxy via the
 * Rust backend. On completion the asset-protocol URL is written to the clip's
 * `previewProxyUrl` via `setClipPreviewProxy`, which the video engine swaps
 * into the canvas (see `video-engine.ts` getActiveVideoClips).
 *
 * Fires for EVERY recipe-mutation path because we subscribe to a fingerprint
 * derived from the clip object — `apply_effect`/`update_effect`/
 * `remove_effect`/`toggle_effect`/`compose_recipe`/`setClipRecipe` all trip it.
 * Debounced ~400ms to avoid encoding mid-drag.
 * Skipped entirely outside Tauri (no native source path).
 * On failure: clears the proxy (engine falls back to source) and surfaces the
 * error in `lastError` so the host UI can flag it.
 *
 * Mount once at a stable orchestration point (e.g. `useVideoEngine`).
 */
export function usePreviewProxy(): {
  isRendering: boolean;
  lastError: string | null;
} {
  const setClipPreviewProxy = useEditorStore((s) => s.setClipPreviewProxy);

  // Single fingerprint dependency: changes whenever anything that affects the
  // proxy output changes. Cheap to compute (sub-ms even for an 8-node recipe).
  const fingerprint = useEditorStore((s) => {
    const id = s.ui.selectedClipIds[0];
    if (!id) return "";
    const c = findClipById(s.project.tracks, id)?.clip;
    if (!c?.recipe) return ""; // no clip / no recipe → no preview proxy needed
    const mf = s.assets.get(c.assetId);
    if (!mf?.nativePath) return ""; // browser-mode / unresolved → skip
    return [
      id,
      JSON.stringify(c.recipe),
      c.sourceStart.toFixed(6),
      c.sourceEnd.toFixed(6),
      mf.nativePath,
      mf.width ?? 0,
      mf.height ?? 0,
      s.project.composition.fps,
    ].join("|");
  });

  const [isRendering, setIsRendering] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Token cancels stale inflight work when fingerprint changes.
  const renderTokenRef = useRef(0);

  useEffect(() => {
    if (!isTauri()) return;
    if (!fingerprint) {
      setIsRendering(false);
      setLastError(null);
      return;
    }

    const myToken = ++renderTokenRef.current;

    const handle = window.setTimeout(async () => {
      if (myToken !== renderTokenRef.current) return;

      // Read fresh state inside the debounced callback so we don't capture
      // stale closures across rapid edits.
      const state = useEditorStore.getState();
      const clipId = state.ui.selectedClipIds[0];
      if (!clipId) return;
      const clip = findClipById(state.project.tracks, clipId)?.clip;
      if (!clip || !clip.recipe) return;
      const mediaFile = state.assets.get(clip.assetId);
      if (!mediaFile?.nativePath) return;

      // Even output dims preserving source aspect.
      const srcW = mediaFile.width && mediaFile.width > 0 ? mediaFile.width : 1920;
      const srcH = mediaFile.height && mediaFile.height > 0 ? mediaFile.height : 1080;
      const outWidth = (PROXY_OUT_WIDTH >> 1) * 2;
      const outHeight = Math.max(16, (Math.round((outWidth * srcH) / srcW) >> 1) * 2);
      const fps = state.project.composition.fps > 0 ? state.project.composition.fps : 30;

      setIsRendering(true);
      setLastError(null);

      try {
        const exportClip: ExportClip = {
          sourcePath: mediaFile.nativePath,
          sourceStart: clip.sourceStart,
          sourceEnd: clip.sourceEnd,
          timelineStart: clip.timelineStart,
          effects: clip.effects.map<ExportEffect>((e) => ({
            id: e.id,
            effectId: e.effectId,
            parameters: e.parameters,
            enabled: e.enabled,
          })),
          recipe: clip.recipe,
        };
        const path = await renderRecipePreview({
          clip: exportClip,
          clipId: clip.id,
          outWidth,
          outHeight,
          fps,
          singleFrame: null,
        });
        if (myToken !== renderTokenRef.current) return;
        const url = await convertFileSrc(path);
        if (myToken !== renderTokenRef.current) return;
        setClipPreviewProxy(clip.id, url);
      } catch (err) {
        if (myToken !== renderTokenRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[preview-proxy] render failed:", msg);
        setLastError(msg);
        setClipPreviewProxy(clip.id, null);
      } finally {
        if (myToken === renderTokenRef.current) {
          setIsRendering(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [fingerprint, setClipPreviewProxy]);

  return { isRendering, lastError };
}
