/**
 * ChatCut — Effect Registry
 *
 * Central registry of all available effects. Each effect is defined as an
 * EffectDescriptor with its parameters, FFmpeg mapping, and defaults.
 *
 * Adding a new effect:
 *   1. Create the descriptor below
 *   2. Register it in EFFECT_REGISTRY
 *   3. If it needs custom FFmpeg mapping, add it in ffmpeg-mapper.ts
 *   4. The AI will pick it up via the function schemas automatically
 */

import type { EffectDescriptor } from '@/types/effects';

// ─── Transform Effects (5) ──────────────────────────────────────────────────

const SCALE: EffectDescriptor = {
  id: 'scale',
  name: 'Scale / Zoom',
  category: 'transform',
  builtIn: true,
  ffmpegFilter: 'scale',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'scale',
      name: 'Scale',
      type: 'number',
      min: 0.1,
      max: 10,
      step: 0.01,
      default: 1.0,
      ffmpegParam: 'scale',
    },
  ],
};

const POSITION: EffectDescriptor = {
  id: 'position',
  name: 'Position / Pan',
  category: 'transform',
  builtIn: true,
  ffmpegFilter: 'pad',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'positionX',
      name: 'Position X',
      type: 'number',
      min: -3840,
      max: 3840,
      step: 1,
      default: 0,
      ffmpegParam: 'x',
    },
    {
      id: 'positionY',
      name: 'Position Y',
      type: 'number',
      min: -2160,
      max: 2160,
      step: 1,
      default: 0,
      ffmpegParam: 'y',
    },
  ],
};

const ROTATION: EffectDescriptor = {
  id: 'rotation',
  name: 'Rotation',
  category: 'transform',
  builtIn: true,
  ffmpegFilter: 'rotate',
  parameters: [
    {
      id: 'degrees',
      name: 'Rotation',
      type: 'number',
      min: -360,
      max: 360,
      step: 0.1,
      default: 0,
      ffmpegParam: 'angle',
    },
  ],
};

const OPACITY: EffectDescriptor = {
  id: 'opacity',
  name: 'Opacity',
  category: 'transform',
  builtIn: true,
  ffmpegFilter: 'colorchannelmixer',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'opacity',
      name: 'Opacity',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1.0,
      ffmpegParam: 'aa',
    },
  ],
};

const CROP: EffectDescriptor = {
  id: 'crop',
  name: 'Crop',
  category: 'transform',
  ffmpegFilter: 'crop',
  parameters: [
    {
      id: 'width',
      name: 'Width',
      type: 'number',
      min: 1,
      max: 7680,
      step: 1,
      default: 1920,
      ffmpegParam: 'w',
    },
    {
      id: 'height',
      name: 'Height',
      type: 'number',
      min: 1,
      max: 4320,
      step: 1,
      default: 1080,
      ffmpegParam: 'h',
    },
    {
      id: 'x',
      name: 'Offset X',
      type: 'number',
      min: 0,
      max: 7680,
      step: 1,
      default: 0,
      ffmpegParam: 'x',
    },
    {
      id: 'y',
      name: 'Offset Y',
      type: 'number',
      min: 0,
      max: 4320,
      step: 1,
      default: 0,
      ffmpegParam: 'y',
    },
  ],
};

// ─── Color Correction Effects (7) ───────────────────────────────────────────

const BRIGHTNESS: EffectDescriptor = {
  id: 'brightness',
  name: 'Brightness',
  category: 'color',
  ffmpegFilter: 'eq',
  parameters: [
    {
      id: 'brightness',
      name: 'Brightness',
      type: 'number',
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
      ffmpegParam: 'brightness',
    },
  ],
};

const CONTRAST: EffectDescriptor = {
  id: 'contrast',
  name: 'Contrast',
  category: 'color',
  ffmpegFilter: 'eq',
  parameters: [
    {
      id: 'contrast',
      name: 'Contrast',
      type: 'number',
      min: 0,
      max: 3,
      step: 0.01,
      default: 1.0,
      ffmpegParam: 'contrast',
    },
  ],
};

const SATURATION: EffectDescriptor = {
  id: 'saturation',
  name: 'Saturation',
  category: 'color',
  ffmpegFilter: 'eq',
  parameters: [
    {
      id: 'saturation',
      name: 'Saturation',
      type: 'number',
      min: 0,
      max: 3,
      step: 0.01,
      default: 1.0,
      ffmpegParam: 'saturation',
    },
  ],
};

const EXPOSURE: EffectDescriptor = {
  id: 'exposure',
  name: 'Exposure',
  category: 'color',
  ffmpegFilter: 'exposure',
  parameters: [
    {
      id: 'exposure',
      name: 'Exposure',
      type: 'number',
      min: -3,
      max: 3,
      step: 0.01,
      default: 0,
      ffmpegParam: 'exposure',
    },
  ],
};

const COLOR_TEMPERATURE: EffectDescriptor = {
  id: 'color_temperature',
  name: 'Color Temperature',
  category: 'color',
  ffmpegFilter: 'colortemperature',
  parameters: [
    {
      id: 'temperature',
      name: 'Temperature',
      type: 'number',
      min: 1000,
      max: 12000,
      step: 100,
      default: 6500,
      ffmpegParam: 'temperature',
    },
  ],
};

const HUE_ROTATE: EffectDescriptor = {
  id: 'hue_rotate',
  name: 'Hue Rotation',
  category: 'color',
  ffmpegFilter: 'hue',
  parameters: [
    {
      id: 'degrees',
      name: 'Hue',
      type: 'number',
      min: -180,
      max: 180,
      step: 1,
      default: 0,
      ffmpegParam: 'h',
    },
  ],
};

const GRAYSCALE: EffectDescriptor = {
  id: 'grayscale',
  name: 'Grayscale',
  category: 'color',
  ffmpegFilter: 'hue',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'amount',
      name: 'Amount',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1.0,
      ffmpegParam: 's',
    },
  ],
};

// ─── Blur / Sharpen Effects (2) ─────────────────────────────────────────────

const GAUSSIAN_BLUR: EffectDescriptor = {
  id: 'gaussian_blur',
  name: 'Gaussian Blur',
  category: 'blur',
  ffmpegFilter: 'gblur',
  parameters: [
    {
      id: 'sigma',
      name: 'Blur Radius',
      type: 'number',
      min: 0,
      max: 100,
      step: 0.1,
      default: 5,
      ffmpegParam: 'sigma',
    },
  ],
};

const SHARPEN: EffectDescriptor = {
  id: 'sharpen',
  name: 'Sharpen',
  category: 'blur',
  ffmpegFilter: 'unsharp',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'amount',
      name: 'Sharpen Amount',
      type: 'number',
      min: 0,
      max: 10,
      step: 0.1,
      default: 1.5,
      ffmpegParam: 'amount',
    },
  ],
};

// ─── Style Effects (2) ──────────────────────────────────────────────────────

const SEPIA: EffectDescriptor = {
  id: 'sepia',
  name: 'Sepia',
  category: 'style',
  ffmpegFilter: 'colorchannelmixer',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'amount',
      name: 'Amount',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1.0,
      ffmpegParam: 'amount',
    },
  ],
};

const VIGNETTE: EffectDescriptor = {
  id: 'vignette',
  name: 'Vignette',
  category: 'style',
  ffmpegFilter: 'vignette',
  parameters: [
    {
      id: 'angle',
      name: 'Intensity',
      type: 'number',
      min: 0,
      max: 1.5,
      step: 0.01,
      default: 0.5,
      ffmpegParam: 'angle',
    },
  ],
};

// ─── Transition Effects (3) ─────────────────────────────────────────────────

const CROSS_DISSOLVE: EffectDescriptor = {
  id: 'cross_dissolve',
  name: 'Cross Dissolve',
  category: 'transition',
  ffmpegFilter: 'xfade',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'duration',
      name: 'Duration',
      type: 'number',
      min: 0.1,
      max: 5,
      step: 0.1,
      default: 1.0,
      ffmpegParam: 'duration',
    },
    {
      id: 'offset',
      name: 'Offset',
      type: 'number',
      min: 0,
      max: 3600,
      step: 0.1,
      default: 0,
      ffmpegParam: 'offset',
    },
  ],
};

const FADE_OUT: EffectDescriptor = {
  id: 'fade_out',
  name: 'Fade to Black',
  category: 'transition',
  ffmpegFilter: 'fade',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'start',
      name: 'Start Time',
      type: 'number',
      min: 0,
      max: 3600,
      step: 0.1,
      default: 0,
      ffmpegParam: 'st',
    },
    {
      id: 'duration',
      name: 'Duration',
      type: 'number',
      min: 0.1,
      max: 10,
      step: 0.1,
      default: 1.0,
      ffmpegParam: 'd',
    },
  ],
};

const FADE_IN: EffectDescriptor = {
  id: 'fade_in',
  name: 'Fade from Black',
  category: 'transition',
  ffmpegFilter: 'fade',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'duration',
      name: 'Duration',
      type: 'number',
      min: 0.1,
      max: 10,
      step: 0.1,
      default: 1.0,
      ffmpegParam: 'd',
    },
  ],
};

// ─── Speed Effect (1) ───────────────────────────────────────────────────────

const PLAYBACK_SPEED: EffectDescriptor = {
  id: 'playback_speed',
  name: 'Playback Speed',
  category: 'speed',
  ffmpegFilter: 'setpts',
  ffmpegCustom: true,
  parameters: [
    {
      id: 'rate',
      name: 'Speed',
      type: 'number',
      min: 0.1,
      max: 16,
      step: 0.1,
      default: 1.0,
      ffmpegParam: 'rate',
    },
  ],
};

// ─── Effect Registry ────────────────────────────────────────────────────────

/**
 * All available effects, keyed by ID.
 * This is the single source of truth for what effects exist.
 */
export const EFFECT_REGISTRY: ReadonlyMap<string, EffectDescriptor> = new Map<string, EffectDescriptor>([
  // Transform (5)
  [SCALE.id, SCALE],
  [POSITION.id, POSITION],
  [ROTATION.id, ROTATION],
  [OPACITY.id, OPACITY],
  [CROP.id, CROP],
  // Color Correction (7)
  [BRIGHTNESS.id, BRIGHTNESS],
  [CONTRAST.id, CONTRAST],
  [SATURATION.id, SATURATION],
  [EXPOSURE.id, EXPOSURE],
  [COLOR_TEMPERATURE.id, COLOR_TEMPERATURE],
  [HUE_ROTATE.id, HUE_ROTATE],
  [GRAYSCALE.id, GRAYSCALE],
  // Blur / Sharpen (2)
  [GAUSSIAN_BLUR.id, GAUSSIAN_BLUR],
  [SHARPEN.id, SHARPEN],
  // Style (2)
  [SEPIA.id, SEPIA],
  [VIGNETTE.id, VIGNETTE],
  // Transitions (3)
  [CROSS_DISSOLVE.id, CROSS_DISSOLVE],
  [FADE_OUT.id, FADE_OUT],
  [FADE_IN.id, FADE_IN],
  // Speed (1)
  [PLAYBACK_SPEED.id, PLAYBACK_SPEED],
]);

// ─── Convenience Accessors ──────────────────────────────────────────────────

/** Get an effect descriptor by ID */
export function getEffectDescriptor(id: string): EffectDescriptor | undefined {
  return EFFECT_REGISTRY.get(id);
}

/** Get all effects in a specific category */
export function getEffectsByCategory(category: EffectDescriptor['category']): EffectDescriptor[] {
  return Array.from(EFFECT_REGISTRY.values()).filter((e) => e.category === category);
}

/** Get all built-in effects (always present on clips) */
export function getBuiltInEffects(): EffectDescriptor[] {
  return Array.from(EFFECT_REGISTRY.values()).filter((e) => e.builtIn);
}

/** Get all non-built-in effects (user-applied) */
export function getUserEffects(): EffectDescriptor[] {
  return Array.from(EFFECT_REGISTRY.values()).filter((e) => !e.builtIn);
}

/** Get a flat list of all effect IDs */
export function getAllEffectIds(): string[] {
  return Array.from(EFFECT_REGISTRY.keys());
}

/** Total number of registered effects */
export const EFFECT_COUNT = EFFECT_REGISTRY.size;
