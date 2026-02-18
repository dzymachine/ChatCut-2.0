"use client";

import { useEditorStore } from "@/lib/store/editor-store";
import { RULER_HEIGHT } from "@/types/editor";

interface PlayheadProps {
  pixelsPerSecond: number;
  /** Total height the playhead line should span (tracks area only). */
  tracksHeight: number;
}

/**
 * The playhead — a red vertical line indicating current playback position.
 * Renders a triangle head in the ruler area and a line through all tracks.
 */
export function Playhead({ pixelsPerSecond, tracksHeight }: PlayheadProps) {
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const leftPx = currentTime * pixelsPerSecond;

  return (
    <div
      className="absolute top-0 z-30 pointer-events-none"
      style={{
        left: leftPx,
        height: RULER_HEIGHT + tracksHeight,
        transform: "translateX(-0.5px)",
      }}
    >
      {/* Triangle head (in ruler area) */}
      <div
        className="absolute flex items-center justify-center"
        style={{
          top: RULER_HEIGHT - 10,
          left: -6,
          width: 13,
          height: 10,
        }}
      >
        <svg width="13" height="10" viewBox="0 0 13 10" fill="none">
          <path d="M0 0H13L6.5 10L0 0Z" fill="#ef4444" />
        </svg>
      </div>

      {/* Vertical line */}
      <div
        className="absolute w-px bg-red-500"
        style={{
          top: RULER_HEIGHT,
          height: tracksHeight,
        }}
      />
    </div>
  );
}
