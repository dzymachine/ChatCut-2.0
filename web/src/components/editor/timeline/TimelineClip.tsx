"use client";

import { useCallback, useRef, useMemo, useState } from "react";
import { useEditorStore, withUndo } from "@/lib/store/editor-store";
import { executeAction } from "@/lib/commands/command-handler";
import type { Clip, Track } from "@/types/editor";
import { TRACK_HEIGHT } from "@/types/editor";

interface TimelineClipProps {
  clip: Clip;
  track: Track;
  pixelsPerSecond: number;
  isSelected: boolean;
  isLinkedSelected: boolean;
  snapPoints: number[];
  snapThresholdPx: number;
  snapEnabled: boolean;
  allTrackIds: string[];
  trackIndex: number;
}

const TRIM_HANDLE_WIDTH = 6;
const DRAG_THRESHOLD = 3;

const CLIP_COLORS: Record<string, { bg: string; border: string; selectedBorder: string; linkedBorder: string; text: string }> = {
  video: {
    bg: "bg-blue-600/70",
    border: "border-blue-500/40",
    selectedBorder: "border-blue-400",
    linkedBorder: "border-blue-400/60",
    text: "text-blue-100",
  },
  audio: {
    bg: "bg-green-600/70",
    border: "border-green-500/40",
    selectedBorder: "border-green-400",
    linkedBorder: "border-green-400/60",
    text: "text-green-100",
  },
  image: {
    bg: "bg-purple-600/70",
    border: "border-purple-500/40",
    selectedBorder: "border-purple-400",
    linkedBorder: "border-purple-400/60",
    text: "text-purple-100",
  },
  text: {
    bg: "bg-amber-600/70",
    border: "border-amber-500/40",
    selectedBorder: "border-amber-400",
    linkedBorder: "border-amber-400/60",
    text: "text-amber-100",
  },
};

export function TimelineClip({
  clip,
  track,
  pixelsPerSecond,
  isSelected,
  isLinkedSelected,
  snapPoints,
  snapThresholdPx,
  snapEnabled,
  allTrackIds,
  trackIndex,
}: TimelineClipProps) {
  const setSelectedClip = useEditorStore((s) => s.setSelectedClip);
  const toggleClipSelection = useEditorStore((s) => s.toggleClipSelection);
  const toggleLinkForSelection = useEditorStore((s) => s.toggleLinkForSelection);
  const moveClip = useEditorStore((s) => s.moveClip);
  const trimClipStart = useEditorStore((s) => s.trimClipStart);
  const trimClipEnd = useEditorStore((s) => s.trimClipEnd);
  const unlinkClip = useEditorStore((s) => s.unlinkClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const selectedClipIds = useEditorStore((s) => s.ui.selectedClipIds);

  const clipRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    mode: "none" | "move" | "trim-start" | "trim-end";
    startMouseX: number;
    startMouseY: number;
    initialTimelineStart: number;
    initialSourceStart: number;
    initialSourceEnd: number;
    hasMoved: boolean;
    currentTargetTrackId: string | null;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const clipDuration = clip.sourceEnd - clip.sourceStart;
  const leftPx = clip.timelineStart * pixelsPerSecond;
  const widthPx = clipDuration * pixelsPerSecond;

  const mediaFile = mediaFiles.get(clip.sourceFileId);
  const clipName = mediaFile?.name ?? "Clip";

  const colors = CLIP_COLORS[clip.type] ?? CLIP_COLORS.video;

  const isLinked = !!clip.linkId;

  const snapTime = useCallback(
    (time: number, _excludeClipId?: string): number => {
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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const store = useEditorStore.getState();
      if (!store.ui.selectedClipIds.includes(clip.id)) {
        setSelectedClip(clip.id);
      }
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [clip.id, setSelectedClip]
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleUnlink = useCallback(() => {
    withUndo("Unlink clips", () => unlinkClip(clip.id));
    closeContextMenu();
  }, [clip.id, unlinkClip, closeContextMenu]);

  const handleLinkFromMenu = useCallback(() => {
    withUndo("Link clips", () => toggleLinkForSelection());
    closeContextMenu();
  }, [toggleLinkForSelection, closeContextMenu]);

  const handleDeleteFromMenu = useCallback(() => {
    withUndo("Delete clip", () => removeClip(clip.id));
    closeContextMenu();
  }, [clip.id, removeClip, closeContextMenu]);

  const handleSplitFromMenu = useCallback(() => {
    const currentTime = useEditorStore.getState().playback.currentTime;
    executeAction({ type: 'cut', clipId: clip.id, time: currentTime });
    closeContextMenu();
  }, [clip.id, closeContextMenu]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const store = useEditorStore.getState();
      if (store.ui.selectedClipIds.length >= 2) {
        withUndo("Toggle link", () => store.toggleLinkForSelection());
      }
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      setContextMenu(null);

      const shiftHeld = e.shiftKey;
      const altHeld = e.altKey;
      if (altHeld) {
        useEditorStore.getState().setLinkedSelectionEnabled(false);
      }

      const activeTool = useEditorStore.getState().timeline.activeTool;
      if (activeTool === "razor") {
        const rect = clipRef.current?.getBoundingClientRect();
        if (!rect) return;
        const localX = e.clientX - rect.left;
        const splitTime = clip.timelineStart + localX / pixelsPerSecond;
        executeAction({ type: 'cut', clipId: clip.id, time: splitTime });
        if (altHeld) useEditorStore.getState().setLinkedSelectionEnabled(true);
        return;
      }

      const zone = getZone(e);

      dragState.current = {
        mode: zone,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        initialTimelineStart: clip.timelineStart,
        initialSourceStart: clip.sourceStart,
        initialSourceEnd: clip.sourceEnd,
        currentTargetTrackId: null,
        hasMoved: false,
      };

      const batchDesc =
        zone === "move" ? "Move clip" :
        zone === "trim-start" ? "Trim clip start" :
        "Trim clip end";
      useEditorStore.getState().beginUndoBatch(batchDesc);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragState.current) return;
        const dx = moveEvent.clientX - dragState.current.startMouseX;
        const dy = moveEvent.clientY - dragState.current.startMouseY;

        if (!dragState.current.hasMoved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        dragState.current.hasMoved = true;

        const dtSeconds = dx / pixelsPerSecond;

        switch (dragState.current.mode) {
          case "move": {
            let newStart = dragState.current.initialTimelineStart + dtSeconds;
            newStart = Math.max(0, newStart);

            const snappedStart = snapTime(newStart, clip.id);
            const rightEdge = newStart + clipDuration;
            const snappedRight = snapTime(rightEdge, clip.id);
            if (Math.abs(snappedRight - rightEdge) < Math.abs(snappedStart - newStart)) {
              newStart = snappedRight - clipDuration;
            } else {
              newStart = snappedStart;
            }

            const trackOffset = Math.round(dy / TRACK_HEIGHT);
            const targetIdx = Math.max(0, Math.min(allTrackIds.length - 1, trackIndex + trackOffset));
            const targetTrackId = allTrackIds[targetIdx];

            const store = useEditorStore.getState();
            const targetTrack = store.project.tracks.find((t) => t.id === targetTrackId);
            const isCompatible = targetTrack && targetTrack.type === track.type;

            if (isCompatible && targetTrackId !== track.id) {
              dragState.current.currentTargetTrackId = targetTrackId;
              moveClip(clip.id, Math.max(0, newStart), targetTrackId);
            } else {
              dragState.current.currentTargetTrackId = null;
              moveClip(clip.id, Math.max(0, newStart));
            }
            break;
          }
          case "trim-start": {
            const newSourceStart = dragState.current.initialSourceStart + dtSeconds;
            const newTimelineStart = dragState.current.initialTimelineStart + dtSeconds;

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
            const rightEdge = clip.timelineStart + (newSourceEnd - clip.sourceStart);
            const snappedRight = snapTime(rightEdge, clip.id);
            const snapDelta = snappedRight - rightEdge;
            trimClipEnd(clip.id, newSourceEnd + snapDelta);
            break;
          }
        }
      };

      const handleMouseUp = () => {
        if (dragState.current && dragState.current.hasMoved) {
          useEditorStore.getState().commitUndoBatch();
        } else {
          useEditorStore.getState().cancelUndoBatch();
          if (dragState.current) {
            if (shiftHeld) {
              toggleClipSelection(clip.id);
            } else {
              setSelectedClip(clip.id);
            }
          }
        }
        dragState.current = null;
        if (altHeld) {
          useEditorStore.getState().setLinkedSelectionEnabled(true);
        }
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
      toggleClipSelection,
    ]
  );

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

  const durationLabel = useMemo(() => {
    const secs = clipDuration;
    if (secs < 1) return `${(secs * 1000).toFixed(0)}ms`;
    if (secs < 60) return `${secs.toFixed(1)}s`;
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [clipDuration]);

  const borderClass = isSelected
    ? `${colors.selectedBorder} border-2 shadow-lg shadow-blue-500/20`
    : isLinkedSelected
    ? `${colors.linkedBorder} border-2 shadow-md shadow-blue-500/10`
    : `${colors.border} border`;

  return (
    <>
      <div
        ref={clipRef}
        className={`absolute top-1 rounded-md border overflow-hidden select-none transition-shadow ${colors.bg} ${borderClass}`}
        style={{
          left: leftPx,
          width: Math.max(widthPx, 4),
          height: TRACK_HEIGHT - 8,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <div
          className="absolute left-0 top-0 bottom-0 z-10 opacity-0 hover:opacity-100 transition-opacity"
          style={{ width: TRIM_HANDLE_WIDTH }}
        >
          <div className="w-0.5 h-full bg-white/50 mx-auto rounded-full" />
        </div>

        <div className="flex items-center h-full px-2 overflow-hidden">
          {isLinked && widthPx > 40 && (
            <div className="shrink-0 mr-1 opacity-60" title="Linked">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={colors.text}>
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
            </div>
          )}

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

        <div
          className="absolute right-0 top-0 bottom-0 z-10 opacity-0 hover:opacity-100 transition-opacity"
          style={{ width: TRIM_HANDLE_WIDTH }}
        >
          <div className="w-0.5 h-full bg-white/50 mx-auto rounded-full" />
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="fixed inset-0" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />
          <div className="relative bg-neutral-800 border border-neutral-700 rounded-md shadow-xl py-1 min-w-[160px] text-xs">
            <button
              onClick={handleSplitFromMenu}
              className="w-full text-left px-3 py-1.5 hover:bg-neutral-700 text-neutral-200 flex items-center gap-2"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M2 12h4M18 12h4" />
              </svg>
              Split at Playhead
              <span className="ml-auto text-neutral-500 text-[10px]">&#8984;B</span>
            </button>
            <button
              onClick={handleDeleteFromMenu}
              className="w-full text-left px-3 py-1.5 hover:bg-neutral-700 text-red-400 flex items-center gap-2"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Delete
              <span className="ml-auto text-neutral-500 text-[10px]">Del</span>
            </button>
            {(isLinked || selectedClipIds.length >= 2) && (
              <>
                <div className="my-1 border-t border-neutral-700" />
                {isLinked ? (
                  <button
                    onClick={handleUnlink}
                    className="w-full text-left px-3 py-1.5 hover:bg-neutral-700 text-neutral-200 flex items-center gap-2"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                      <line x1="2" y1="2" x2="22" y2="22" strokeWidth="2" />
                    </svg>
                    Unlink
                    <span className="ml-auto text-neutral-500 text-[10px]">&#8984;L</span>
                  </button>
                ) : (
                  <button
                    onClick={handleLinkFromMenu}
                    className="w-full text-left px-3 py-1.5 hover:bg-neutral-700 text-neutral-200 flex items-center gap-2"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                    </svg>
                    Link
                    <span className="ml-auto text-neutral-500 text-[10px]">&#8984;L</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
