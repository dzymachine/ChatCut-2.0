"use client";

import { useCallback, useMemo, useState } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { useShallow } from "zustand/react/shallow";
import { TRACK_HEIGHT, RULER_HEIGHT, TRACK_HEADER_WIDTH } from "@/types/editor";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimeRuler } from "./TimeRuler";
import { TrackHeader } from "./TrackHeader";
import { TrackLane } from "./TrackLane";
import { Playhead } from "./Playhead";
import { useTimelineDrop } from "./hooks/useTimelineDrop";
import { useTimelineKeyboard } from "./hooks/useTimelineKeyboard";
import { useTimelineViewport } from "./hooks/useTimelineViewport";

const TRACK_DIVIDER_HEIGHT = 4;

export function Timeline() {
  const tracks = useEditorStore((s) => s.project.tracks);
  const duration = useEditorStore((s) => s.project.composition.duration);
  const pixelsPerSecond = useEditorStore((s) => s.timeline.pixelsPerSecond);
  const panelHeight = useEditorStore((s) => s.timeline.panelHeight);
  const selectedClipIds = useEditorStore(useShallow((s) => s.ui.selectedClipIds));
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const addTrack = useEditorStore((s) => s.addTrack);
  const linkedSelectionEnabled = useEditorStore((s) => s.ui.linkedSelectionEnabled);

  const {
    scrollContainerRef,
    scrollLeft,
    visibleWidth,
    handleScroll,
    handleWheel,
    handleZoomToFit,
    handleResizeStart,
  } = useTimelineViewport();

  const {
    isTimelineDragOver,
    handleTimelineDragOver,
    handleTimelineDragLeave,
    handleTimelineDrop,
  } = useTimelineDrop(scrollContainerRef, pixelsPerSecond);

  useTimelineKeyboard();

  // Tracks the user explicitly added stay visible even while empty.
  const [stickyTrackIds, setStickyTrackIds] = useState<Set<string>>(new Set());

  const allVideoTracks = useMemo(() => tracks.filter((t) => t.type === 'video'), [tracks]);
  const allAudioTracks = useMemo(() => tracks.filter((t) => t.type === 'audio'), [tracks]);

  const videoTracks = useMemo(() => {
    const visible = allVideoTracks.filter(
      (t) => t.clips.length > 0 || stickyTrackIds.has(t.id)
    );
    if (visible.length > 0) return visible;
    const primary = allVideoTracks[0];
    return primary ? [primary] : [];
  }, [allVideoTracks, stickyTrackIds]);

  const audioTracks = useMemo(() => {
    const visible = allAudioTracks.filter(
      (t) => t.clips.length > 0 || stickyTrackIds.has(t.id)
    );
    if (visible.length > 0) return visible;
    const primary = allAudioTracks[0];
    return primary ? [primary] : [];
  }, [allAudioTracks, stickyTrackIds]);

  const handleAddTrack = useCallback(
    (type: 'video' | 'audio') => {
      const newTrack = addTrack(type);
      setStickyTrackIds((prev) => {
        const next = new Set(prev);
        next.add(newTrack.id);
        return next;
      });
    },
    [addTrack]
  );

  const hasBothTypes = videoTracks.length > 0 && audioTracks.length > 0;

  const allTrackIds = useMemo(
    () => [...videoTracks, ...audioTracks].map((t) => t.id),
    [videoTracks, audioTracks]
  );

  const snapPoints = useMemo(() => {
    const points: number[] = [0, currentTime];
    for (const t of tracks) {
      for (const c of t.clips) {
        points.push(c.timelineStart);
        points.push(c.timelineStart + (c.sourceEnd - c.sourceStart));
      }
    }
    return [...new Set(points)].sort((a, b) => a - b);
  }, [tracks, currentTime]);

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

  const hasClips = useMemo(
    () => tracks.some((t) => t.clips.length > 0),
    [tracks]
  );

  const dividerHeight = hasBothTypes ? TRACK_DIVIDER_HEIGHT : 0;
  const tracksHeight = (videoTracks.length + audioTracks.length) * TRACK_HEIGHT + dividerHeight;

  const contentDuration = Math.max(duration + Math.max(duration * 0.2, 5), 10);
  const totalWidth = contentDuration * pixelsPerSecond;

  return (
    <div
      className="flex flex-col bg-neutral-950 border-t border-neutral-700 select-none"
      style={{ height: panelHeight }}
    >
      <div
        className="h-1 cursor-row-resize bg-neutral-800 hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors shrink-0"
        onMouseDown={handleResizeStart}
      />

      <TimelineToolbar onZoomToFit={handleZoomToFit} />

      <div className="flex flex-1 min-h-0 overflow-hidden" onWheel={handleWheel}>
        <div
          className="flex flex-col bg-neutral-900 border-r border-neutral-800 shrink-0 overflow-hidden"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          <div
            className="shrink-0 border-b border-neutral-700 bg-neutral-900 flex items-end px-2 pb-0.5"
            style={{ height: RULER_HEIGHT }}
          >
            <span className="text-[9px] text-neutral-600 font-mono">
              {videoTracks.length > 0 && `V${videoTracks.length}`}
              {videoTracks.length > 0 && audioTracks.length > 0 && ' '}
              {audioTracks.length > 0 && `A${audioTracks.length}`}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            {videoTracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
            <button
              type="button"
              onClick={() => handleAddTrack('video')}
              className="w-full text-[10px] text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60 px-2 py-1 transition-colors text-left"
              title="Add a new video track"
            >
              + Add video track
            </button>
            {hasBothTypes && (
              <div
                className="bg-neutral-700/60 shrink-0"
                style={{ height: TRACK_DIVIDER_HEIGHT }}
              />
            )}
            {audioTracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
            <button
              type="button"
              onClick={() => handleAddTrack('audio')}
              className="w-full text-[10px] text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/60 px-2 py-1 transition-colors text-left"
              title="Add a new audio track"
            >
              + Add audio track
            </button>
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-x-auto overflow-y-auto"
          onScroll={handleScroll}
          onDragOver={handleTimelineDragOver}
          onDragLeave={handleTimelineDragLeave}
          onDrop={handleTimelineDrop}
        >
          <div className="relative" style={{ width: totalWidth, minWidth: "100%" }}>
            <div className="sticky top-0 z-20">
              <TimeRuler
                pixelsPerSecond={pixelsPerSecond}
                duration={contentDuration}
                totalWidth={totalWidth}
                visibleWidth={visibleWidth}
                scrollLeft={scrollLeft}
              />
            </div>

            <div className="relative">
              {videoTracks.map((track, index) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  pixelsPerSecond={pixelsPerSecond}
                  totalWidth={totalWidth}
                  index={index}
                  allTrackIds={allTrackIds}
                  snapPoints={snapPoints}
                  selectedLinkIds={selectedLinkIds}
                />
              ))}
              {hasBothTypes && (
                <div
                  className="bg-neutral-700/60"
                  style={{ height: TRACK_DIVIDER_HEIGHT, width: totalWidth, minWidth: "100%" }}
                />
              )}
              {audioTracks.map((track, index) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  pixelsPerSecond={pixelsPerSecond}
                  totalWidth={totalWidth}
                  index={videoTracks.length + index}
                  allTrackIds={allTrackIds}
                  snapPoints={snapPoints}
                  selectedLinkIds={selectedLinkIds}
                />
              ))}

              {isTimelineDragOver && (
                <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-400/50 flex items-center justify-center z-30 rounded pointer-events-none">
                  <span className="text-blue-300 text-xs font-medium bg-neutral-900/80 px-3 py-1.5 rounded">
                    Drop video here
                  </span>
                </div>
              )}

              {!hasClips && !isTimelineDragOver && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-neutral-600 text-xs">
                    Drop a video to see clips on the timeline
                  </p>
                </div>
              )}
            </div>

            <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ height: RULER_HEIGHT + tracksHeight }}>
              <Playhead
                pixelsPerSecond={pixelsPerSecond}
                tracksHeight={tracksHeight}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
