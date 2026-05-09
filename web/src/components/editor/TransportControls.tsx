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
        background: "rgb(23, 23, 23)",
        borderTop: "1px solid rgb(38, 38, 38)",
        padding: "6px 16px",
        gap: "8px",
        ["--media-primary-color" as string]: "rgb(212, 212, 212)",
        ["--media-secondary-color" as string]: "rgb(115, 115, 115)",
        ["--media-control-background" as string]: "transparent",
        ["--media-control-hover-background" as string]: "rgb(38, 38, 38)",
        ["--media-range-track-background" as string]: "rgb(64, 64, 64)",
        ["--media-range-bar-color" as string]: "rgb(163, 163, 163)",
        ["--media-range-thumb-background" as string]: "white",
        ["--media-range-thumb-width" as string]: "12px",
        ["--media-range-thumb-height" as string]: "12px",
        ["--media-range-thumb-border-radius" as string]: "50%",
        ["--media-font-size" as string]: "12px",
        ["--media-font-family" as string]: "ui-monospace, monospace",
        ["--media-control-padding" as string]: "4px",
      }}
    >
      <MediaPlayButton />
      <MediaTimeDisplay showDuration />
      <MediaTimeRange />
      <MediaMuteButton />
      <MediaVolumeRange
        style={{
          width: "80px",
          ["--media-range-padding" as string]: "4px 0",
        }}
      />
    </MediaControlBar>
  );
}
