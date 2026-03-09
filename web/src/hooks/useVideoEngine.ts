"use client";

/**
 * React hook that manages the VideoEngine lifecycle.
 * Initializes the engine when a canvas ref is available,
 * and destroys it on unmount.
 *
 * Also watches for clip deletions and cleans up the engine
 * (stops audio, unloads source) when the timeline becomes empty.
 *
 * RESILIENCE: If the engine's video source is missing but clips exist
 * (e.g. after HMR re-initialized the engine), it automatically reloads
 * the source from the first video clip's media file.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { getVideoEngine, destroyVideoEngine } from "@/lib/engine/video-engine";
import { useEditorStore } from "@/lib/store/editor-store";

export function useVideoEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(getVideoEngine());
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Track whether the timeline has clips so we can detect transitions
  const hasClips = useEditorStore((s) =>
    s.project.tracks.some((t) => t.clips.length > 0)
  );
  const prevHasClips = useRef(hasClips);

  // Keep the engine's store reference in sync on EVERY render.
  // After HMR re-evaluates the store module (creating a new Zustand store),
  // the engine on globalThis still holds the old getState(). useEffect([])
  // doesn't re-run on Fast Refresh, so this must live outside the effect.
  // Guarded for SSR where the engine may be a stale globalThis singleton.
  if (typeof window !== 'undefined') {
    engineRef.current.refreshStoreRef(useEditorStore.getState);
  }

  // Initialize engine when canvas is available.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = engineRef.current;
    engine.refreshStoreRef(useEditorStore.getState);
    engine.init(canvas);
    setIsReady(true);

    return () => {
      if (process.env.NODE_ENV === 'production') {
        destroyVideoEngine();
        engineRef.current = getVideoEngine();
      }
      setIsReady(false);
    };
  }, []);

  // When clips go from some → none, unload the engine so audio stops
  // and the canvas resets to the placeholder.
  useEffect(() => {
    if (prevHasClips.current && !hasClips) {
      engineRef.current.unloadSource();
      setLoadError(null);
    }
    prevHasClips.current = hasClips;
  }, [hasClips]);

  // Auto-reload: if the engine lost its video source (e.g. after HMR)
  // but clips still exist, reload from the first video clip's media file.
  useEffect(() => {
    const engine = engineRef.current;
    if (!hasClips || !isReady) return;
    if (engine.hasSourceLoaded()) return;

    const state = useEditorStore.getState();
    let firstVideoClip = null;
    for (const track of state.project.tracks) {
      if (track.type !== 'video') continue;
      if (track.clips.length > 0) {
        firstVideoClip = track.clips[0];
        break;
      }
    }
    if (!firstVideoClip) return;

    const mediaFile = state.mediaFiles.get(firstVideoClip.sourceFileId);
    if (!mediaFile?.previewUrl) return;

    engine.loadSource(mediaFile.previewUrl).then(() => {
      engine.resizeCanvas();
    }).catch((err) => {
      console.warn('[useVideoEngine] Auto-reload failed:', err.message);
    });
  }, [hasClips, isReady]);

  const loadVideo = useCallback(async (file: File) => {
    const engine = engineRef.current;
    const store = useEditorStore.getState();
    setLoadError(null);

    try {
      const mediaFile = await store.addMediaFile(file);

      if (!Number.isFinite(mediaFile.duration) || mediaFile.duration <= 0) {
        throw new Error(`Invalid video duration: ${mediaFile.duration}`);
      }

      const clip = store.addClipFromMedia(mediaFile);

      if (mediaFile.width && mediaFile.height) {
        useEditorStore.setState((state) => ({
          project: {
            ...state.project,
            composition: {
              ...state.project.composition,
              width: mediaFile.width!,
              height: mediaFile.height!,
            },
          },
        }));
      }

      await engine.loadSource(mediaFile.previewUrl, mediaFile.id);
      engine.resizeCanvas();

      return { mediaFile, clip };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load video';
      setLoadError(message);
      console.error('[useVideoEngine] Load error:', message);
      throw error;
    }
  }, []);

  const loadVideoFromPath = useCallback(async (filePath: string) => {
    const engine = engineRef.current;
    const store = useEditorStore.getState();
    setLoadError(null);

    try {
      const fileName = filePath.split(/[/\\]/).pop() || 'video';
      const mediaFile = await store.addMediaFileFromPath(filePath, fileName);

      if (!Number.isFinite(mediaFile.duration) || mediaFile.duration <= 0) {
        throw new Error(`Invalid video duration: ${mediaFile.duration}`);
      }

      const clip = store.addClipFromMedia(mediaFile);

      if (mediaFile.width && mediaFile.height) {
        useEditorStore.setState((state) => ({
          project: {
            ...state.project,
            composition: {
              ...state.project.composition,
              width: mediaFile.width!,
              height: mediaFile.height!,
            },
          },
        }));
      }

      await engine.loadSource(mediaFile.previewUrl, mediaFile.id);
      engine.resizeCanvas();

      return { mediaFile, clip };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load video';
      setLoadError(message);
      console.error('[useVideoEngine] Load error:', message);
      throw error;
    }
  }, []);

  // Playback controls
  const play = useCallback(() => engineRef.current.play(), []);
  const pause = useCallback(() => engineRef.current.pause(), []);
  const togglePlayback = useCallback(() => engineRef.current.togglePlayback(), []);
  const seek = useCallback((time: number) => engineRef.current.seek(time), []);

  return {
    canvasRef,
    engine: engineRef.current,
    isReady,
    loadError,
    loadVideo,
    loadVideoFromPath,
    play,
    pause,
    togglePlayback,
    seek,
  };
}
