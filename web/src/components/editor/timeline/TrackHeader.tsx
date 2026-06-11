"use client";

import { useCallback, memo } from "react";
import { useEditorStore, withUndo } from "@/lib/store/editor-store";
import { cva } from "class-variance-authority";
import type { Track } from "@/types/editor";
import { TRACK_HEIGHT } from "@/types/editor";

const trackToggle = cva(
  "w-5 h-5 rounded flex items-center justify-center transition-colors",
  {
    variants: {
      state: {
        active: "bg-neutral-700 text-neutral-500",
        activeYellow: "bg-yellow-500/20 text-yellow-400",
        activeRed: "bg-red-500/20 text-red-400",
        idle: "text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800",
      },
    },
    defaultVariants: { state: "idle" },
  }
);

interface TrackHeaderProps {
  track: Track;
}

const TRACK_COLORS: Record<string, string> = {
  video: "bg-blue-500",
  audio: "bg-green-500",
  text: "bg-purple-500",
  effect: "bg-orange-500",
};

/**
 * Track header — shows the track label, type indicator, and
 * mute/lock/visibility toggles.
 *
 * Video tracks show: [Eye] [Lock] [M]
 * Audio tracks show: [M] [S] [Lock]
 */
export const TrackHeader = memo(function TrackHeader({ track }: TrackHeaderProps) {
  const updateTrack = useCallback(
    (updates: Partial<Track>) => {
      // Route through withUndo so track toggles (mute/solo/lock/visibility)
      // are undoable like every other edit, instead of mutating state directly.
      withUndo(`Track ${track.label}: ${Object.keys(updates).join(", ")}`, () => {
        useEditorStore.getState().updateTrack(track.id, updates);
      });
    },
    [track.id, track.label]
  );

  const toggleMuted = useCallback(() => updateTrack({ muted: !track.muted }), [track.muted, updateTrack]);
  const toggleLocked = useCallback(() => updateTrack({ locked: !track.locked }), [track.locked, updateTrack]);
  const toggleVisible = useCallback(() => updateTrack({ visible: !track.visible }), [track.visible, updateTrack]);
  const toggleSolo = useCallback(() => updateTrack({ solo: !track.solo }), [track.solo, updateTrack]);

  const isVideo = track.type === 'video';
  const isAudio = track.type === 'audio';

  return (
    <div
      className="flex items-center gap-2 px-2 bg-neutral-900 border-b border-neutral-800 shrink-0"
      style={{ height: TRACK_HEIGHT }}
    >
      {/* Type indicator dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 ${TRACK_COLORS[track.type] ?? "bg-neutral-500"}`} />

      {/* Track label */}
      <span className="text-xs text-neutral-300 truncate flex-1 font-medium">
        {track.label}
      </span>

      {/* Controls — layout varies by track type */}
      <div className="flex items-center gap-0.5">
        {/* Video: Visibility (Eye) */}
        {isVideo && (
          <button
            onClick={toggleVisible}
            className={trackToggle({ state: !track.visible ? "active" : "idle" })}
            title={track.visible ? "Hide" : "Show"}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              {track.visible ? (
                <>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              ) : (
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </>
              )}
            </svg>
          </button>
        )}

        {/* Mute */}
        <button
          onClick={toggleMuted}
          className={trackToggle({ state: track.muted ? "activeRed" : "idle" }) + " text-[10px] font-bold"}
          title={track.muted ? "Unmute" : "Mute"}
        >
          M
        </button>

        {/* Audio: Solo */}
        {isAudio && (
          <button
            onClick={toggleSolo}
            className={trackToggle({ state: track.solo ? "activeYellow" : "idle" }) + " text-[10px] font-bold"}
            title={track.solo ? "Unsolo" : "Solo"}
          >
            S
          </button>
        )}

        {/* Lock */}
        <button
          onClick={toggleLocked}
          className={trackToggle({ state: track.locked ? "activeYellow" : "idle" })}
          title={track.locked ? "Unlock" : "Lock"}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            {track.locked ? (
              <path d="M5 11V7a7 7 0 0114 0v4M3 11h18v11H3V11z" />
            ) : (
              <path d="M7 11V7a5 5 0 0110 0M3 11h18v11H3V11z" />
            )}
          </svg>
        </button>
      </div>
    </div>
  );
});
