"use client";

import type { Clip, Track, MediaFile } from "@/types/editor";

interface ClipHeaderProps {
  clip: Clip;
  track: Track | null;
  mediaFile: MediaFile | null;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function TypeIcon({ type }: { type: Clip["type"] }) {
  const cls = "w-4 h-4 text-neutral-400 shrink-0";

  switch (type) {
    case "video":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
          <line x1="7" y1="2" x2="7" y2="22" />
          <line x1="17" y1="2" x2="17" y2="22" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <line x1="2" y1="7" x2="7" y2="7" />
          <line x1="2" y1="17" x2="7" y2="17" />
          <line x1="17" y1="7" x2="22" y2="7" />
          <line x1="17" y1="17" x2="22" y2="17" />
        </svg>
      );
    case "audio":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case "image":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case "text":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 7 4 4 20 4 20 7" />
          <line x1="9" y1="20" x2="15" y2="20" />
          <line x1="12" y1="4" x2="12" y2="20" />
        </svg>
      );
  }
}

function trackBadge(track: Track | null): string {
  if (!track) return "?";
  const prefix = track.type === "video" || track.type === "text" ? "V" : track.type === "audio" ? "A" : "E";
  const num = track.label.replace(/\D/g, "") || "1";
  return `${prefix}${num}`;
}

export function ClipHeader({ clip, track, mediaFile }: ClipHeaderProps) {
  const duration = clip.sourceEnd - clip.sourceStart;
  const timelineEnd = clip.timelineStart + duration;
  const fileName = mediaFile?.name ?? "Untitled Clip";
  const badge = trackBadge(track);

  return (
    <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-2">
        <TypeIcon type={clip.type} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-neutral-200 truncate">
              {fileName}
            </span>
            <span className="shrink-0 rounded bg-neutral-700/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              {badge}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
            <span className="truncate">{track?.label ?? "Unknown Track"}</span>
            <span className="text-neutral-600">·</span>
            <span className="whitespace-nowrap font-mono tabular-nums">
              {formatTime(clip.timelineStart)} → {formatTime(timelineEnd)}
            </span>
            <span className="text-neutral-600">·</span>
            <span className="whitespace-nowrap font-mono tabular-nums">
              {formatTime(duration)}
            </span>
          </div>

          {mediaFile && mediaFile.width && mediaFile.height && (
            <p className="mt-0.5 truncate text-[11px] text-neutral-500">
              {mediaFile.width}x{mediaFile.height}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
