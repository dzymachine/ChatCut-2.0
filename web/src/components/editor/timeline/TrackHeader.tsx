"use client";

import { useCallback } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import type { Track } from "@/types/editor";
import { TRACK_HEIGHT } from "@/types/editor";

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
 */
export function TrackHeader({ track }: TrackHeaderProps) {
  const updateTrack = useCallback(
    (updates: Partial<Track>) => {
      useEditorStore.setState((state) => ({
        project: {
          ...state.project,
          tracks: state.project.tracks.map((t) =>
            t.id === track.id ? { ...t, ...updates } : t
          ),
          updatedAt: Date.now(),
        },
      }));
    },
    [track.id]
  );

  const toggleMuted = useCallback(() => updateTrack({ muted: !track.muted }), [track.muted, updateTrack]);
  const toggleLocked = useCallback(() => updateTrack({ locked: !track.locked }), [track.locked, updateTrack]);
  const toggleVisible = useCallback(() => updateTrack({ visible: !track.visible }), [track.visible, updateTrack]);

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

      {/* Controls */}
      <div className="flex items-center gap-0.5">
        {/* Mute/Solo */}
        <button
          onClick={toggleMuted}
          className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold transition-colors ${
            track.muted
              ? "bg-red-500/20 text-red-400"
              : "text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800"
          }`}
          title={track.muted ? "Unmute" : "Mute"}
        >
          M
        </button>

        {/* Lock */}
        <button
          onClick={toggleLocked}
          className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
            track.locked
              ? "bg-yellow-500/20 text-yellow-400"
              : "text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800"
          }`}
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

        {/* Visibility */}
        <button
          onClick={toggleVisible}
          className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
            !track.visible
              ? "bg-neutral-700 text-neutral-500"
              : "text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800"
          }`}
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
      </div>
    </div>
  );
}
