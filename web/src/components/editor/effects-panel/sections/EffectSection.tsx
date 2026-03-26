"use client";

import { useMemo } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import { getEffectDescriptor } from "@/lib/effects/registry";
import type { AppliedEffect, ClipProvenance } from "@/types/editor";
import { SliderControl } from "../controls/SliderControl";

interface EffectSectionProps {
  clipId: string;
  effect: AppliedEffect;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  provenance?: ClipProvenance;
  clipDuration?: number;
}

export function EffectSection({
  clipId,
  effect,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  provenance,
  clipDuration = 0,
}: EffectSectionProps) {
  const toggleEffect = useEditorStore((s) => s.toggleEffect);
  const updateEffect = useEditorStore((s) => s.updateEffect);
  const removeEffect = useEditorStore((s) => s.removeEffect);
  const descriptor = getEffectDescriptor(effect.effectId);

  if (!descriptor) {
    return (
      <div className="rounded-md border border-yellow-700/60 bg-yellow-900/20 px-2 py-1.5 mb-2 text-[11px] text-yellow-400">
        Unknown effect: {effect.effectId}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-neutral-800/60 bg-neutral-800/20 mb-2">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-neutral-800/40">
        <div className="flex items-center gap-1.5">
          {/* Enable/disable checkbox */}
          <button
            type="button"
            className={`w-3.5 h-3.5 rounded border flex items-center justify-center cursor-pointer transition-colors ${
              effect.enabled
                ? "bg-blue-500 border-blue-500"
                : "bg-transparent border-neutral-600"
            }`}
            onClick={() => toggleEffect(clipId, effect.id, !effect.enabled)}
            aria-label={effect.enabled ? "Disable effect" : "Enable effect"}
          >
            {effect.enabled && (
              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 5.5L4 7.5L8 3" />
              </svg>
            )}
          </button>

          {/* Effect name */}
          <span className="text-[11px] font-medium text-neutral-300 select-none">
            {descriptor.name}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {/* Move up */}
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-300 disabled:opacity-30 transition-colors"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label="Move effect up"
          >
            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="currentColor">
              <path d="M5 2L1 7h8L5 2z" />
            </svg>
          </button>

          {/* Move down */}
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-neutral-300 disabled:opacity-30 transition-colors"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label="Move effect down"
          >
            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="currentColor">
              <path d="M5 8L1 3h8L5 8z" />
            </svg>
          </button>

          {/* Remove */}
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center text-neutral-500 hover:text-red-400 transition-colors"
            onClick={() => removeEffect(clipId, effect.id)}
            aria-label="Remove effect"
          >
            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Parameter controls */}
      <div className={`px-2 py-1.5 space-y-1 ${!effect.enabled ? "opacity-50 pointer-events-none" : ""}`}>
        {descriptor.parameters.map((param) => (
          <EffectParam
            key={param.id}
            clipId={clipId}
            effectId={effect.id}
            param={param}
            value={effect.parameters[param.id] ?? param.default}
            clipDuration={clipDuration}
            provenance={provenance?.[`effect:${effect.id}.${param.id}`]}
            updateEffect={updateEffect}
          />
        ))}
      </div>
    </div>
  );
}

function EffectParam({
  clipId, effectId, param, value, clipDuration, provenance, updateEffect,
}: {
  clipId: string;
  effectId: string;
  param: { id: string; name: string; default: number; min?: number; max?: number; step?: number };
  value: number;
  clipDuration: number;
  provenance: import("@/types/editor").ProvenanceEntry | undefined;
  updateEffect: (clipId: string, effectId: string, params: Record<string, number>) => void;
}) {
  const kf = useMemo(
    () => clipDuration > 0 ? { clipId, effectId, parameterId: param.id, clipDuration } : undefined,
    [clipId, effectId, param.id, clipDuration],
  );
  return (
    <SliderControl
      label={param.name}
      value={value}
      defaultValue={param.default}
      min={param.min ?? 0}
      max={param.max ?? 100}
      step={param.step ?? 0.01}
      onChange={(v) => updateEffect(clipId, effectId, { [param.id]: v })}
      provenance={provenance}
      keyframeConfig={kf}
    />
  );
}
