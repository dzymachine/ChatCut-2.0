"use client";

/**
 * Hook to detect Tauri desktop mode and check native capabilities.
 * Provides runtime information about the environment.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { isTauri, checkFFmpeg } from "@/lib/tauri/bridge";

export interface TauriStatus {
  /** Whether we're running inside the Tauri desktop shell */
  isDesktop: boolean;
  /** FFmpeg availability — null if not checked yet */
  ffmpeg: { available: boolean; version: string } | null;
}

// The Tauri global never changes after page load — a static external value.
// useSyncExternalStore reads it hydration-safely (server snapshot: false).
const subscribeNever = () => () => {};

export function useTauriStatus(): TauriStatus {
  const isDesktop = useSyncExternalStore(subscribeNever, isTauri, () => false);
  const [ffmpeg, setFfmpeg] = useState<TauriStatus["ffmpeg"]>(null);

  // Probe FFmpeg once in desktop mode (async — sets state from a callback).
  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    checkFFmpeg()
      .then((version) => {
        if (!cancelled) setFfmpeg({ available: true, version });
      })
      .catch(() => {
        if (!cancelled) setFfmpeg({ available: false, version: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  return { isDesktop, ffmpeg };
}
