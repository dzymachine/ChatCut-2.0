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
  /** Ordered list of all track IDs matching visual layout. */
  allTrackIds: string[];
}

/**
 * A single track lane — the horizontal strip where clips are laid out.
 * Contains TimelineClip components for each clip in the track.
 */
export function TrackLane({ track, pixelsPerSecond, totalWidth, index, allTrackIds }: TrackLaneProps) {
  const selectedClipIds = useEditorStore((s) => s.ui.selectedClipIds);
  const linkedSelectionEnabled = useEditorStore((s) => s.ui.linkedSelectionEnabled);
  const snapEnabled = useEditorStore((s) => s.timeline.snapEnabled);
  const snapThresholdPx = useEditorStore((s) => s.timeline.snapThresholdPx);
  const tracks = useEditorStore((s) => s.project.tracks);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const setSelectedClip = useEditorStore((s) => s.setSelectedClip);

  const selectedLinkIds = useMemo(() => {
    if (!linkedSelectionEnabled || selectedClipIds.length === 0) return new Set<string>();
    const linkIds = new Set<string>();
    for (const t of tracks) {
      for (const c of t.clips) {
        if (selectedClipIds.includes(c.id) && c.linkId) {
          linkIds.add(c.linkId);
        }
      }
    }
    return linkIds;
  }, [selectedClipIds, linkedSelectionEnabled, tracks]);

  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  

  const snapPoints = useMemo(() => {
    const points: number[] = [0, currentTime];

    for (const t of tracks) {
      for (const c of t.clips) {
        const clipEnd = c.timelineStart + (c.sourceEnd - c.sourceStart);
        points.push(c.timelineStart);
        points.push(clipEnd);
      }
    }

    return [...new Set(points)].sort((a, b) => a - b);
  }, [tracks, currentTime]);

  const handleLaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        // If user is holding ctrl/meta, don't clear selection (allow multi-select)
        if (e.ctrlKey || e.metaKey) return;
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
      {track.locked && (
        <div className="absolute inset-0 bg-neutral-900/30 z-20" />
      )}

      {track.clips.map((clip) => {
        const isDirectlySelected = selectedSet.has(clip.id);
        const isLinkedSelected = !isDirectlySelected &&
          !!clip.linkId &&
          selectedLinkIds.has(clip.linkId);

        return (
          <TimelineClip
            key={clip.id}
            clip={clip}
            track={track}
            pixelsPerSecond={pixelsPerSecond}
            isSelected={isDirectlySelected}
            isLinkedSelected={isLinkedSelected}
            snapPoints={snapPoints}
            snapThresholdPx={snapThresholdPx}
            snapEnabled={snapEnabled}
            allTrackIds={allTrackIds}
            trackIndex={index}
          />
        );
      })}
    </div>
  );
}
