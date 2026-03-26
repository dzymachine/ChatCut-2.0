"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/store/editor-store";
import type { AppliedEffect, ClipProvenance } from "@/types/editor";
import { EffectSection } from "./EffectSection";
import { EffectBrowser } from "../EffectBrowser";

interface EffectStackProps {
  clipId: string;
  effects: AppliedEffect[];
  provenance?: ClipProvenance;
  clipDuration?: number;
}

export function EffectStack({ clipId, effects, provenance, clipDuration = 0 }: EffectStackProps) {
  const [showBrowser, setShowBrowser] = useState(false);
  const reorderEffects = useEditorStore((s) => s.reorderEffects);

  const userEffects = effects.filter((e) => !e.id.startsWith("builtin-"));

  function moveEffect(index: number, direction: -1 | 1) {
    const effectIds = effects.map((e) => e.id);
    const fullIndex = effects.findIndex((e) => e.id === userEffects[index].id);
    const targetIndex = fullIndex + direction;
    if (targetIndex < 0 || targetIndex >= effects.length) return;
    [effectIds[fullIndex], effectIds[targetIndex]] = [
      effectIds[targetIndex],
      effectIds[fullIndex],
    ];
    reorderEffects(clipId, effectIds);
  }

  return (
    <div className="py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 px-1 pb-1.5">
        Effects
      </div>

      {userEffects.map((effect, i) => (
        <EffectSection
          key={effect.id}
          clipId={clipId}
          effect={effect}
          isFirst={i === 0}
          isLast={i === userEffects.length - 1}
          onMoveUp={() => moveEffect(i, -1)}
          onMoveDown={() => moveEffect(i, 1)}
          provenance={provenance}
          clipDuration={clipDuration}
        />
      ))}

      <button
        type="button"
        className="w-full py-2 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40 rounded-md border border-dashed border-neutral-700 transition-colors"
        onClick={() => setShowBrowser((v) => !v)}
      >
        + Add Effect
      </button>

      {showBrowser && <EffectBrowser clipId={clipId} onClose={() => setShowBrowser(false)} />}
    </div>
  );
}
