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

export function TimeRuler({
  pixelsPerSecond,
  duration,
  totalWidth,
  visibleWidth,
  scrollLeft,
}: TimeRulerProps) {
  const isScrubbing = useRef(false);

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const engine = getVideoEngine();
      const rulerRect = e.currentTarget.getBoundingClientRect();

      // Calculate time from mouse position. rulerRect.left already reflects
      // horizontal scroll inside the container, so don't add scrollLeft again.
      const xInContent = e.clientX - rulerRect.left;
      const time = Math.max(0, xInContent / pixelsPerSecond);

      engine.seek(time);
      isScrubbing.current = true;

      // rAF-throttle: mousemove fires at 60-120 Hz; each seek triggers a
      // videoElement.currentTime decode which is expensive. Coalesce so we
      // call seek() at most once per animation frame using the latest target.
      let pendingTime: number | null = null;
      let rafId: number | null = null;
      const flush = () => {
        rafId = null;
        if (pendingTime !== null && isScrubbing.current) {
          engine.seek(pendingTime);
          pendingTime = null;
        }
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isScrubbing.current) return;
        const xInContent = moveEvent.clientX - rulerRect.left;
        pendingTime = Math.max(0, xInContent / pixelsPerSecond);
        if (rafId === null) {
          rafId = requestAnimationFrame(flush);
        }
      };

      const handleMouseUp = () => {
        isScrubbing.current = false;
        if (rafId !== null) cancelAnimationFrame(rafId);
        // Final seek so the playhead lands exactly where the user released.
        if (pendingTime !== null) engine.seek(pendingTime);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [pixelsPerSecond]
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
          <div
            className={`absolute bottom-0 w-px ${
              tick.isMajor ? "bg-neutral-500" : "bg-neutral-700"
            }`}
            style={{ height: tick.isMajor ? 12 : 6 }}
          />
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
