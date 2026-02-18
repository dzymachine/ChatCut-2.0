"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore, isVideoFile } from "@/lib/store/editor-store";
import { TRACK_HEIGHT, RULER_HEIGHT, TRACK_HEADER_WIDTH } from "@/types/editor";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimeRuler } from "./TimeRuler";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { Playhead } from "./Playhead";
import { getVideoEngine } from "@/lib/engine/video-engine";
import { showToast } from "@/components/ui/toast-notification";

/**
 * The Timeline panel — lives at the bottom of the editor.
 *
 * Features:
 *  - Resizable via top drag handle
 *  - Time ruler with click-to-scrub
 *  - Multi-track lanes with clips
 *  - Playhead overlay
 *  - Zoom controls (toolbar + scroll wheel)
 *  - Keyboard shortcuts (V, C, Delete, Cmd+B)
 */
export function Timeline() {
  const tracks = useEditorStore((s) => s.project.tracks);
  const duration = useEditorStore((s) => s.project.composition.duration);
  const pixelsPerSecond = useEditorStore((s) => s.timeline.pixelsPerSecond);
  const panelHeight = useEditorStore((s) => s.timeline.panelHeight);
  const setTimelinePanelHeight = useEditorStore((s) => s.setTimelinePanelHeight);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);
  const selectedClipId = useEditorStore((s) => s.ui.selectedClipId);
  const splitClip = useEditorStore((s) => s.splitClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const currentTime = useEditorStore((s) => s.playback.currentTime);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [visibleWidth, setVisibleWidth] = useState(800);

  // ── Derived dimensions ──
  const tracksHeight = tracks.length * TRACK_HEIGHT;

  // Add 20% padding after the last clip, or at least 5s of empty space
  const contentDuration = Math.max(duration + Math.max(duration * 0.2, 5), 10);
  const totalWidth = contentDuration * pixelsPerSecond;

  // ── Resize handle ──
  const resizeState = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeState.current = { startY: e.clientY, startHeight: panelHeight };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizeState.current) return;
        const dy = resizeState.current.startY - moveEvent.clientY; // dragging up increases height
        setTimelinePanelHeight(resizeState.current.startHeight + dy);
      };

      const handleMouseUp = () => {
        resizeState.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [panelHeight, setTimelinePanelHeight]
  );

  // ── Scroll sync ──
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setScrollLeft(scrollContainerRef.current.scrollLeft);
    }
  }, []);

  // ── Track visible width ──
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setVisibleWidth(entry.contentRect.width);
      }
    });

    observer.observe(container);
    setVisibleWidth(container.clientWidth);

    return () => observer.disconnect();
  }, []);

  // ── Mouse wheel zoom ──
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        setTimelineZoom(pixelsPerSecond * factor);
      }
    },
    [pixelsPerSecond, setTimelineZoom]
  );

  // ── Zoom to fit ──
  const handleZoomToFit = useCallback(() => {
    if (duration <= 0) return;
    const containerWidth = scrollContainerRef.current?.clientWidth ?? 800;
    // Leave some padding
    const newPPS = (containerWidth - 40) / Math.max(duration, 0.1);
    setTimelineZoom(newPPS);
    // Scroll to start
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [duration, setTimelineZoom]);

  // ── Keyboard shortcuts (timeline-specific) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "v":
        case "V":
          setActiveTool("select");
          break;
        case "c":
        case "C":
          if (!e.metaKey && !e.ctrlKey) {
            setActiveTool("razor");
          }
          break;
        case "b":
        case "B":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (selectedClipId) {
              splitClip(selectedClipId, currentTime);
            }
          }
          break;
        case "Delete":
        case "Backspace":
          if (selectedClipId && !e.metaKey && !e.ctrlKey) {
            removeClip(selectedClipId);
          }
          break;
        case "=":
        case "+":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setTimelineZoom(pixelsPerSecond * 1.3);
          }
          break;
        case "-":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setTimelineZoom(pixelsPerSecond / 1.3);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedClipId,
    currentTime,
    pixelsPerSecond,
    splitClip,
    removeClip,
    setActiveTool,
    setTimelineZoom,
  ]);

  // ── Auto-follow playhead ──
  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  useEffect(() => {
    if (!isPlaying || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const playheadPx = currentTime * pixelsPerSecond;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;

    // If playhead goes offscreen to the right, scroll to follow
    if (playheadPx > viewRight - 60) {
      container.scrollLeft = playheadPx - container.clientWidth * 0.3;
    }
  }, [currentTime, pixelsPerSecond, isPlaying]);

  // ── Empty state ──
  const hasClips = useMemo(
    () => tracks.some((t) => t.clips.length > 0),
    [tracks]
  );

  // ── Drag & Drop onto timeline ──
  const [isTimelineDragOver, setIsTimelineDragOver] = useState(false);

  const handleTimelineDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
      const videoFile = files.find((f) => isVideoFile(f));
      if (!videoFile) return;

      // Calculate drop position in timeline seconds
      const scrollContainer = scrollContainerRef.current;
      const containerRect = scrollContainer?.getBoundingClientRect();
      let dropTime = 0;
      if (containerRect && scrollContainer) {
        const xInContainer = e.clientX - containerRect.left + scrollContainer.scrollLeft;
        dropTime = Math.max(0, xInContainer / pixelsPerSecond);
      }

      try {
        const store = useEditorStore.getState();
        const mediaFile = await store.addMediaFile(videoFile);
        store.addClipFromMedia(mediaFile, undefined, dropTime);

        // Update composition dimensions if available
        if (mediaFile.width && mediaFile.height) {
          useEditorStore.setState((state) => ({
            project: {
              ...state.project,
              composition: {
                ...state.project.composition,
                width: mediaFile.width!,
                height: mediaFile.height!,
                duration: Math.max(state.project.composition.duration, mediaFile.duration),
              },
            },
          }));
        }

        // Load the source into the engine for preview
        const engine = getVideoEngine();
        await engine.loadSource(mediaFile.previewUrl);
        engine.resizeCanvas();

        showToast("success", "Video added to timeline");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load video";
        console.error("[Timeline] Drop error:", msg);
        showToast("error", msg);
      }
    },
    [pixelsPerSecond]
  );

  return (
    <div
      className="flex flex-col bg-neutral-950 border-t border-neutral-700 select-none"
      style={{ height: panelHeight }}
    >
      {/* ─── Resize Handle ─── */}
      <div
        className="h-1 cursor-row-resize bg-neutral-800 hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors shrink-0"
        onMouseDown={handleResizeStart}
      />

      {/* ─── Toolbar ─── */}
      <TimelineToolbar onZoomToFit={handleZoomToFit} />

      {/* ─── Timeline Body ─── */}
      <div className="flex flex-1 min-h-0 overflow-hidden" onWheel={handleWheel}>
        {/* ── Track Headers (fixed left) ── */}
        <div
          className="flex flex-col bg-neutral-900 border-r border-neutral-800 shrink-0 overflow-hidden"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          {/* Ruler spacer */}
          <div
            className="shrink-0 border-b border-neutral-700 bg-neutral-900 flex items-end px-2 pb-0.5"
            style={{ height: RULER_HEIGHT }}
          >
            <span className="text-[9px] text-neutral-600 font-mono">
              {tracks.length} tracks
            </span>
          </div>

          {/* Track headers */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {tracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
          </div>
        </div>

        {/* ── Scrollable Timeline Content ── */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto overflow-y-auto"
          onScroll={handleScroll}
          onDragOver={handleTimelineDragOver}
          onDragLeave={handleTimelineDragLeave}
          onDrop={handleTimelineDrop}
        >
          <div className="relative" style={{ width: totalWidth, minWidth: "100%" }}>
            {/* Time Ruler (sticky top) */}
            <div className="sticky top-0 z-20">
              <TimeRuler
                pixelsPerSecond={pixelsPerSecond}
                duration={contentDuration}
                totalWidth={totalWidth}
                visibleWidth={visibleWidth}
                scrollLeft={scrollLeft}
              />
            </div>

            {/* Tracks area */}
            <div className="relative">
              {tracks.map((track, index) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  pixelsPerSecond={pixelsPerSecond}
                  totalWidth={totalWidth}
                  index={index}
                />
              ))}

              {/* Drop overlay */}
              {isTimelineDragOver && (
                <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-400/50 flex items-center justify-center z-30 rounded pointer-events-none">
                  <span className="text-blue-300 text-xs font-medium bg-neutral-900/80 px-3 py-1.5 rounded">
                    Drop video here
                  </span>
                </div>
              )}

              {/* Empty state */}
              {!hasClips && !isTimelineDragOver && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-neutral-600 text-xs">
                    Drop a video to see clips on the timeline
                  </p>
                </div>
              )}
            </div>

            {/* Playhead (spans ruler + tracks) */}
            <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ height: RULER_HEIGHT + tracksHeight }}>
              <Playhead
                pixelsPerSecond={pixelsPerSecond}
                tracksHeight={tracksHeight}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
