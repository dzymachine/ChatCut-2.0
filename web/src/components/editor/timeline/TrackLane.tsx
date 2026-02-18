"use client";

import type { Track } from "@/types/editor";
import { TRACK_HEIGHT } from "@/types/editor";
import { TimelineClip } from "./TimelineClip";
import { useEditorStore } from "@/lib/store/editor-store";
import { useMemo, useCallback } from "react";

interface TrackLaneProps {
  track: Track;
  pixelsPerSecond: number;
  /** Total width of the timeline content. */
  totalWidth: number;
  /** Index of the track (for alternating bg). */
  index: number;
}

/**
 * A single track lane — the horizontal strip where clips are laid out.
 * Contains TimelineClip components for each clip in the track.
 */
export function TrackLane({ track, pixelsPerSecond, totalWidth, index }: TrackLaneProps) {
  const selectedClipId = useEditorStore((s) => s.ui.selectedClipId);
  const snapEnabled = useEditorStore((s) => s.timeline.snapEnabled);
  const snapThresholdPx = useEditorStore((s) => s.timeline.snapThresholdPx);
  const tracks = useEditorStore((s) => s.project.tracks);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const setSelectedClip = useEditorStore((s) => s.setSelectedClip);

  // ── Compute snap points from ALL clips across ALL tracks + playhead ──
  const snapPoints = useMemo(() => {
    const points: number[] = [0, currentTime]; // Always snap to 0 and playhead

    for (const t of tracks) {
      for (const c of t.clips) {
        const clipEnd = c.timelineStart + (c.sourceEnd - c.sourceStart);
        points.push(c.timelineStart);
        points.push(clipEnd);
      }
    }

    // Deduplicate and sort
    return [...new Set(points)].sort((a, b) => a - b);
  }, [tracks, currentTime]);

  // ── Click on empty track area deselects ──
  const handleLaneClick = useCallback(
    (e: React.MouseEvent) => {
      // Only if clicking directly on the lane (not a clip)
      if (e.target === e.currentTarget) {
        setSelectedClip(null);
      }
    },
    [setSelectedClip]
  );

  return (
    <div
      className={`relative border-b border-neutral-800 ${
        index % 2 === 0 ? "bg-neutral-900/50" : "bg-neutral-900/30"
      } ${track.muted ? "opacity-50" : ""} ${track.locked ? "pointer-events-none" : ""}`}
      style={{ height: TRACK_HEIGHT, width: totalWidth, minWidth: "100%" }}
      onClick={handleLaneClick}
    >
      {/* Locked overlay */}
      {track.locked && (
        <div className="absolute inset-0 bg-neutral-900/30 z-20" />
      )}

      {/* Clips */}
      {track.clips.map((clip) => (
        <TimelineClip
          key={clip.id}
          clip={clip}
          track={track}
          pixelsPerSecond={pixelsPerSecond}
          isSelected={selectedClipId === clip.id}
          snapPoints={snapPoints}
          snapThresholdPx={snapThresholdPx}
          snapEnabled={snapEnabled}
        />
      ))}
    </div>
  );
}
