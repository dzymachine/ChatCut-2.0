"use client";

import type { Track } from "@/types/editor";
import { TRACK_HEIGHT } from "@/types/editor";
import { TimelineClip } from "./TimelineClip";
import { useEditorStore } from "@/lib/store/editor-store";
import { useMemo, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

interface TrackLaneProps {
  track: Track;
  pixelsPerSecond: number;
  totalWidth: number;
  index: number;
  allTrackIds: string[];
  snapPoints: number[];
  selectedLinkIds: Set<string>;
}

export function TrackLane({ track, pixelsPerSecond, totalWidth, index, allTrackIds, snapPoints, selectedLinkIds }: TrackLaneProps) {
  const selectedClipIds = useEditorStore(useShallow((s) => s.ui.selectedClipIds));
  const snapEnabled = useEditorStore((s) => s.timeline.snapEnabled);
  const snapThresholdPx = useEditorStore((s) => s.timeline.snapThresholdPx);
  const setSelectedClip = useEditorStore((s) => s.setSelectedClip);

  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  const handleLaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
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
