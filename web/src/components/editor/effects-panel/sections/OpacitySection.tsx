"use client";

import { useMemo } from "react";
import { SliderControl } from "../controls/SliderControl";
import { SectionHeader } from "../controls/SectionHeader";
import { useEditorStore } from "@/lib/store/editor-store";
import type { ClipProvenance } from "@/types/editor";

interface OpacitySectionProps {
  clipId: string;
  opacity: number;
  provenance?: ClipProvenance;
  clipDuration?: number;
}

export function OpacitySection({ clipId, opacity, provenance, clipDuration = 0 }: OpacitySectionProps) {
  const updateTransform = useEditorStore((s) => s.updateTransform);

  const kfOpacity = useMemo(() => clipDuration > 0 ? { clipId, effectId: "builtin-opacity", parameterId: "opacity", clipDuration } : undefined, [clipId, clipDuration]);

  return (
    <SectionHeader
      title="OPACITY"
      onReset={() => updateTransform(clipId, { opacity: 1.0 })}
    >
      <div className="space-y-1">
        <SliderControl
          label="Opacity"
          value={opacity * 100}
          defaultValue={100}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(v) => updateTransform(clipId, { opacity: v / 100 })}
          provenance={provenance?.["transform.opacity"] ? {
            ...provenance["transform.opacity"],
            previousValue: provenance["transform.opacity"].previousValue != null
              ? Number(provenance["transform.opacity"].previousValue) * 100
              : null,
          } : undefined}
          keyframeConfig={kfOpacity}
        />
      </div>
    </SectionHeader>
  );
}
