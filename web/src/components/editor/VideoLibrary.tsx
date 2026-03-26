"use client";

import { useMemo } from "react";
import { useEditorStore } from "@/lib/store/editor-store";

export function VideoLibrary() {
  const tracks = useEditorStore((s) => s.project.tracks);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);

  const clips = useMemo(() => {
    // Collect clips in timeline order (by timelineStart) across all tracks
    const allClips = tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })));
    allClips.sort((a, b) => a.clip.timelineStart - b.clip.timelineStart);
    return allClips;
  }, [tracks]);

  const clipItems = useMemo(() => {
    const seen = new Set<string>();
    return clips
      .map(({ clip, track }) => {
        const media = mediaFiles.get(clip.sourceFileId);
        if (!media) return null;
        if (seen.has(clip.id)) return null;
        seen.add(clip.id);
        return { clip, track, media };
      })
      .filter(Boolean) as Array<{ clip: typeof clips[number]["clip"]; track: typeof clips[number]["track"]; media: typeof mediaFiles extends Map<infer K, infer V> ? V : never }>;
  }, [clips, mediaFiles]);

  if (clipItems.length === 0) {
    return (
      <div className="p-4 text-xs text-neutral-400">Add clips to your timeline to see them here.</div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-neutral-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
          Video Library
        </h2>
        <p className="text-[11px] text-neutral-500 mt-1">Clips currently in the timeline.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {clipItems.map(({ clip, track, media }) => (
          <div
            key={clip.id}
            className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950/70 p-2"
          >
            <div className="relative w-16 h-10 rounded-md bg-neutral-900 overflow-hidden">
              {media.type === "video" ? (
                <video
                  src={media.previewUrl}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  loop
                  autoPlay
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
                {track.label} · {Math.round((clip.sourceEnd - clip.sourceStart) * 100) / 100}s
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
