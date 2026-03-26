"use client";

import { useCallback, useMemo, useState } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { SectionHeader } from "../controls/SectionHeader";
import { SliderControl } from "../controls/SliderControl";
import { SpeedRampEditor } from "./SpeedRampEditor";

const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2] as const;

interface SpeedSectionProps {
  clipId: string;
  clipDuration?: number;
}

export function SpeedSection({ clipId, clipDuration }: SpeedSectionProps) {
  const [pitchCorrection, setPitchCorrection] = useState(true);
  const [showRamp, setShowRamp] = useState(false);

  const speedEffect = useEditorStore((s) => {
    for (const track of s.project.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) {
        return clip.effects.find((e) => e.effectId === "playback_speed") ?? null;
      }
    }
    return null;
  });

  const addEffect = useEditorStore((s) => s.addEffect);
  const updateEffect = useEditorStore((s) => s.updateEffect);
  const removeEffect = useEditorStore((s) => s.removeEffect);
  const freezeFrame = useEditorStore((s) => s.freezeFrame);
  const currentTime = useEditorStore((s) => s.playback.currentTime);

  const rate = speedEffect?.parameters.rate ?? 1.0;

  const handleRateChange = useCallback(
    (newRate: number) => {
      if (!speedEffect) {
        addEffect(clipId, "playback_speed", { rate: newRate });
      } else {
        updateEffect(clipId, speedEffect.id, { rate: newRate });
      }
    },
    [clipId, speedEffect, addEffect, updateEffect],
  );

  const handleReset = useCallback(() => {
    if (speedEffect) {
      removeEffect(clipId, speedEffect.id);
    }
  }, [clipId, speedEffect, removeEffect]);

  const handleFreezeFrame = useCallback(() => {
    freezeFrame(clipId, currentTime, 2.0);
  }, [clipId, currentTime, freezeFrame]);

  const speedEffectId = speedEffect?.id;
  const keyframeConfig = useMemo(
    () => clipDuration && clipDuration > 0 && speedEffectId
      ? { clipId, effectId: speedEffectId, parameterId: "rate", clipDuration }
      : undefined,
    [clipId, clipDuration, speedEffectId],
  );

  return (
    <SectionHeader title="SPEED" onReset={handleReset}>
      <SliderControl
        label="Speed"
        value={rate * 100}
        defaultValue={100}
        min={10}
        max={400}
        step={5}
        unit="%"
        onChange={(v) => handleRateChange(v / 100)}
        keyframeConfig={keyframeConfig}
      />

      <div className="flex items-center gap-1.5 mt-2 px-1">
        {SPEED_PRESETS.map((preset) => {
          const isActive = rate === preset;
          return (
            <button
              key={preset}
              type="button"
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                isActive
                  ? "text-blue-400 bg-blue-500/10"
                  : "text-neutral-500 hover:text-neutral-300 bg-neutral-800/50"
              }`}
              onClick={() => handleRateChange(preset)}
            >
              {preset}x
            </button>
          );
        })}
      </div>

      {rate !== 1.0 && (
        <label className="flex items-center gap-2 mt-2 px-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={pitchCorrection}
            onChange={(e) => setPitchCorrection(e.target.checked)}
            className="accent-blue-500 w-3 h-3"
          />
          <span className="text-[10px] text-neutral-400">
            Maintain Audio Pitch
          </span>
        </label>
      )}

      {speedEffect && clipDuration && clipDuration > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowRamp((v) => !v)}
            className="text-[10px] px-2 py-0.5 rounded text-neutral-400 hover:text-neutral-200 bg-neutral-800/50 hover:bg-neutral-700/50 transition-colors"
          >
            {showRamp ? "Hide Speed Ramp" : "Show Speed Ramp"}
          </button>
          {showRamp && (
            <div className="mt-1.5">
              <SpeedRampEditor
                clipId={clipId}
                effectId={speedEffect.id}
                clipDuration={clipDuration}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-2">
        <button
          type="button"
          onClick={handleFreezeFrame}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-neutral-400 hover:text-neutral-200 bg-neutral-800/50 hover:bg-neutral-700/50 transition-colors flex-1"
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="8" r="6" />
            <line x1="8" y1="2" x2="8" y2="14" />
            <line x1="2" y1="8" x2="14" y2="8" />
            <line x1="3.8" y1="3.8" x2="12.2" y2="12.2" />
            <line x1="12.2" y1="3.8" x2="3.8" y2="12.2" />
          </svg>
          <span>Freeze Frame</span>
        </button>
      </div>
      <p className="text-[10px] text-neutral-600 italic mt-0.5 px-1">
        Inserts a 2s freeze at playhead
      </p>
    </SectionHeader>
  );
}
