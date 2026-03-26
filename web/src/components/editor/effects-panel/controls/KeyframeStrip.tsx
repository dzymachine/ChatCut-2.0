"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { useShallow } from "zustand/react/shallow";
import type { EffectKeyframe } from "@/types/effects";

const EMPTY_KF: EffectKeyframe[] = [];

interface KeyframeStripProps {
  clipId: string;
  effectId: string;
  parameterId: string;
  clipDuration: number;
  currentValue: number;
}

export function KeyframeStrip({
  clipId,
  effectId,
  parameterId,
  clipDuration,
  currentValue,
}: KeyframeStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  const keyframes = useEditorStore(
    useShallow((s) => {
      for (const track of s.project.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          const effect = clip.effects.find((e) => e.id === effectId);
          if (effect) {
            const filtered = effect.keyframes.filter((k) => k.parameterId === parameterId);
            return filtered.length > 0 ? filtered : EMPTY_KF;
          }
        }
      }
      return EMPTY_KF;
    })
  );
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const clipTimelineStart = useEditorStore((s) => {
    for (const track of s.project.tracks) {
      const c = track.clips.find((cl) => cl.id === clipId);
      if (c) return c.timelineStart;
    }
    return 0;
  });
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe);
  const updateKeyframe = useEditorStore((s) => s.updateKeyframe);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);

  const [dragging, setDragging] = useState<{
    keyframeId: string;
    startX: number;
    startTime: number;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    keyframe: EffectKeyframe;
  } | null>(null);

  if (keyframes.length === 0) return null;

  const playheadTime = currentTime - clipTimelineStart;
  const safeDuration = clipDuration > 0 ? clipDuration : 1;

  const getTimeFromMouseX = (clientX: number): number => {
    const rect = stripRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * safeDuration;
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const time = getTimeFromMouseX(e.clientX);
    addKeyframe(clipId, effectId, parameterId, time, currentValue);
  };

  const handleDiamondMouseDown = (
    e: React.MouseEvent,
    kf: EffectKeyframe
  ) => {
    e.stopPropagation();
    if (e.button === 2) return;
    setDragging({ keyframeId: kf.id, startX: e.clientX, startTime: kf.time });
  };

  const handleDiamondClick = (e: React.MouseEvent, kf: EffectKeyframe) => {
    e.stopPropagation();
    setCurrentTime(clipTimelineStart + kf.time);
  };

  const handleContextMenu = (e: React.MouseEvent, kf: EffectKeyframe) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, keyframe: kf });
  };

  const handleDeleteKeyframe = () => {
    if (contextMenu) {
      removeKeyframe(clipId, effectId, contextMenu.keyframe.id);
      setContextMenu(null);
    }
  };

  const isAtPlayhead = (kf: EffectKeyframe) =>
    Math.abs(kf.time - playheadTime) < 0.01;

  return (
    <>
      <DragHandler
        dragging={dragging}
        setDragging={setDragging}
        stripRef={stripRef}
        safeDuration={safeDuration}
        clipId={clipId}
        effectId={effectId}
        updateKeyframe={updateKeyframe}
      />
      {contextMenu && (
        <ContextMenuDismiss
          onDismiss={() => setContextMenu(null)}
        />
      )}
      <div
        ref={stripRef}
        className="relative h-2 w-full bg-neutral-800/40 rounded-sm mt-0.5 cursor-crosshair"
        onDoubleClick={handleDoubleClick}
      >
        {/* Playhead line */}
        {playheadTime >= 0 && playheadTime <= safeDuration && (
          <div
            className="absolute top-0 w-px h-full bg-amber-500/60 pointer-events-none"
            style={{ left: `${(playheadTime / safeDuration) * 100}%` }}
          />
        )}

        {/* Keyframe diamonds */}
        {keyframes.map((kf) => (
          <div
            key={kf.id}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rotate-45 cursor-pointer transition-colors ${
              isAtPlayhead(kf)
                ? "bg-amber-300 shadow-[0_0_4px_rgba(251,191,36,0.5)]"
                : "bg-amber-400 hover:bg-amber-300"
            }`}
            style={{ left: `${(kf.time / safeDuration) * 100}%` }}
            onClick={(e) => handleDiamondClick(e, kf)}
            onMouseDown={(e) => handleDiamondMouseDown(e, kf)}
            onContextMenu={(e) => handleContextMenu(e, kf)}
          />
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed bg-neutral-800 border border-neutral-700 rounded-md shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div
            className="px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 cursor-pointer"
            onClick={handleDeleteKeyframe}
          >
            Delete Keyframe
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Handles global mouse events for keyframe dragging.
 * Extracted to keep the main component body clean and avoid
 * attaching/detaching listeners on every render.
 */
function DragHandler({
  dragging,
  setDragging,
  stripRef,
  safeDuration,
  clipId,
  effectId,
  updateKeyframe,
}: {
  dragging: { keyframeId: string; startX: number; startTime: number } | null;
  setDragging: (d: null) => void;
  stripRef: React.RefObject<HTMLDivElement | null>;
  safeDuration: number;
  clipId: string;
  effectId: string;
  updateKeyframe: (
    clipId: string,
    effectId: string,
    keyframeId: string,
    updates: Partial<Pick<EffectKeyframe, "time" | "value" | "interpolation" | "bezierHandles">>
  ) => void;
}) {
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!stripRef.current) return;
      const rect = stripRef.current.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      const newTime = ratio * safeDuration;
      updateKeyframe(clipId, effectId, dragging.keyframeId, {
        time: Math.max(0, Math.min(safeDuration, newTime)),
      });
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, setDragging, stripRef, safeDuration, clipId, effectId, updateKeyframe]);

  return null;
}

/**
 * Invisible overlay + keyboard listener that dismisses the context menu
 * when clicking outside or pressing Escape.
 */
function ContextMenuDismiss({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  return (
    <div className="fixed inset-0 z-40" onClick={onDismiss} />
  );
}
