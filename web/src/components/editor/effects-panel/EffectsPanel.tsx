"use client";

import { useEditorStore } from "@/lib/store/editor-store";
import type { Clip, Track, MediaFile } from "@/types/editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useClipProvenance } from "@/hooks/useProvenance";
import { ClipHeader } from "./ClipHeader";
import { MultiClipHeader } from "./MultiClipHeader";
import { MotionSection } from "./sections/MotionSection";
import { OpacitySection } from "./sections/OpacitySection";
import { SpeedSection } from "./sections/SpeedSection";
import { EffectStack } from "./sections/EffectStack";
import { AIChangesBar } from "./ai/AIChangesBar";
import { SectionHeader } from "./controls/SectionHeader";
import { SliderControl } from "./controls/SliderControl";

export function EffectsPanel() {
  const selectedClipIds = useEditorStore((s) => s.ui.selectedClipIds);
  const getClipById = useEditorStore((s) => s.getClipById);
  const getClipEffects = useEditorStore((s) => s.getClipEffects);
  const tracks = useEditorStore((s) => s.project.tracks);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const batchUpdateTransform = useEditorStore((s) => s.batchUpdateTransform);

  const isMultiSelect = selectedClipIds.length > 1;

  const selectedClips = isMultiSelect
    ? selectedClipIds
        .map((id) => getClipById(id))
        .filter((c): c is Clip => c !== null)
    : [];

  const primaryClipId = selectedClipIds[0] ?? null;
  const clip = primaryClipId ? getClipById(primaryClipId) : null;

  let containingTrack: Track | null = null;
  if (clip) {
    for (const track of tracks) {
      if (track.clips.some((c) => c.id === clip.id)) {
        containingTrack = track;
        break;
      }
    }
  }

  const mediaFile: MediaFile | undefined = clip
    ? mediaFiles.get(clip.sourceFileId)
    : undefined;

  const effects = clip ? getClipEffects(clip.id) : [];
  const provenance = useClipProvenance(primaryClipId);
  const clipDuration = clip ? clip.sourceEnd - clip.sourceStart : 0;

  // Read the latest primary clip transform from the store to avoid stale
  // closures when the slider fires multiple onChange events between renders.
  const getPrimaryTransform = () => {
    if (!primaryClipId) return null;
    return useEditorStore.getState().getClipById(primaryClipId)?.transform ?? null;
  };

  // ── Multi-clip editing ──
  if (isMultiSelect && selectedClips.length > 1) {
    const primary = selectedClips[0];
    const pt = primary.transform;

    return (
      <div className="flex flex-col h-full bg-neutral-900 border-l border-neutral-800">
        <div className="shrink-0 px-3 pt-3 pb-2">
          <MultiClipHeader
            clips={selectedClips.map((c) => ({ id: c.id, type: c.type }))}
          />
        </div>

        <ScrollArea className="flex-1">
          <div className="px-3 pb-4">
            <SectionHeader title="MOTION">
              <div className="space-y-1">
                <SliderControl
                  label="Position X"
                  value={pt.positionX}
                  defaultValue={0}
                  min={-1920}
                  max={1920}
                  step={1}
                  unit="px"
                  onChange={(v) => {
                    const t = getPrimaryTransform();
                    if (!t) return;
                    const delta = v - t.positionX;
                    if (delta !== 0) batchUpdateTransform(selectedClipIds, { positionX: delta });
                  }}
                />
                <SliderControl
                  label="Position Y"
                  value={pt.positionY}
                  defaultValue={0}
                  min={-1080}
                  max={1080}
                  step={1}
                  unit="px"
                  onChange={(v) => {
                    const t = getPrimaryTransform();
                    if (!t) return;
                    const delta = v - t.positionY;
                    if (delta !== 0) batchUpdateTransform(selectedClipIds, { positionY: delta });
                  }}
                />
                <SliderControl
                  label="Scale"
                  value={pt.scale * 100}
                  defaultValue={100}
                  min={10}
                  max={400}
                  step={1}
                  unit="%"
                  onChange={(v) => {
                    const t = getPrimaryTransform();
                    if (!t) return;
                    const delta = (v - t.scale * 100) / 100;
                    if (delta !== 0) batchUpdateTransform(selectedClipIds, { scale: delta });
                  }}
                />
                <SliderControl
                  label="Rotation"
                  value={pt.rotation}
                  defaultValue={0}
                  min={-360}
                  max={360}
                  step={0.1}
                  unit="°"
                  onChange={(v) => {
                    const t = getPrimaryTransform();
                    if (!t) return;
                    const delta = v - t.rotation;
                    if (delta !== 0) batchUpdateTransform(selectedClipIds, { rotation: delta });
                  }}
                />
              </div>
            </SectionHeader>

            <SectionHeader title="OPACITY">
              <div className="space-y-1">
                <SliderControl
                  label="Opacity"
                  value={pt.opacity * 100}
                  defaultValue={100}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  onChange={(v) => {
                    const t = getPrimaryTransform();
                    if (!t) return;
                    const delta = (v - t.opacity * 100) / 100;
                    if (delta !== 0) batchUpdateTransform(selectedClipIds, { opacity: delta });
                  }}
                />
              </div>
            </SectionHeader>
          </div>
        </ScrollArea>

        <div className="shrink-0 border-t border-neutral-800 px-3 py-2">
          <p className="text-[10px] text-neutral-500 text-center">
            Changes apply to all {selectedClips.length} selected clips
          </p>
        </div>
      </div>
    );
  }

  // ── No selection ──
  if (!clip) {
    return (
      <div className="flex flex-col h-full bg-neutral-900 border-l border-neutral-800">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
          <EmptyIcon />
          <p className="text-sm text-neutral-500 text-center leading-relaxed">
            Select a clip on the timeline to view its effects
          </p>
        </div>
      </div>
    );
  }

  // ── Single-clip editing ──
  return (
    <div className="flex flex-col h-full bg-neutral-900 border-l border-neutral-800">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <ClipHeader
          clip={clip}
          track={containingTrack}
          mediaFile={mediaFile ?? null}
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 pb-4">
          <MotionSection clipId={clip.id} transform={clip.transform} provenance={provenance} clipDuration={clipDuration} />
          <OpacitySection clipId={clip.id} opacity={clip.transform.opacity} provenance={provenance} clipDuration={clipDuration} />
          <SpeedSection clipId={clip.id} clipDuration={clipDuration} />
          <EffectStack clipId={clip.id} effects={effects} provenance={provenance} clipDuration={clipDuration} />
        </div>
      </ScrollArea>

      <AIChangesBar clipId={clip.id} provenance={provenance} />
    </div>
  );
}

function EmptyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-10 h-10 text-neutral-600"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}
