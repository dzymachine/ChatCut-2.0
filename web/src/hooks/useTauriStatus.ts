"use client";

/**
 * Hook to detect Tauri desktop mode and check native capabilities.
 * Provides runtime information about the environment.
 */

import { useEffect, useState } from "react";
import { isTauri, checkFFmpeg } from "@/lib/tauri/bridge";
import { checkBackendHealth } from "@/lib/ai/client";

export interface TauriStatus {
  /** Whether we're running inside the Tauri desktop shell */
  isDesktop: boolean;
  /** FFmpeg availability — null if not checked yet */
  ffmpeg: { available: boolean; version: string } | null;
  /** AI backend availability */
  backendConnected: boolean | null;
}

export function useTauriStatus() {
  const [status, setStatus] = useState<TauriStatus>({
    isDesktop: false,
    ffmpeg: null,
    backendConnected: null,
  });

  useEffect(() => {
    const isDesktop = isTauri();
    setStatus((s) => ({ ...s, isDesktop }));

    // Check FFmpeg if in desktop mode
    if (isDesktop) {
      checkFFmpeg()
        .then((version) => {
          setStatus((s) => ({
            ...s,
            ffmpeg: { available: true, version },
          }));
        })
        .catch(() => {
          setStatus((s) => ({
            ...s,
            ffmpeg: { available: false, version: "" },
          }));
        });
    }

    // Check backend health
    checkBackendHealth().then((healthy) => {
      setStatus((s) => ({ ...s, backendConnected: healthy }));
    });

    // Re-check backend every 30 seconds
    const interval = setInterval(async () => {
      const healthy = await checkBackendHealth();
      setStatus((s) => ({ ...s, backendConnected: healthy }));
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return status;
}
