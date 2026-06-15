"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store/editor-store";

/**
 * Timeline viewport mechanics: horizontal scroll tracking, visible-width
 * observation, ⌘-wheel zoom, zoom-to-fit, playhead follow during playback,
 * and the panel-height resize drag. Owns the scroll container ref.
 */
export function useTimelineViewport() {
  const duration = useEditorStore((s) => s.project.composition.duration);
  const pixelsPerSecond = useEditorStore((s) => s.timeline.pixelsPerSecond);
  const panelHeight = useEditorStore((s) => s.timeline.panelHeight);
  const setTimelinePanelHeight = useEditorStore((s) => s.setTimelinePanelHeight);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const isPlaying = useEditorStore((s) => s.playback.isPlaying);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [visibleWidth, setVisibleWidth] = useState(800);

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
    [pixelsPerSecond, setTimelineZoom],
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

  // Follow the playhead while playing: when it nears the right edge, jump the
  // view so the playhead sits ~30% in from the left.
  useEffect(() => {
    if (!isPlaying || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const playheadPx = currentTime * pixelsPerSecond;
    const viewRight = container.scrollLeft + container.clientWidth;

    if (playheadPx > viewRight - 60) {
      container.scrollLeft = playheadPx - container.clientWidth * 0.3;
    }
  }, [currentTime, pixelsPerSecond, isPlaying]);

  // ── Panel-height resize drag ──
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
    [panelHeight, setTimelinePanelHeight],
  );

  return {
    scrollContainerRef,
    scrollLeft,
    visibleWidth,
    handleScroll,
    handleWheel,
    handleZoomToFit,
    handleResizeStart,
  };
}
