"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { useEditorStore, isVideoFile } from "@/lib/store/editor-store";
import { isTauri } from "@/lib/tauri/bridge";
import type { MediaFile } from "@/types/editor";
import { getVideoEngine } from "@/lib/engine/video-engine";
import { showToast } from "@/components/ui/toast-notification";

const VIDEO_EXTENSIONS = ["mp4", "mov", "avi", "mkv", "webm", "m4v", "ogv", "ogg", "ts", "mts"];

/**
 * Media drag-and-drop onto the timeline — both the Tauri native drop events
 * (desktop: OS file paths) and the HTML5 DataTransfer path (browser mode).
 * Owns the drag-over highlight state.
 */
export function useTimelineDrop(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  pixelsPerSecond: number,
) {
  const [isTimelineDragOver, setIsTimelineDragOver] = useState(false);

  // ── Tauri native drag & drop ──
  useEffect(() => {
    if (!isTauri()) return;

    // If the component unmounts while the async listener setup is still in
    // flight, later-resolved listeners would leak — the cancelled flag makes
    // the cleanup race-safe.
    let cancelled = false;
    const unlisteners: (() => void)[] = [];
    const register = (unlisten: () => void) => {
      if (cancelled) {
        unlisten();
      } else {
        unlisteners.push(unlisten);
      }
    };

    const setupListeners = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      register(
        await listen("tauri://drag-drop-hover", () => {
          setIsTimelineDragOver(true);
        }),
      );

      register(
        await listen("tauri://drag-drop-cancelled", () => {
          setIsTimelineDragOver(false);
        }),
      );

      register(
        await listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
          setIsTimelineDragOver(false);

          const paths = event.payload?.paths;
          if (!paths || paths.length === 0) return;

          const videoPath = paths.find((path) => {
            const ext = path.toLowerCase().split(".").pop();
            return VIDEO_EXTENSIONS.includes(ext || "");
          });
          if (!videoPath) return;

          const store = useEditorStore.getState();
          // Native drop events carry no cursor position — drop at the playhead.
          const dropTime = store.playback.currentTime;

          try {
            const fileName = videoPath.split(/[/\\]/).pop() || "video";
            const mediaFile = await store.addMediaFileFromPath(videoPath, fileName);

            // Prefer the first video track with free space at the drop time.
            const videoTracks = store.project.tracks.filter((t) => t.type === "video");
            let targetTrackId: string | undefined;
            for (const track of videoTracks) {
              const hasOverlap = track.clips.some((clip) => {
                const clipEnd = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
                return dropTime < clipEnd && dropTime + mediaFile.duration > clip.timelineStart;
              });
              if (!hasOverlap) {
                targetTrackId = track.id;
                break;
              }
            }
            if (!targetTrackId) {
              targetTrackId = videoTracks[0]?.id;
            }

            store.addClipFromMedia(mediaFile, targetTrackId, dropTime);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to load video";
            console.error("[Timeline] Tauri drop error:", msg);
            showToast("error", msg);
          }
        }),
      );
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  // ── HTML5 drag & drop (browser mode) ──
  const handleTimelineDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setIsTimelineDragOver(true);
  }, []);

  const handleTimelineDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsTimelineDragOver(false);
  }, []);

  const handleTimelineDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsTimelineDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      // some webviews (Tauri on macOS) may not populate `files` directly but
      // the items list still contains a File. use items as a fallback.
      if (files.length === 0 && e.dataTransfer.items) {
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const item = e.dataTransfer.items[i];
          if (item.kind === "file") {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }
      const store = useEditorStore.getState();

      const videoFile = files.find((f) => isVideoFile(f));
      if (!videoFile) return;

      const scrollContainer = scrollContainerRef.current;
      const containerRect = scrollContainer?.getBoundingClientRect();
      let dropTime = 0;
      if (containerRect && scrollContainer) {
        const xInContainer = e.clientX - containerRect.left + scrollContainer.scrollLeft;
        dropTime = Math.max(0, xInContainer / pixelsPerSecond);
      }

      let mediaFile: MediaFile;
      try {
        // addMediaFile is path-aware: routes to addMediaFileFromPath when
        // running on desktop with a native path.
        mediaFile = await store.addMediaFile(videoFile);
        store.addClipFromMedia(mediaFile, undefined, dropTime);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load video";
        console.error("[Timeline] Drop error:", msg);
        showToast("error", msg);
        return;
      }

      try {
        const engine = getVideoEngine();
        await engine.loadSource(mediaFile.previewUrl);
        engine.resizeCanvas();
        showToast("success", "Video added to timeline");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load video";
        console.error("[Timeline] Drop error (engine):", msg);
        showToast("error", msg);
      }
    },
    [pixelsPerSecond, scrollContainerRef],
  );

  return {
    isTimelineDragOver,
    handleTimelineDragOver,
    handleTimelineDragLeave,
    handleTimelineDrop,
  };
}
