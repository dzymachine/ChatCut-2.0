"use client";

import {
  MediaControlBar,
  MediaPlayButton,
  MediaMuteButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from "media-chrome/react";

interface TransportControlsProps {
  onTogglePlayback?: () => void;
  onSeek?: (time: number) => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

export function TransportControls({
  onTogglePlayback,
  onSeek,
  onToggleFullscreen,
  isFullscreen = false,
}: TransportControlsProps) {
  return (
    <MediaControlBar
      style={{
        display: "flex",
        width: "100%",
        background: "rgb(23, 23, 23)",
        borderTop: "1px solid rgb(38, 38, 38)",
        padding: "8px 12px",
        gap: "4px",
        alignItems: "center",
        ["--media-primary-color" as string]: "rgb(229, 229, 229)",
        ["--media-secondary-color" as string]: "rgb(115, 115, 115)",
        ["--media-control-background" as string]: "transparent",
        ["--media-control-hover-background" as string]: "rgba(255, 255, 255, 0.08)",
        ["--media-control-padding" as string]: "8px",
        ["--media-control-height" as string]: "32px",
        ["--media-button-icon-width" as string]: "16px",
        ["--media-button-icon-height" as string]: "16px",
        ["--media-range-track-background" as string]: "rgba(255, 255, 255, 0.12)",
        ["--media-range-track-height" as string]: "4px",
        ["--media-range-track-border-radius" as string]: "9999px",
        ["--media-range-bar-color" as string]: "rgb(229, 229, 229)",
        ["--media-range-thumb-background" as string]: "white",
        ["--media-range-thumb-width" as string]: "12px",
        ["--media-range-thumb-height" as string]: "12px",
        ["--media-range-thumb-border-radius" as string]: "50%",
        ["--media-range-thumb-opacity" as string]: "0",
        ["--media-range-thumb-transition" as string]: "opacity 120ms ease",
        ["--media-font-size" as string]: "12px",
        ["--media-font-family" as string]: "ui-monospace, monospace",
        ["--media-text-color" as string]: "rgb(163, 163, 163)",
      }}
    >
      <style>{`
        media-control-bar > * {
          border-radius: 6px;
          transition: background 120ms ease;
        }
        media-control-bar media-time-range:hover,
        media-control-bar media-volume-range:hover {
          --media-range-thumb-opacity: 1;
        }
      `}</style>
      <MediaPlayButton />
      <MediaTimeDisplay
        showDuration
        style={{ padding: "0 6px", whiteSpace: "nowrap" }}
      />
      <MediaTimeRange style={{ flex: 1, minWidth: 0 }} />
      <MediaMuteButton />
      <MediaVolumeRange style={{ width: "72px" }} />
      {onToggleFullscreen && (
        <button
          onClick={onToggleFullscreen}
          className="flex items-center justify-center rounded-md transition-colors hover:bg-neutral-700"
          style={{
            padding: "8px",
            cursor: "pointer",
          }}
          title="Toggle fullscreen (F)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ color: "rgb(163, 163, 163)" }}
          >
            {isFullscreen ? (
              <>
                <path d="M8 3v6m0 0H2m6 0l-6-6M16 3v6m6 0h-6m6 0l6-6M8 21v-6m0 0H2m6 0l-6 6M16 21v-6m6 0h-6m6 0l6 6" />
              </>
            ) : (
              <>
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </>
            )}
          </svg>
        </button>
      )}
    </MediaControlBar>
  );
}
