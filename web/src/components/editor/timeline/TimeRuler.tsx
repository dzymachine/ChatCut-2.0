"use client";

import { useMemo, useCallback, useRef } from "react";
import { RULER_HEIGHT } from "@/types/editor";
import { getVideoEngine } from "@/lib/engine/video-engine";

interface TimeRulerProps {
  pixelsPerSecond: number;
  duration: number;
  /** Total width of the scrollable content in px. */
  totalWidth: number;
  /** The visible scroll area width. */
  visibleWidth: number;
  /** Current scroll offset. */
  scrollLeft: number;
}

/**
 * The time ruler at the top of the timeline.
 * Draws tick marks and time labels. Click/drag to scrub the playhead.
 */
export function TimeRuler({
  pixelsPerSecond,
  duration,
  totalWidth,
  visibleWidth,
  scrollLeft,
}: TimeRulerProps) {
  const isScrubbing = useRef(false);

  // ── Calculate tick interval based on zoom ──
  const { majorInterval, minorInterval } = useMemo(() => {
    // Choose intervals so major ticks are ~80-150px apart
    const targetMajorPx = 100;
    const rawInterval = targetMajorPx / pixelsPerSecond;

    // Snap to nice intervals
    const niceIntervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    let major = niceIntervals[0];
    for (const interval of niceIntervals) {
      major = interval;
      if (interval * pixelsPerSecond >= 60) break;
    }

    const minor = major / (major >= 10 ? 5 : major >= 1 ? 5 : 5);
    return { majorInterval: major, minorInterval: minor };
  }, [pixelsPerSecond]);

  // ── Generate visible ticks ──
  const ticks = useMemo(() => {
    const result: Array<{
      time: number;
      x: number;
      isMajor: boolean;
      label: string;
    }> = [];

    // Only render ticks visible in the viewport (with buffer)
    const startTime = Math.max(0, Math.floor((scrollLeft - 20) / pixelsPerSecond / minorInterval) * minorInterval);
    const endTime = Math.min(
      duration + majorInterval,
      ((scrollLeft + visibleWidth + 20) / pixelsPerSecond)
    );

    for (let t = startTime; t <= endTime; t += minorInterval) {
      const roundedT = Math.round(t * 1000) / 1000; // avoid float drift
      const isMajor = Math.abs(roundedT % majorInterval) < minorInterval * 0.1 ||
                      Math.abs(roundedT % majorInterval - majorInterval) < minorInterval * 0.1;
      result.push({
        time: roundedT,
        x: roundedT * pixelsPerSecond,
        isMajor,
        label: isMajor ? formatRulerTime(roundedT) : "",
      });
    }

    return result;
  }, [scrollLeft, visibleWidth, pixelsPerSecond, duration, majorInterval, minorInterval]);

  // ── Scrubbing handlers ──
  const timeFromMouseX = useCallback(
    (clientX: number, rulerRect: DOMRect) => {
      const x = clientX - rulerRect.left + scrollLeft;
      // Don't clamp to clip duration — allow scrubbing into empty timeline gaps
      return Math.max(0, x / pixelsPerSecond);
    },
    [pixelsPerSecond, scrollLeft]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const engine = getVideoEngine();
      const rulerRect = e.currentTarget.getBoundingClientRect();
      const time = timeFromMouseX(e.clientX, rulerRect);
      engine.seek(time);
      isScrubbing.current = true;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isScrubbing.current) return;
        const t = timeFromMouseX(moveEvent.clientX, rulerRect);
        engine.seek(t);
      };

      const handleMouseUp = () => {
        isScrubbing.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [timeFromMouseX]
  );

  return (
    <div
      className="relative bg-neutral-900 border-b border-neutral-700 cursor-crosshair select-none shrink-0"
      style={{ height: RULER_HEIGHT, width: totalWidth, minWidth: "100%" }}
      onMouseDown={handleMouseDown}
    >
      {ticks.map((tick, i) => (
        <div
          key={i}
          className="absolute bottom-0"
          style={{ left: tick.x }}
        >
          {/* Tick line */}
          <div
            className={`absolute bottom-0 w-px ${
              tick.isMajor ? "bg-neutral-500" : "bg-neutral-700"
            }`}
            style={{ height: tick.isMajor ? 12 : 6 }}
          />
          {/* Label */}
          {tick.isMajor && tick.label && (
            <span
              className="absolute text-[10px] text-neutral-500 whitespace-nowrap select-none"
              style={{
                bottom: 14,
                left: 3,
              }}
            >
              {tick.label}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──

function formatRulerTime(seconds: number): string {
  if (seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (mins === 0 && seconds < 1) {
    // Show milliseconds for sub-second times
    return `${secs.toFixed(1)}s`;
  }

  const wholeSeconds = Math.floor(secs);
  const pad = wholeSeconds.toString().padStart(2, "0");

  if (secs % 1 > 0.001 && seconds < 10) {
    return `${mins}:${pad}.${Math.round((secs % 1) * 10)}`;
  }

  return `${mins}:${pad}`;
}
