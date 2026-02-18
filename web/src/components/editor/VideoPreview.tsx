"use client";

import { useCallback, useEffect, useState } from "react";
import { useVideoEngine } from "@/hooks/useVideoEngine";
import { useEditorStore, isVideoFile } from "@/lib/store/editor-store";
import { TransportControls } from "./TransportControls";
import { isTauri, openVideoFileDialog } from "@/lib/tauri/bridge";
import { showToast } from "@/components/ui/toast-notification";

interface VideoPreviewProps {
  onEngineReady?: () => void;
}

export function VideoPreview({ onEngineReady }: VideoPreviewProps) {
  const { canvasRef, isReady, loadError, loadVideo, loadVideoFromPath, togglePlayback, seek } = useVideoEngine();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const hasClip = useEditorStore((s) => s.project.tracks.some((t) => t.clips.length > 0));

  useEffect(() => {
    if (isReady && onEngineReady) {
      onEngineReady();
    }
  }, [isReady, onEngineReady]);

  // ── Drag & Drop ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      const videoFile = files.find((f) => isVideoFile(f));

      if (videoFile) {
        setIsLoading(true);
        try {
          await loadVideo(videoFile);
          showToast("success", "Video loaded successfully");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to load video";
          console.error("[VideoPreview] Drop load error:", msg);
          showToast("error", msg);
        } finally {
          setIsLoading(false);
        }
      }
    },
    [loadVideo]
  );

  // ── File Picker ──
  const handleFileSelect = useCallback(async () => {
    // Use native Tauri file dialog when available — stores native path for export
    if (isTauri()) {
      try {
        const filePath = await openVideoFileDialog();
        if (!filePath) return; // user cancelled

        setIsLoading(true);
        await loadVideoFromPath(filePath);
        showToast("success", "Video loaded successfully");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load video";
        console.error("[VideoPreview] Tauri load error:", msg);
        showToast("error", msg);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Browser fallback — standard file input
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setIsLoading(true);
        try {
          await loadVideo(file);
          showToast("success", "Video loaded successfully");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to load video";
          console.error("[VideoPreview] Browser load error:", msg);
          showToast("error", msg);
        } finally {
          setIsLoading(false);
        }
      }
    };
    input.click();
  }, [loadVideo, loadVideoFromPath]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlayback();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(useEditorStore.getState().playback.currentTime - 0.5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(useEditorStore.getState().playback.currentTime + 0.5);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlayback, seek]);

  return (
    <div className="flex flex-col h-full">
      {/* Video Canvas Container */}
      <div
        className="relative flex-1 flex items-center justify-center bg-neutral-950 overflow-hidden"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
          style={{ imageRendering: "auto" }}
        />

        {/* Drop overlay */}
        {isDragOver && (
          <div className="absolute inset-0 bg-blue-500/20 border-2 border-dashed border-blue-400 flex items-center justify-center z-10 rounded-lg m-2">
            <div className="text-blue-300 text-lg font-medium">
              Drop video here
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/80 z-10">
            <div className="flex flex-col items-center gap-3">
              <svg
                className="animate-spin h-8 w-8 text-blue-400"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
              </svg>
              <p className="text-neutral-400 text-sm">Loading video...</p>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {loadError && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 p-6 rounded-xl bg-red-950/30 border border-red-900/50 max-w-sm text-center">
              <p className="text-red-300 text-sm font-medium">Failed to load video</p>
              <p className="text-red-400/70 text-xs">{loadError}</p>
              <button
                onClick={handleFileSelect}
                className="mt-2 px-4 py-1.5 rounded-md bg-neutral-800 text-neutral-300 text-xs hover:bg-neutral-700 transition-colors"
              >
                Try another file
              </button>
            </div>
          </div>
        )}

        {/* Empty state overlay */}
        {!hasClip && !isDragOver && !isLoading && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={handleFileSelect}
              className="flex flex-col items-center gap-4 p-8 rounded-xl border border-neutral-800 bg-neutral-900/50 hover:bg-neutral-800/50 hover:border-neutral-700 transition-all cursor-pointer group"
            >
              <div className="w-16 h-16 rounded-full bg-neutral-800 group-hover:bg-neutral-700 flex items-center justify-center transition-colors">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-neutral-400"
                >
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-neutral-300 font-medium">
                  Drop a video or click to browse
                </p>
                <p className="text-neutral-500 text-sm mt-1">
                  MP4, WebM, MOV supported
                </p>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Transport Controls */}
      <TransportControls
        onTogglePlayback={togglePlayback}
        onSeek={seek}
      />
    </div>
  );
}
