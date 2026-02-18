"use client";

import { useCallback, useRef, useMemo } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import type { Clip, Track } from "@/types/editor";
import { TRACK_HEIGHT } from "@/types/editor";

interface TimelineClipProps {
  clip: Clip;
  track: Track;
  pixelsPerSecond: number;
  isSelected: boolean;
  /** All snap points (time in seconds) for magnetic snapping. */
  snapPoints: number[];
  snapThresholdPx: number;
  snapEnabled: boolean;
}

const TRIM_HANDLE_WIDTH = 6;
const DRAG_THRESHOLD = 3; // px before drag starts (to distinguish from click)

const CLIP_COLORS: Record<string, { bg: string; border: string; selectedBorder: string; text: string }> = {
  video: {
    bg: "bg-blue-600/70",
    border: "border-blue-500/40",
    selectedBorder: "border-blue-400",
    text: "text-blue-100",
  },
  audio: {
    bg: "bg-green-600/70",
    border: "border-green-500/40",
    selectedBorder: "border-green-400",
    text: "text-green-100",
  },
  image: {
    bg: "bg-purple-600/70",
    border: "border-purple-500/40",
    selectedBorder: "border-purple-400",
    text: "text-purple-100",
  },
  text: {
    bg: "bg-amber-600/70",
    border: "border-amber-500/40",
    selectedBorder: "border-amber-400",
    text: "text-amber-100",
  },
};

/**
 * An individual clip on the timeline.
 * Handles selection, drag-to-move, and edge-drag-to-trim.
 */
export function TimelineClip({
  clip,
  track,
  pixelsPerSecond,
  isSelected,
  snapPoints,
  snapThresholdPx,
  snapEnabled,
}: TimelineClipProps) {
  const setSelectedClip = useEditorStore((s) => s.setSelectedClip);
  const moveClip = useEditorStore((s) => s.moveClip);
  const trimClipStart = useEditorStore((s) => s.trimClipStart);
  const trimClipEnd = useEditorStore((s) => s.trimClipEnd);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);

  const clipRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    mode: "none" | "move" | "trim-start" | "trim-end";
    startMouseX: number;
    initialTimelineStart: number;
    initialSourceStart: number;
    initialSourceEnd: number;
    hasMoved: boolean;
  } | null>(null);

  const clipDuration = clip.sourceEnd - clip.sourceStart;
  const leftPx = clip.timelineStart * pixelsPerSecond;
  const widthPx = clipDuration * pixelsPerSecond;

  const mediaFile = mediaFiles.get(clip.sourceFileId);
  const clipName = mediaFile?.name ?? "Clip";

  const colors = CLIP_COLORS[clip.type] ?? CLIP_COLORS.video;

  // ── Snap helper ──
  const snapTime = useCallback(
    (time: number, excludeClipId?: string): number => {
      if (!snapEnabled) return time;

      const thresholdSec = snapThresholdPx / pixelsPerSecond;
      let nearest = time;
      let nearestDist = Infinity;

      for (const sp of snapPoints) {
        const dist = Math.abs(time - sp);
        if (dist < thresholdSec && dist < nearestDist) {
          nearest = sp;
          nearestDist = dist;
        }
      }

      return nearest;
    },
    [snapEnabled, snapPoints, snapThresholdPx, pixelsPerSecond]
  );

  // ── Detect zone: move vs trim-start vs trim-end ──
  const getZone = useCallback(
    (e: React.MouseEvent): "trim-start" | "trim-end" | "move" => {
      if (!clipRef.current || track.locked) return "move";
      const rect = clipRef.current.getBoundingClientRect();
      const localX = e.clientX - rect.left;

      if (localX < TRIM_HANDLE_WIDTH && widthPx > TRIM_HANDLE_WIDTH * 3) return "trim-start";
      if (localX > rect.width - TRIM_HANDLE_WIDTH && widthPx > TRIM_HANDLE_WIDTH * 3)
        return "trim-end";
      return "move";
    },
    [widthPx, track.locked]
  );

  // ── Mouse down: start interaction ──
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // left click only
      e.preventDefault();
      e.stopPropagation();

      // Check for razor tool
      const activeTool = useEditorStore.getState().timeline.activeTool;
      if (activeTool === "razor") {
        // Split at click position
        const rect = clipRef.current?.getBoundingClientRect();
        if (!rect) return;
        const localX = e.clientX - rect.left;
        const splitTime = clip.timelineStart + localX / pixelsPerSecond;
        useEditorStore.getState().splitClip(clip.id, splitTime);
        return;
      }

      const zone = getZone(e);

      dragState.current = {
        mode: zone,
        startMouseX: e.clientX,
        initialTimelineStart: clip.timelineStart,
        initialSourceStart: clip.sourceStart,
        initialSourceEnd: clip.sourceEnd,
        hasMoved: false,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragState.current) return;
        const dx = moveEvent.clientX - dragState.current.startMouseX;

        // Check drag threshold
        if (!dragState.current.hasMoved && Math.abs(dx) < DRAG_THRESHOLD) return;
        dragState.current.hasMoved = true;

        const dtSeconds = dx / pixelsPerSecond;

        switch (dragState.current.mode) {
          case "move": {
            let newStart = dragState.current.initialTimelineStart + dtSeconds;
            newStart = Math.max(0, newStart);

            // Snap the left edge
            const snappedStart = snapTime(newStart, clip.id);
            // Also try snapping the right edge
            const rightEdge = newStart + clipDuration;
            const snappedRight = snapTime(rightEdge, clip.id);
            if (Math.abs(snappedRight - rightEdge) < Math.abs(snappedStart - newStart)) {
              newStart = snappedRight - clipDuration;
            } else {
              newStart = snappedStart;
            }

            moveClip(clip.id, Math.max(0, newStart));
            break;
          }
          case "trim-start": {
            const newSourceStart = dragState.current.initialSourceStart + dtSeconds;
            const newTimelineStart = dragState.current.initialTimelineStart + dtSeconds;

            // Snap timeline start
            const snappedTlStart = snapTime(Math.max(0, newTimelineStart), clip.id);
            const snapDelta = snappedTlStart - newTimelineStart;
            trimClipStart(
              clip.id,
              newSourceStart + snapDelta,
              snappedTlStart
            );
            break;
          }
          case "trim-end": {
            const newSourceEnd = dragState.current.initialSourceEnd + dtSeconds;
            // Snap the right edge
            const rightEdge = clip.timelineStart + (newSourceEnd - clip.sourceStart);
            const snappedRight = snapTime(rightEdge, clip.id);
            const snapDelta = snappedRight - rightEdge;
            trimClipEnd(clip.id, newSourceEnd + snapDelta);
            break;
          }
        }
      };

      const handleMouseUp = () => {
        if (dragState.current && !dragState.current.hasMoved) {
          // It was a click, not a drag — select
          setSelectedClip(clip.id);
        }
        dragState.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [
      clip,
      clipDuration,
      pixelsPerSecond,
      getZone,
      snapTime,
      moveClip,
      trimClipStart,
      trimClipEnd,
      setSelectedClip,
    ]
  );

  // ── Cursor changes on hover ──
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragState.current?.hasMoved) return;
      const activeTool = useEditorStore.getState().timeline.activeTool;
      if (activeTool === "razor") {
        if (clipRef.current) clipRef.current.style.cursor = "crosshair";
        return;
      }

      const zone = getZone(e);
      if (clipRef.current) {
        clipRef.current.style.cursor =
          zone === "trim-start" || zone === "trim-end" ? "col-resize" : "grab";
      }
    },
    [getZone]
  );

  // ── Duration label ──
  const durationLabel = useMemo(() => {
    const secs = clipDuration;
    if (secs < 1) return `${(secs * 1000).toFixed(0)}ms`;
    if (secs < 60) return `${secs.toFixed(1)}s`;
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [clipDuration]);

  return (
    <div
      ref={clipRef}
      className={`absolute top-1 rounded-md border overflow-hidden select-none transition-shadow ${
        colors.bg
      } ${isSelected ? colors.selectedBorder + " border-2 shadow-lg shadow-blue-500/20" : colors.border + " border"}`}
      style={{
        left: leftPx,
        width: Math.max(widthPx, 4),
        height: TRACK_HEIGHT - 8,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    >
      {/* Left trim handle */}
      <div
        className="absolute left-0 top-0 bottom-0 z-10 opacity-0 hover:opacity-100 transition-opacity"
        style={{ width: TRIM_HANDLE_WIDTH }}
      >
        <div className="w-0.5 h-full bg-white/50 mx-auto rounded-full" />
      </div>

      {/* Content area */}
      <div className="flex items-center h-full px-2 overflow-hidden">
        {/* Clip icon */}
        <div className="shrink-0 mr-1.5 opacity-70">
          {clip.type === "video" ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={colors.text}>
              <path d="M15 8v8H5V8h10m1-2H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4V7a1 1 0 00-1-1z" />
            </svg>
          ) : clip.type === "audio" ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={colors.text}>
              <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={colors.text}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          )}
        </div>

        {/* Name & duration */}
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-medium truncate ${colors.text}`}>
            {clipName}
          </p>
          {widthPx > 80 && (
            <p className={`text-[9px] opacity-60 ${colors.text}`}>
              {durationLabel}
            </p>
          )}
        </div>
      </div>

      {/* Right trim handle */}
      <div
        className="absolute right-0 top-0 bottom-0 z-10 opacity-0 hover:opacity-100 transition-opacity"
        style={{ width: TRIM_HANDLE_WIDTH }}
      >
        <div className="w-0.5 h-full bg-white/50 mx-auto rounded-full" />
      </div>
    </div>
  );
}
