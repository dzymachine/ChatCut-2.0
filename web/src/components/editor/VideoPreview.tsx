"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVideoEngine } from "@/hooks/useVideoEngine";
import { useEditorStore, isVideoFile } from "@/lib/store/editor-store";
import { TransportControls } from "./TransportControls";
import { isTauri, openVideoFileDialog } from "@/lib/tauri/bridge";
import { showToast } from "@/components/ui/toast-notification";

interface VideoPreviewProps {
  onEngineReady?: () => void;
}

function getFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).mozFullScreenElement ||
    (document as any).msFullscreenElement ||
    null
  );
}

async function requestFullscreen(element: HTMLElement) {
  if (element.requestFullscreen) {
    await element.requestFullscreen();
  } else if ((element as any).webkitRequestFullscreen) {
    await (element as any).webkitRequestFullscreen();
  } else if ((element as any).webkitEnterFullscreen) {
    await (element as any).webkitEnterFullscreen();
  } else {
    throw new Error("Fullscreen API is not supported by this browser.");
  }
}

async function exitFullscreen() {
  if (document.exitFullscreen) {
    await document.exitFullscreen();
  } else if ((document as any).webkitExitFullscreen) {
    await (document as any).webkitExitFullscreen();
  } else if ((document as any).webkitCancelFullScreen) {
    await (document as any).webkitCancelFullScreen();
  } else {
    throw new Error("Fullscreen API is not supported by this browser.");
  }
}

export function VideoPreview({ onEngineReady }: VideoPreviewProps) {
  const { canvasRef, isReady, loadError, loadVideo, loadVideoFromPath, togglePlayback, seek } = useVideoEngine();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const hasClip = useEditorStore((s) => s.project.tracks.some((t) => t.clips.length > 0));

  useEffect(() => {
    if (isReady && onEngineReady) {
      onEngineReady();
    }
  }, [isReady, onEngineReady]);

  const synchronizeFullscreen = useCallback(() => {
    setIsFullscreen(Boolean(getFullscreenElement()) || isPseudoFullscreen);
  }, [isPseudoFullscreen]);

  useEffect(() => {
    window.addEventListener("fullscreenchange", synchronizeFullscreen);
    window.addEventListener("webkitfullscreenchange", synchronizeFullscreen);
    window.addEventListener("mozfullscreenchange", synchronizeFullscreen);
    window.addEventListener("MSFullscreenChange", synchronizeFullscreen);

    return () => {
      window.removeEventListener("fullscreenchange", synchronizeFullscreen);
      window.removeEventListener("webkitfullscreenchange", synchronizeFullscreen);
      window.removeEventListener("mozfullscreenchange", synchronizeFullscreen);
      window.removeEventListener("MSFullscreenChange", synchronizeFullscreen);
    };
  }, [synchronizeFullscreen]);

  useEffect(() => {
    if (!isPseudoFullscreen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isPseudoFullscreen]);

  const supportsNativeFullscreen = (element: HTMLElement) => {
    return Boolean(
      element.requestFullscreen ||
      (element as any).webkitRequestFullscreen ||
      (element as any).mozRequestFullScreen ||
      (element as any).msRequestFullscreen
    );
  };

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;

    if (isTauri()) {
      try {
        const windowModule = await import("@tauri-apps/api/window");
        const windowExports = (windowModule as any).default ?? windowModule;
        const appWindow = windowExports.getCurrent?.() ?? windowExports.appWindow ?? (windowExports.default as any)?.appWindow ?? (window as any).appWindow;

        if (appWindow && typeof appWindow.isFullscreen === "function" && typeof appWindow.setFullscreen === "function") {
          const currentlyFullscreen = await appWindow.isFullscreen();
          await appWindow.setFullscreen(!currentlyFullscreen);
          setIsFullscreen(!currentlyFullscreen);
          setIsPseudoFullscreen(false);
          return;
        }

        console.warn("Tauri window API unavailable; falling back to browser fullscreen.");
      } catch (tauriError) {
        console.warn("Tauri fullscreen fallback failed", tauriError);
      }
    }

    try {
      let nextFullscreen = false;

      if (getFullscreenElement()) {
        await exitFullscreen();
        setIsPseudoFullscreen(false);
        nextFullscreen = false;
      } else if (isPseudoFullscreen) {
        setIsPseudoFullscreen(false);
        nextFullscreen = false;
      } else if (supportsNativeFullscreen(containerRef.current)) {
        await requestFullscreen(containerRef.current);
        nextFullscreen = Boolean(getFullscreenElement());
        setIsPseudoFullscreen(false);
      } else {
        setIsPseudoFullscreen(true);
        nextFullscreen = true;
      }

      setIsFullscreen(nextFullscreen);
    } catch (error) {
      console.error("Fullscreen toggle failed", error);
      setIsPseudoFullscreen(true);
      setIsFullscreen(true);
      showToast("error", "Fullscreen is not supported natively in this browser. Using expanded preview instead.");
    }
  }, [isPseudoFullscreen]);

  // ── Tauri Drag & Drop Events ──
  useEffect(() => {
    if (!isTauri()) return;

    let unlisteners: (() => void)[] = [];

    const setupListeners = async () => {
      // Note: Video preview drop handling is now done by the Timeline component
      // to avoid duplicate clip creation. The timeline provides better control
      // over clip placement (time and track positioning).
    };

    setupListeners();

    return () => {
      unlisteners.forEach(unlisten => unlisten());
    };
  }, [loadVideoFromPath]);

  // ── Web Drag & Drop ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
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

      let files = Array.from(e.dataTransfer.files);
      if (files.length === 0 && e.dataTransfer.items) {
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const item = e.dataTransfer.items[i];
          if (item.kind === 'file') {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }
      const videoFile = files.find((f) => isVideoFile(f));
      if (!videoFile) return;

      setIsLoading(true);
      try {
        await loadVideo(videoFile as File);
        showToast("success", "Video loaded successfully");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load video";
        console.error("[VideoPreview] Drop load error:", msg);
        showToast("error", msg);
      } finally {
        setIsLoading(false);
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
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "Escape":
          if (isPseudoFullscreen || getFullscreenElement()) {
            e.preventDefault();
            toggleFullscreen();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlayback, seek, toggleFullscreen, isPseudoFullscreen]);

  return (
    <div className="flex flex-col h-full">
      {/* Video Canvas Container */}
      <div
        ref={containerRef}
        className="relative flex-1 flex items-center justify-center bg-neutral-950 overflow-hidden"
        style={isPseudoFullscreen ? {
          position: "fixed",
          inset: 0,
          zIndex: 50,
          width: "100vw",
          height: "100vh",
          backgroundColor: "#050505",
        } : undefined}
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
                  Drop videos on the timeline below
                </p>
                <p className="text-neutral-500 text-sm mt-1">
                  Or click to browse files
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
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
      />
    </div>
  );
}
