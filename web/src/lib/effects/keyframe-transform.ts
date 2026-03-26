import type { Transform } from '@/types/editor';
import { DEFAULT_TRANSFORM } from '@/types/editor';
import type { AppliedEffect, KeyframeInterpolation } from '@/types/effects';

function applyEasing(t: number, interp: KeyframeInterpolation): number {
  switch (interp) {
    case 'linear':
      return t;
    case 'hold':
      return 0;
    case 'ease_in':
      return t * t;
    case 'ease_out':
      return 1 - (1 - t) * (1 - t);
    case 'bezier':
      return t; // Simplified for now
    default:
      return t;
  }
}

function getValueAtTime(
  effect: AppliedEffect,
  parameterId: string,
  clipTime: number
): number {
  const keyframes = effect.keyframes.filter(
    (k) => k.parameterId === parameterId
  );
  if (keyframes.length === 0) {
    return effect.parameters[parameterId] ?? 0;
  }

  const sorted = keyframes.sort((a, b) => a.time - b.time);

  if (clipTime <= sorted[0].time) return sorted[0].value;
  if (clipTime >= sorted[sorted.length - 1].time)
    return sorted[sorted.length - 1].value;

  let left = sorted[0];
  let right = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (clipTime >= sorted[i].time && clipTime <= sorted[i + 1].time) {
      left = sorted[i];
      right = sorted[i + 1];
      break;
    }
  }

  const duration = right.time - left.time;
  if (duration === 0) return left.value;
  const t = (clipTime - left.time) / duration;

  const easedT = applyEasing(t, left.interpolation);
  return left.value + (right.value - left.value) * easedT;
}

/**
 * Compute a Transform from effects at a specific clip-relative time.
 * For each effect parameter, if keyframes exist for that parameter,
 * the interpolated value is used; otherwise the static parameter value is used.
 */
export function effectsToTransformAtTime(
  effects: AppliedEffect[],
  clipTime: number
): Transform {
  const transform: Transform = {
    ...DEFAULT_TRANSFORM,
    filters: { ...DEFAULT_TRANSFORM.filters },
  };

  for (const effect of effects) {
    if (!effect.enabled) continue;

    switch (effect.effectId) {
      case 'scale':
        transform.scale = getValueAtTime(effect, 'scale', clipTime);
        break;
      case 'position':
        transform.positionX = getValueAtTime(effect, 'positionX', clipTime);
        transform.positionY = getValueAtTime(effect, 'positionY', clipTime);
        break;
      case 'rotation':
        transform.rotation = getValueAtTime(effect, 'degrees', clipTime);
        break;
      case 'opacity':
        transform.opacity = getValueAtTime(effect, 'opacity', clipTime);
        break;
      case 'gaussian_blur':
        transform.filters.blur = getValueAtTime(effect, 'sigma', clipTime);
        break;
      case 'brightness':
        transform.filters.brightness =
          getValueAtTime(effect, 'brightness', clipTime) + 1.0;
        break;
      case 'contrast':
        transform.filters.contrast = getValueAtTime(
          effect,
          'contrast',
          clipTime
        );
        break;
      case 'saturation':
        transform.filters.saturate = getValueAtTime(
          effect,
          'saturation',
          clipTime
        );
        break;
      case 'grayscale':
        transform.filters.grayscale = getValueAtTime(
          effect,
          'amount',
          clipTime
        );
        break;
      case 'sepia':
        transform.filters.sepia = getValueAtTime(effect, 'amount', clipTime);
        break;
      case 'hue_rotate':
        transform.filters.hueRotate = getValueAtTime(
          effect,
          'degrees',
          clipTime
        );
        break;
    }
  }

  return transform;
}

/**
 * Returns true if any effect in the array has keyframes.
 */
export function hasAnyKeyframes(effects: AppliedEffect[]): boolean {
  return effects.some((e) => e.keyframes.length > 0);
}
