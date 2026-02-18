/**
 * ChatCut — Effect ↔ Transform Bridge
 *
 * Provides bidirectional conversion between the new AppliedEffect[] system
 * and the legacy Transform + FilterState fields.
 *
 * During Phase 1 (Canvas 2D preview), the video engine reads clip.transform.
 * The bridge ensures that when effects change, the transform stays in sync,
 * and vice versa.
 *
 * In Phase 2 (WebGL), the video engine will read effects directly and this
 * bridge becomes unnecessary.
 */

import type { Transform, FilterState } from '@/types/editor';
import type { AppliedEffect } from '@/types/effects';
import { DEFAULT_TRANSFORM } from '@/types/editor';

/**
 * Compute a legacy Transform from an AppliedEffect array.
 * Used to keep the video engine's transform reading in sync with effects.
 */
export function effectsToTransform(effects: AppliedEffect[]): Transform {
  const transform: Transform = { ...DEFAULT_TRANSFORM, filters: { ...DEFAULT_TRANSFORM.filters } };

  for (const effect of effects) {
    if (!effect.enabled) continue;

    switch (effect.effectId) {
      case 'scale':
        transform.scale = effect.parameters.scale ?? 1.0;
        break;
      case 'position':
        transform.positionX = effect.parameters.positionX ?? 0;
        transform.positionY = effect.parameters.positionY ?? 0;
        break;
      case 'rotation':
        transform.rotation = effect.parameters.degrees ?? 0;
        break;
      case 'opacity':
        transform.opacity = effect.parameters.opacity ?? 1.0;
        break;
      case 'gaussian_blur':
        transform.filters.blur = effect.parameters.sigma ?? 0;
        break;
      case 'brightness':
        transform.filters.brightness = effect.parameters.brightness ?? 1.0;
        break;
      case 'contrast':
        transform.filters.contrast = effect.parameters.contrast ?? 1.0;
        break;
      case 'saturation':
        transform.filters.saturate = effect.parameters.saturation ?? 1.0;
        break;
      case 'grayscale':
        transform.filters.grayscale = effect.parameters.amount ?? 0;
        break;
      case 'sepia':
        transform.filters.sepia = effect.parameters.amount ?? 0;
        break;
      case 'hue_rotate':
        transform.filters.hueRotate = effect.parameters.degrees ?? 0;
        break;
    }
  }

  return transform;
}

/**
 * Convert a legacy Transform into the corresponding built-in AppliedEffect array.
 * Used when loading legacy projects or when the UI updates transform directly.
 */
export function transformToEffects(transform: Transform): AppliedEffect[] {
  const effects: AppliedEffect[] = [];

  // Scale
  effects.push({
    id: 'builtin-scale',
    effectId: 'scale',
    parameters: { scale: transform.scale },
    keyframes: [],
    enabled: true,
  });

  // Position
  effects.push({
    id: 'builtin-position',
    effectId: 'position',
    parameters: { positionX: transform.positionX, positionY: transform.positionY },
    keyframes: [],
    enabled: true,
  });

  // Rotation
  effects.push({
    id: 'builtin-rotation',
    effectId: 'rotation',
    parameters: { degrees: transform.rotation },
    keyframes: [],
    enabled: true,
  });

  // Opacity
  effects.push({
    id: 'builtin-opacity',
    effectId: 'opacity',
    parameters: { opacity: transform.opacity },
    keyframes: [],
    enabled: true,
  });

  // Filters → individual effects
  const f = transform.filters;

  if (f.blur > 0) {
    effects.push({
      id: 'builtin-blur',
      effectId: 'gaussian_blur',
      parameters: { sigma: f.blur },
      keyframes: [],
      enabled: true,
    });
  }

  if (f.brightness !== 1.0) {
    effects.push({
      id: 'builtin-brightness',
      effectId: 'brightness',
      // Convert CSS brightness (multiplier around 1.0) to FFmpeg eq brightness (offset around 0)
      parameters: { brightness: f.brightness - 1.0 },
      keyframes: [],
      enabled: true,
    });
  }

  if (f.contrast !== 1.0) {
    effects.push({
      id: 'builtin-contrast',
      effectId: 'contrast',
      parameters: { contrast: f.contrast },
      keyframes: [],
      enabled: true,
    });
  }

  if (f.saturate !== 1.0) {
    effects.push({
      id: 'builtin-saturation',
      effectId: 'saturation',
      parameters: { saturation: f.saturate },
      keyframes: [],
      enabled: true,
    });
  }

  if (f.grayscale > 0) {
    effects.push({
      id: 'builtin-grayscale',
      effectId: 'grayscale',
      parameters: { amount: f.grayscale },
      keyframes: [],
      enabled: true,
    });
  }

  if (f.sepia > 0) {
    effects.push({
      id: 'builtin-sepia',
      effectId: 'sepia',
      parameters: { amount: f.sepia },
      keyframes: [],
      enabled: true,
    });
  }

  if (f.hueRotate !== 0) {
    effects.push({
      id: 'builtin-hue-rotate',
      effectId: 'hue_rotate',
      parameters: { degrees: f.hueRotate },
      keyframes: [],
      enabled: true,
    });
  }

  return effects;
}

/**
 * Create the default built-in effects array for a new clip.
 * These represent scale=1, position=0,0, rotation=0, opacity=1 — all at defaults.
 */
export function createDefaultEffects(): AppliedEffect[] {
  return [
    {
      id: 'builtin-scale',
      effectId: 'scale',
      parameters: { scale: 1.0 },
      keyframes: [],
      enabled: true,
    },
    {
      id: 'builtin-position',
      effectId: 'position',
      parameters: { positionX: 0, positionY: 0 },
      keyframes: [],
      enabled: true,
    },
    {
      id: 'builtin-rotation',
      effectId: 'rotation',
      parameters: { degrees: 0 },
      keyframes: [],
      enabled: true,
    },
    {
      id: 'builtin-opacity',
      effectId: 'opacity',
      parameters: { opacity: 1.0 },
      keyframes: [],
      enabled: true,
    },
  ];
}

/**
 * Find or create a built-in effect in an effects array by effect ID.
 * Used when the legacy system needs to update a built-in effect.
 */
export function findOrCreateBuiltinEffect(
  effects: AppliedEffect[],
  effectId: string
): { effect: AppliedEffect; index: number; isNew: boolean } {
  const index = effects.findIndex((e) => e.effectId === effectId && e.id.startsWith('builtin-'));
  if (index >= 0) {
    return { effect: effects[index], index, isNew: false };
  }

  // Create a new built-in effect
  const effect: AppliedEffect = {
    id: `builtin-${effectId}`,
    effectId,
    parameters: {},
    keyframes: [],
    enabled: true,
  };

  return { effect, index: -1, isNew: true };
}
