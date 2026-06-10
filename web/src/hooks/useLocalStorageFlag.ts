"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Boolean flag persisted in localStorage, read via useSyncExternalStore so
 * it is hydration-safe (server snapshot = default) and lint-clean (no
 * setState-in-effect init dance). Updates propagate across hook instances
 * and browser tabs via the 'storage' event + a same-tab custom event.
 */

const SAME_TAB_EVENT = "chatcut:local-storage-flag";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(SAME_TAB_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SAME_TAB_EVENT, callback);
  };
}

export function useLocalStorageFlag(
  key: string,
  defaultValue: boolean,
): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? defaultValue : raw === "true";
      } catch {
        return defaultValue;
      }
    },
    () => defaultValue,
  );

  const setValue = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Persistence unavailable (private mode / quota) — the flag won't stick.
      }
      window.dispatchEvent(new Event(SAME_TAB_EVENT));
    },
    [key],
  );

  return [value, setValue];
}
