"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useEditorStore } from "@/lib/store/editor-store";

interface TransformHandlesProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

type DragMode = "move" | "scale" | "rotate" | null;

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  originalPositionX: number;
  originalPositionY: number;
  originalScale: number;
  originalRotation: number;
  centerX: number;
  centerY: number;
  originalDistance: number;
}

export function TransformHandles({ canvasRef }: TransformHandlesProps) {
  const selectedClipIds = useEditorStore((s) => s.ui.selectedClipIds);
  const activePanel = useEditorStore((s) => s.ui.activePanel);
  const getClipById = useEditorStore((s) => s.getClipById);
  const updateTransform = useEditorStore((s) => s.updateTransform);

  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [, forceRender] = useState(0);

  const lastRectRef = useRef<{ w: number; h: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const update = () => {
      const rect = canvas.getBoundingClientRect();
      const prev = lastRectRef.current;
      if (prev && prev.w === rect.width && prev.h === rect.height && prev.x === rect.x && prev.y === rect.y) return;
      lastRectRef.current = { w: rect.width, h: rect.height, x: rect.x, y: rect.y };
      setCanvasRect(rect);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    window.addEventListener("scroll", update, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
    };
  }, [canvasRef]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !drag.mode) return;

      const canvas = canvasRef.current;
      if (!canvas || !canvasRect) return;

      const scaleX = canvasRect.width / canvas.width;
      const scaleY = canvasRect.height / canvas.height;
      const clipId = selectedClipIds[0];
      if (!clipId) return;

      if (drag.mode === "move") {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        updateTransform(clipId, {
          positionX: drag.originalPositionX + dx / scaleX,
          positionY: drag.originalPositionY + dy / scaleY,
        });
      } else if (drag.mode === "scale") {
        const dx = e.clientX - drag.centerX;
        const dy = e.clientY - drag.centerY;
        const newDist = Math.sqrt(dx * dx + dy * dy);
        const scaleFactor = newDist / drag.originalDistance;
        updateTransform(clipId, {
          scale: Math.max(0.05, drag.originalScale * scaleFactor),
        });
      } else if (drag.mode === "rotate") {
        const dx = e.clientX - drag.centerX;
        const dy = e.clientY - drag.centerY;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
        updateTransform(clipId, { rotation: angle });
      }

      forceRender((n) => n + 1);
    },
    [canvasRef, canvasRect, selectedClipIds, updateTransform]
  );

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Visibility checks
  if (activePanel !== "effects") return null;
  if (selectedClipIds.length !== 1) return null;

  const clip = getClipById(selectedClipIds[0]);
  if (!clip) return null;

  const canvas = canvasRef.current;
  if (!canvas || !canvasRect) return null;

  const scaleX = canvasRect.width / canvas.width;
  const scaleY = canvasRect.height / canvas.height;

  const centerX = (canvas.width / 2 + clip.transform.positionX) * scaleX;
  const centerY = (canvas.height / 2 + clip.transform.positionY) * scaleY;

  const videoWidth = canvasRect.width * clip.transform.scale;
  const videoHeight = canvasRect.height * clip.transform.scale;
  const rotation = clip.transform.rotation;

  const halfW = videoWidth / 2;
  const halfH = videoHeight / 2;

  const rotationHandleOffset = 30;

  const startDrag = (
    mode: DragMode,
    e: React.MouseEvent,
    overrideCenterX?: number,
    overrideCenterY?: number
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const cxScreen =
      overrideCenterX ?? canvasRect.left + centerX;
    const cyScreen =
      overrideCenterY ?? canvasRect.top + centerY;

    const dx = e.clientX - cxScreen;
    const dy = e.clientY - cyScreen;

    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      originalPositionX: clip.transform.positionX,
      originalPositionY: clip.transform.positionY,
      originalScale: clip.transform.scale,
      originalRotation: clip.transform.rotation,
      centerX: cxScreen,
      centerY: cyScreen,
      originalDistance: Math.sqrt(dx * dx + dy * dy) || 1,
    };
  };

  const cornerPositions = [
    { x: -halfW, y: -halfH, cursor: "nwse-resize" as const },
    { x: halfW, y: -halfH, cursor: "nesw-resize" as const },
    { x: -halfW, y: halfH, cursor: "nesw-resize" as const },
    { x: halfW, y: halfH, cursor: "nwse-resize" as const },
  ];

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: "hidden" }}
    >
      {/* Transformed bounding box group */}
      <div
        style={{
          position: "absolute",
          left: centerX,
          top: centerY,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          width: videoWidth,
          height: videoHeight,
          pointerEvents: "none",
        }}
      >
        {/* Bounding box border — draggable for move */}
        <div
          className="absolute inset-0 border border-dashed border-blue-400/60 pointer-events-auto cursor-move"
          onMouseDown={(e) => startDrag("move", e)}
        />

        {/* Corner handles for scale */}
        {cornerPositions.map((corner, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 bg-white border border-blue-500 rounded-sm pointer-events-auto"
            style={{
              left: corner.x + halfW - 4,
              top: corner.y + halfH - 4,
              cursor: corner.cursor,
            }}
            onMouseDown={(e) => {
              const rect = canvasRect;
              startDrag(
                "scale",
                e,
                rect.left + centerX,
                rect.top + centerY
              );
            }}
          />
        ))}

        {/* Center dot — draggable for move */}
        <div
          className="absolute w-1.5 h-1.5 bg-blue-500 rounded-full pointer-events-auto cursor-move"
          style={{
            left: halfW - 3,
            top: halfH - 3,
          }}
          onMouseDown={(e) => startDrag("move", e)}
        />

        {/* Rotation line */}
        <div
          className="absolute w-px bg-blue-400/40"
          style={{
            left: halfW,
            top: -rotationHandleOffset,
            height: rotationHandleOffset,
            transformOrigin: "bottom center",
          }}
        />

        {/* Rotation handle */}
        <div
          className="absolute w-2 h-2 bg-white border border-blue-500 rounded-full pointer-events-auto cursor-grab"
          style={{
            left: halfW - 4,
            top: -rotationHandleOffset - 4,
          }}
          onMouseDown={(e) => {
            const rect = canvasRect;
            startDrag(
              "rotate",
              e,
              rect.left + centerX,
              rect.top + centerY
            );
          }}
        />
      </div>
    </div>
  );
}
