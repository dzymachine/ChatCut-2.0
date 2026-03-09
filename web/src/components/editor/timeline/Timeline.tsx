"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore, isVideoFile, withUndo } from "@/lib/store/editor-store";
import { executeAction } from "@/lib/commands/command-handler";
import { TRACK_HEIGHT, RULER_HEIGHT, TRACK_HEADER_WIDTH } from "@/types/editor";
import type { Track } from "@/types/editor";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimeRuler } from "./TimeRuler";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { Playhead } from "./Playhead";
import { getVideoEngine } from "@/lib/engine/video-engine";
import { showToast } from "@/components/ui/toast-notification";

const TRACK_DIVIDER_HEIGHT = 4;

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
  const selectedClipIds = useEditorStore((s) => s.ui.selectedClipIds);
  const removeClip = useEditorStore((s) => s.removeClip);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const currentTime = useEditorStore((s) => s.playback.currentTime);

  const toggleLinkForSelection = useEditorStore((s) => s.toggleLinkForSelection);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [visibleWidth, setVisibleWidth] = useState(800);

  const videoTracks = useMemo(() => tracks.filter((t) => t.type === 'video'), [tracks]);
  const audioTracks = useMemo(() => tracks.filter((t) => t.type === 'audio'), [tracks]);
  const hasBothTypes = videoTracks.length > 0 && audioTracks.length > 0;

  const allTrackIds = useMemo(
    () => [...videoTracks, ...audioTracks].map((t) => t.id),
    [videoTracks, audioTracks]
  );

  const dividerHeight = hasBothTypes ? TRACK_DIVIDER_HEIGHT : 0;
  const tracksHeight = tracks.length * TRACK_HEIGHT + dividerHeight;

  const contentDuration = Math.max(duration + Math.max(duration * 0.2, 5), 10);
  const totalWidth = contentDuration * pixelsPerSecond;

  const resizeState = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeState.current = { startY: e.clientY, startHeight: panelHeight };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizeState.current) return;
        const dy = resizeState.current.startY - moveEvent.clientY;
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

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setScrollLeft(scrollContainerRef.current.scrollLeft);
    }
  }, []);

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

  const handleZoomToFit = useCallback(() => {
    if (duration <= 0) return;
    const containerWidth = scrollContainerRef.current?.clientWidth ?? 800;
    const newPPS = (containerWidth - 40) / Math.max(duration, 0.1);
    setTimelineZoom(newPPS);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [duration, setTimelineZoom]);

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
            for (const clipId of selectedClipIds) {
              executeAction({ type: 'cut', clipId, time: currentTime });
            }
          }
          break;
        case "Delete":
        case "Backspace":
          if (selectedClipIds.length > 0 && !e.metaKey && !e.ctrlKey) {
            withUndo("Delete clips", () => {
              for (const clipId of [...selectedClipIds]) {
                removeClip(clipId);
              }
            });
          }
          break;
        case "l":
        case "L":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (selectedClipIds.length > 0) {
              withUndo("Toggle link", () => toggleLinkForSelection());
            }
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
    selectedClipIds,
    currentTime,
    pixelsPerSecond,
    removeClip,
    toggleLinkForSelection,
    setActiveTool,
    setTimelineZoom,
  ]);

  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  useEffect(() => {
    if (!isPlaying || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const playheadPx = currentTime * pixelsPerSecond;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;

    if (playheadPx > viewRight - 60) {
      container.scrollLeft = playheadPx - container.clientWidth * 0.3;
    }
  }, [currentTime, pixelsPerSecond, isPlaying]);

  const hasClips = useMemo(
    () => tracks.some((t) => t.clips.length > 0),
    [tracks]
  );

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
      <div
        className="h-1 cursor-row-resize bg-neutral-800 hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors shrink-0"
        onMouseDown={handleResizeStart}
      />

      <TimelineToolbar onZoomToFit={handleZoomToFit} />

      <div className="flex flex-1 min-h-0 overflow-hidden" onWheel={handleWheel}>
        <div
          className="flex flex-col bg-neutral-900 border-r border-neutral-800 shrink-0 overflow-hidden"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          <div
            className="shrink-0 border-b border-neutral-700 bg-neutral-900 flex items-end px-2 pb-0.5"
            style={{ height: RULER_HEIGHT }}
          >
            <span className="text-[9px] text-neutral-600 font-mono">
              {videoTracks.length > 0 && `V${videoTracks.length}`}
              {videoTracks.length > 0 && audioTracks.length > 0 && ' '}
              {audioTracks.length > 0 && `A${audioTracks.length}`}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {videoTracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
            {hasBothTypes && (
              <div
                className="bg-neutral-700/60 shrink-0"
                style={{ height: TRACK_DIVIDER_HEIGHT }}
              />
            )}
            {audioTracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto overflow-y-auto"
          onScroll={handleScroll}
          onDragOver={handleTimelineDragOver}
          onDragLeave={handleTimelineDragLeave}
          onDrop={handleTimelineDrop}
        >
          <div className="relative" style={{ width: totalWidth, minWidth: "100%" }}>
            <div className="sticky top-0 z-20">
              <TimeRuler
                pixelsPerSecond={pixelsPerSecond}
                duration={contentDuration}
                totalWidth={totalWidth}
                visibleWidth={visibleWidth}
                scrollLeft={scrollLeft}
              />
            </div>

            <div className="relative">
              {videoTracks.map((track, index) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  pixelsPerSecond={pixelsPerSecond}
                  totalWidth={totalWidth}
                  index={index}
                  allTrackIds={allTrackIds}
                />
              ))}
              {hasBothTypes && (
                <div
                  className="bg-neutral-700/60"
                  style={{ height: TRACK_DIVIDER_HEIGHT, width: totalWidth, minWidth: "100%" }}
                />
              )}
              {audioTracks.map((track, index) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  pixelsPerSecond={pixelsPerSecond}
                  totalWidth={totalWidth}
                  index={videoTracks.length + index}
                  allTrackIds={allTrackIds}
                />
              ))}

              {isTimelineDragOver && (
                <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-400/50 flex items-center justify-center z-30 rounded pointer-events-none">
                  <span className="text-blue-300 text-xs font-medium bg-neutral-900/80 px-3 py-1.5 rounded">
                    Drop video here
                  </span>
                </div>
              )}

              {!hasClips && !isTimelineDragOver && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-neutral-600 text-xs">
                    Drop a video to see clips on the timeline
                  </p>
                </div>
              )}
            </div>

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
