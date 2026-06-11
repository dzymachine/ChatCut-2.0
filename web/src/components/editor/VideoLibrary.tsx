"use client";

import { useMemo } from "react";
import { useEditorStore } from "@/lib/store/editor-store";

/**
 * Media library — lists imported source ASSETS (not timeline clips).
 * One entry per unique source file; assets persist in the v2 project format.
 * Missing sources (file moved/deleted since save) are badged.
 */
export function VideoLibrary() {
  const assets = useEditorStore((s) => s.assets);
  const tracks = useEditorStore((s) => s.project.tracks);

  // Count timeline usages per asset so the library shows what's in use.
  const usageByAsset = useMemo(() => {
    const counts = new Map<string, number>();
    for (const track of tracks) {
      for (const clip of track.clips) {
        counts.set(clip.assetId, (counts.get(clip.assetId) ?? 0) + 1);
      }
    }
    return counts;
  }, [tracks]);

  const items = useMemo(() => [...assets.values()], [assets]);

  if (items.length === 0) {
    return (
      <div className="p-4 text-xs text-neutral-400">Import media to see your library here.</div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-neutral-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
          Media Library
        </h2>
        <p className="text-[11px] text-neutral-500 mt-1">
          {items.length} source{items.length > 1 ? "s" : ""} — unique per file.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {items.map((asset) => {
          const usage = usageByAsset.get(asset.id) ?? 0;
          const isMissing = asset.status === "missing" || asset.status === "error";
          return (
            <div
              key={asset.id}
              className={`flex items-center gap-3 rounded-lg border p-2 ${
                isMissing
                  ? "border-red-900/60 bg-red-950/20"
                  : "border-neutral-800 bg-neutral-950/70"
              }`}
            >
              <div className="relative w-16 h-10 rounded-md bg-neutral-900 overflow-hidden shrink-0">
                {isMissing || !asset.previewUrl ? (
                  <div className="w-full h-full flex items-center justify-center text-red-400 text-sm">
                    ⚠
                  </div>
                ) : asset.kind === "video" ? (
                  <video
                    src={asset.previewUrl}
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
                  // eslint-disable-next-line @next/next/no-img-element -- blob/asset URLs from local media; next/image can't optimize them
                  <img
                    src={asset.previewUrl}
                    alt={asset.name}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{asset.name}</div>
                <div className="text-[11px] text-neutral-500 truncate">
                  {isMissing
                    ? "Source file missing"
                    : `${asset.kind} · ${Math.round(asset.duration * 100) / 100}s · ${
                        usage > 0 ? `${usage} clip${usage > 1 ? "s" : ""}` : "unused"
                      }`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
