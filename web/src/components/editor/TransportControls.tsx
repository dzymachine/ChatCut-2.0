"use client";

import {
  MediaControlBar,
  MediaPlayButton,
  MediaMuteButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from "media-chrome/react";

export function TransportControls() {
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
    </MediaControlBar>
  );
}
