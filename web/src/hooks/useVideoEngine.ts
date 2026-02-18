"use client";

/**
 * React hook that manages the VideoEngine lifecycle.
 * Initializes the engine when a canvas ref is available,
 * and destroys it on unmount.
 *
 * Also watches for clip deletions and cleans up the engine
 * (stops audio, unloads source) when the timeline becomes empty.
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

  // Initialize engine when canvas is available
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = engineRef.current;
    engine.init(canvas);
    setIsReady(true);

    return () => {
      destroyVideoEngine();
      engineRef.current = getVideoEngine(); // get fresh instance for next mount
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

  // Load a video file (browser mode — from File object)
  const loadVideo = useCallback(async (file: File) => {
    const engine = engineRef.current;
    const store = useEditorStore.getState();
    setLoadError(null);

    try {
      const mediaFile = await store.addMediaFile(file);
      const clip = store.addClipFromMedia(mediaFile);

      if (mediaFile.width && mediaFile.height) {
        useEditorStore.setState((state) => ({
          project: {
            ...state.project,
            composition: {
              ...state.project.composition,
              width: mediaFile.width!,
              height: mediaFile.height!,
              duration: mediaFile.duration,
            },
          },
        }));
      }

      await engine.loadSource(mediaFile.previewUrl);
      engine.resizeCanvas();

      return { mediaFile, clip };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load video';
      setLoadError(message);
      console.error('[useVideoEngine] Load error:', message);
      throw error;
    }
  }, []);

  // Load a video from a native file path (Tauri desktop mode)
  const loadVideoFromPath = useCallback(async (filePath: string) => {
    const engine = engineRef.current;
    const store = useEditorStore.getState();
    setLoadError(null);

    try {
      const fileName = filePath.split(/[/\\]/).pop() || 'video';
      const mediaFile = await store.addMediaFileFromPath(filePath, fileName);
      const clip = store.addClipFromMedia(mediaFile);

      if (mediaFile.width && mediaFile.height) {
        useEditorStore.setState((state) => ({
          project: {
            ...state.project,
            composition: {
              ...state.project.composition,
              width: mediaFile.width!,
              height: mediaFile.height!,
              duration: mediaFile.duration,
            },
          },
        }));
      }

      await engine.loadSource(mediaFile.previewUrl);
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
