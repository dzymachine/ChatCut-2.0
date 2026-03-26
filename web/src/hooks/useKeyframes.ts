import { useMemo } from 'react';
import { useEditorStore } from '@/lib/store/editor-store';
import { useShallow } from 'zustand/react/shallow';
import { interpolateValue, hasKeyframes } from '@/lib/effects/interpolation';
import type { EffectKeyframe } from '@/types/effects';

const EMPTY_KEYFRAMES: EffectKeyframe[] = [];

/**
 * Returns all keyframes for a specific parameter of an effect on a clip.
 */
export function usePropertyKeyframes(
  clipId: string | null,
  effectId: string,
  parameterId: string,
): EffectKeyframe[] {
  return useEditorStore(
    useShallow((state) => {
      if (!clipId) return EMPTY_KEYFRAMES;
      for (const track of state.project.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          const effect = clip.effects.find((e) => e.id === effectId);
          if (effect) {
            const filtered = effect.keyframes.filter((kf) => kf.parameterId === parameterId);
            return filtered.length > 0 ? filtered : EMPTY_KEYFRAMES;
          }
          return EMPTY_KEYFRAMES;
        }
      }
      return EMPTY_KEYFRAMES;
    })
  );
}

const PLAYHEAD_TOLERANCE = 0.05;

/**
 * Returns the keyframe at (or very near) the current playhead position,
 * or null if no keyframe exists within ±0.05s tolerance.
 */
export function useKeyframeAtPlayhead(
  clipId: string | null,
  effectId: string,
  parameterId: string,
): EffectKeyframe | null {
  const keyframes = usePropertyKeyframes(clipId, effectId, parameterId);
  const currentTime = useEditorStore((state) => state.playback.currentTime);

  const clipStart = useEditorStore(
    useShallow((state) => {
      if (!clipId) return 0;
      for (const track of state.project.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) return clip.timelineStart;
      }
      return 0;
    })
  );

  return useMemo(() => {
    const relativeTime = currentTime - clipStart;
    for (const kf of keyframes) {
      if (Math.abs(kf.time - relativeTime) <= PLAYHEAD_TOLERANCE) {
        return kf;
      }
    }
    return null;
  }, [keyframes, currentTime, clipStart]);
}

/**
 * Returns the interpolated value for a parameter at the current playhead time.
 * Falls back to `fallbackValue` when no keyframes exist or interpolation returns null.
 */
export function useInterpolatedValue(
  clipId: string | null,
  effectId: string,
  parameterId: string,
  fallbackValue: number,
): number {
  const currentTime = useEditorStore((state) => state.playback.currentTime);

  const clipData = useEditorStore(
    useShallow((state) => {
      if (!clipId) return null;
      for (const track of state.project.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          const effect = clip.effects.find((e) => e.id === effectId);
          if (effect) {
            return { timelineStart: clip.timelineStart, keyframes: effect.keyframes };
          }
        }
      }
      return null;
    })
  );

  return useMemo(() => {
    if (!clipData) return fallbackValue;
    if (!hasKeyframes(clipData.keyframes, parameterId)) return fallbackValue;

    const relativeTime = currentTime - clipData.timelineStart;
    const result = interpolateValue(clipData.keyframes, relativeTime, parameterId);
    return result ?? fallbackValue;
  }, [clipData, currentTime, parameterId, fallbackValue]);
}
