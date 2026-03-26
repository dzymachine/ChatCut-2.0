"use client";

import { useCallback } from "react";
import { useEditorStore } from "@/lib/store/editor-store";

interface StopwatchToggleProps {
  clipId: string;
  effectId: string;
  parameterId: string;
  currentValue: number;
}

export function StopwatchToggle({
  clipId,
  effectId,
  parameterId,
  currentValue,
}: StopwatchToggleProps) {
  const hasKf = useEditorStore((s) => {
    for (const track of s.project.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) {
        const effect = clip.effects.find((e) => e.id === effectId);
        if (effect)
          return effect.keyframes.some((k) => k.parameterId === parameterId);
      }
    }
    return false;
  });

  const handleClick = useCallback(() => {
    const store = useEditorStore.getState();
    if (hasKf) {
      store.clearPropertyKeyframes(clipId, effectId, parameterId);
    } else {
      const currentTime = store.playback.currentTime;
      let clipTime = currentTime;
      for (const track of store.project.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          clipTime = currentTime - clip.timelineStart;
          break;
        }
      }
      store.addKeyframe(clipId, effectId, parameterId, clipTime, currentValue);
    }
  }, [clipId, effectId, parameterId, currentValue, hasKf]);

  return (
    <button
      type="button"
      onClick={handleClick}
      title={hasKf ? "Disable animation" : "Enable animation"}
      className={`w-4 h-4 ${
        hasKf
          ? "text-amber-400 hover:text-amber-300"
          : "text-neutral-600 hover:text-neutral-400"
      }`}
    >
      <svg
        viewBox="0 0 16 16"
        fill={hasKf ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="w-full h-full"
      >
        <circle cx="8" cy="9" r="5.5" />
        <line x1="8" y1="4" x2="8" y2="3" />
        <line x1="6" y1="2.5" x2="10" y2="2.5" />
        <line x1="8" y1="9" x2="8" y2="6.5" />
        <line x1="12" y1="5" x2="13" y2="4" />
      </svg>
    </button>
  );
}
