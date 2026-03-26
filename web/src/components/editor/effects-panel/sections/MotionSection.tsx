"use client";

import { useMemo } from "react";
import { SliderControl } from "../controls/SliderControl";
import { SectionHeader } from "../controls/SectionHeader";
import { useEditorStore } from "@/lib/store/editor-store";
import type { Transform, ClipProvenance } from "@/types/editor";

interface MotionSectionProps {
  clipId: string;
  transform: Transform;
  provenance?: ClipProvenance;
  clipDuration?: number;
}

export function MotionSection({ clipId, transform, provenance, clipDuration = 0 }: MotionSectionProps) {
  const updateTransform = useEditorStore((s) => s.updateTransform);
  const resetTransform = useEditorStore((s) => s.resetTransform);

  const kfPosition = useMemo(() => clipDuration > 0 ? { clipId, effectId: "builtin-position", parameterId: "positionX", clipDuration } : undefined, [clipId, clipDuration]);
  const kfPositionY = useMemo(() => clipDuration > 0 ? { clipId, effectId: "builtin-position", parameterId: "positionY", clipDuration } : undefined, [clipId, clipDuration]);
  const kfScale = useMemo(() => clipDuration > 0 ? { clipId, effectId: "builtin-scale", parameterId: "scale", clipDuration } : undefined, [clipId, clipDuration]);
  const kfRotation = useMemo(() => clipDuration > 0 ? { clipId, effectId: "builtin-rotation", parameterId: "degrees", clipDuration } : undefined, [clipId, clipDuration]);

  return (
    <SectionHeader title="MOTION" onReset={() => resetTransform(clipId)}>
      <div className="space-y-1">
        <SliderControl
          label="Position X"
          value={transform.positionX}
          defaultValue={0}
          min={-1920}
          max={1920}
          step={1}
          unit="px"
          onChange={(v) => updateTransform(clipId, { positionX: v })}
          provenance={provenance?.["transform.positionX"]}
          keyframeConfig={kfPosition}
        />
        <SliderControl
          label="Position Y"
          value={transform.positionY}
          defaultValue={0}
          min={-1080}
          max={1080}
          step={1}
          unit="px"
          onChange={(v) => updateTransform(clipId, { positionY: v })}
          provenance={provenance?.["transform.positionY"]}
          keyframeConfig={kfPositionY}
        />
        <SliderControl
          label="Scale"
          value={transform.scale * 100}
          defaultValue={100}
          min={10}
          max={400}
          step={1}
          unit="%"
          onChange={(v) => updateTransform(clipId, { scale: v / 100 })}
          provenance={provenance?.["transform.scale"] ? {
            ...provenance["transform.scale"],
            previousValue: provenance["transform.scale"].previousValue != null
              ? Number(provenance["transform.scale"].previousValue) * 100
              : null,
          } : undefined}
          keyframeConfig={kfScale}
        />
        <SliderControl
          label="Rotation"
          value={transform.rotation}
          defaultValue={0}
          min={-360}
          max={360}
          step={0.1}
          unit="°"
          onChange={(v) => updateTransform(clipId, { rotation: v })}
          provenance={provenance?.["transform.rotation"]}
          keyframeConfig={kfRotation}
        />
      </div>
    </SectionHeader>
  );
}
