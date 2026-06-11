"use client";

import { useMemo } from "react";
import { useEditorStore } from "@/lib/store/editor-store";

export function VideoLibrary() {
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const tracks = useEditorStore((s) => s.project.tracks);

  const libraryItems = useMemo(() => {
    const timelineUsage = new Map<string, number>();

    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.type !== "video") continue;
        timelineUsage.set(clip.sourceFileId, (timelineUsage.get(clip.sourceFileId) ?? 0) + 1);
      }
    }

    return Array.from(mediaFiles.values())
      .filter((media) => media.type === "video")
      .map((media) => ({
        media,
        usageCount: timelineUsage.get(media.id) ?? 0,
      }));
  }, [tracks, mediaFiles]);

  if (libraryItems.length === 0) {
    return (
      <div className="p-4 text-xs text-neutral-400">Import video files to see them here.</div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-neutral-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
          Video Library
        </h2>
        <p className="text-[11px] text-neutral-500 mt-1">Source videos, independent of timeline cuts.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {libraryItems.map(({ media, usageCount }) => (
          <div
            key={media.id}
            className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950/70 p-2"
          >
            <div className="relative w-16 h-10 rounded-md bg-neutral-900 overflow-hidden">
              {media.type === "video" ? (
                <video
                  src={media.previewUrl}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(e) => {
                    const vid = e.currentTarget;
                    vid.currentTime = Math.min(0.1, vid.duration / 4);
                  }}
                />
              ) : (
                <img
                  src={media.previewUrl}
                  alt={media.name}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-white truncate">{media.name}</div>
              <div className="text-[11px] text-neutral-500 truncate">
                {Math.round(media.duration * 100) / 100}s · {usageCount} in timeline
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
