/**
 * ChatCut — Action Mapper
 *
 * Translates raw AI actions (from the FastAPI backend's function calling)
 * into typed EditActions that the command handler can execute.
 *
 * The backend returns actions like:
 *   { action: "zoom_in", parameters: { scale_percent: 150 } }
 *
 * This mapper converts them to:
 *   { type: "zoom", scale: 1.5 }
 */

import type { EditAction, FilterState, ApplyEffectAction } from '@/types/editor';
import type { RawAIAction } from '@/lib/ai/client';
import { getEffectDescriptor, EFFECT_REGISTRY } from '@/lib/effects/registry';

/**
 * Map a raw AI action to a typed EditAction.
 * Returns null if the action is not recognized.
 */
export function mapAIAction(raw: RawAIAction): EditAction | null {
  const { action, parameters } = raw;
  const p = parameters;

  switch (action) {
    // ── Zoom ──
    case 'zoom_in':
    case 'zoom_out':
    case 'zoom':
    case 'set_zoom':
      return {
        type: 'zoom',
        scale: normalizeScale(p.scale_percent ?? p.scale ?? p.value ?? 100),
        animated: Boolean(p.animated ?? p.gradual),
        duration: Number(p.duration ?? p.transition_duration ?? 0) || undefined,
      };

    // ── Position / Pan ──
    case 'set_position':
    case 'position':
    case 'pan':
    case 'move':
      return {
        type: 'position',
        x: Number(p.x ?? p.position_x ?? 0),
        y: Number(p.y ?? p.position_y ?? 0),
        animated: Boolean(p.animated ?? p.gradual),
        duration: Number(p.duration ?? 0) || undefined,
      };

    // ── Opacity ──
    case 'set_opacity':
    case 'opacity':
    case 'fade':
      return {
        type: 'opacity',
        value: normalizePercent(p.opacity ?? p.value ?? p.percent ?? 100),
        animated: Boolean(p.animated ?? p.gradual ?? action === 'fade'),
        duration: Number(p.duration ?? (action === 'fade' ? 1 : 0)) || undefined,
      };

    // ── Rotation ──
    case 'rotate':
    case 'set_rotation':
    case 'rotation':
      return {
        type: 'rotation',
        degrees: Number(p.degrees ?? p.angle ?? p.rotation ?? 0),
        animated: Boolean(p.animated ?? p.gradual),
        duration: Number(p.duration ?? 0) || undefined,
      };

    // ── Filters ──
    case 'set_blur':
    case 'blur':
    case 'add_blur':
      return {
        type: 'filter',
        filter: 'blur' as keyof FilterState,
        value: Number(p.amount ?? p.value ?? p.blur ?? 5),
        animated: Boolean(p.animated),
        duration: Number(p.duration ?? 0) || undefined,
      };

    case 'set_brightness':
    case 'brightness':
      return {
        type: 'filter',
        filter: 'brightness' as keyof FilterState,
        value: normalizePercent(p.value ?? p.brightness ?? p.percent ?? 100),
      };

    case 'set_contrast':
    case 'contrast':
      return {
        type: 'filter',
        filter: 'contrast' as keyof FilterState,
        value: normalizePercent(p.value ?? p.contrast ?? p.percent ?? 100),
      };

    case 'set_saturation':
    case 'saturation':
    case 'saturate':
      return {
        type: 'filter',
        filter: 'saturate' as keyof FilterState,
        value: normalizePercent(p.value ?? p.saturation ?? p.percent ?? 100),
      };

    case 'grayscale':
    case 'set_grayscale':
    case 'black_and_white':
      return {
        type: 'filter',
        filter: 'grayscale' as keyof FilterState,
        value: normalizePercent(p.value ?? p.amount ?? 100),
      };

    case 'sepia':
    case 'set_sepia':
      return {
        type: 'filter',
        filter: 'sepia' as keyof FilterState,
        value: normalizePercent(p.value ?? p.amount ?? 100),
      };

    case 'hue_rotate':
    case 'set_hue':
      return {
        type: 'filter',
        filter: 'hueRotate' as keyof FilterState,
        value: Number(p.degrees ?? p.value ?? p.hue ?? 0),
      };

    // ── Generic filter setter ──
    case 'apply_filter':
    case 'set_filter': {
      const filterName = String(p.filter ?? p.name ?? '').toLowerCase();
      const mapped = mapFilterName(filterName);
      if (!mapped) return null;
      return {
        type: 'filter',
        filter: mapped,
        value: Number(p.value ?? p.amount ?? 1),
      };
    }

    // ── Volume ──
    case 'set_volume':
    case 'volume':
    case 'adjust_volume':
      return {
        type: 'volume',
        value: normalizePercent(p.volume ?? p.value ?? p.percent ?? 100),
      };

    // ── Speed ──
    case 'set_speed':
    case 'speed':
    case 'playback_rate':
      return {
        type: 'playbackRate',
        value: Number(p.rate ?? p.speed ?? p.value ?? 1),
      };

    // ── Cut / Trim / Delete ──
    case 'cut':
    case 'split':
      return {
        type: 'cut',
        clipId: String(p.clip_id ?? ''),
        time: Number(p.time ?? p.at ?? 0),
      };

    case 'trim':
      return {
        type: 'trim',
        clipId: String(p.clip_id ?? ''),
        start: p.start != null ? Number(p.start) : undefined,
        end: p.end != null ? Number(p.end) : undefined,
      };

    case 'delete':
    case 'remove':
    case 'delete_clip':
      return {
        type: 'deleteClip',
        clipId: String(p.clip_id ?? ''),
      };

    // ── Reset ──
    case 'reset':
    case 'reset_transform':
    case 'reset_all':
      // Return zoom to default as a proxy for "reset everything"
      return {
        type: 'zoom',
        scale: 1.0,
      };

    // ── Effect System Actions (new unified system) ──
    case 'apply_effect':
    case 'add_effect': {
      const effectId = String(p.effect_id ?? p.effectId ?? p.effect ?? '');
      if (!effectId || !getEffectDescriptor(effectId)) {
        // Try to match by name
        const matched = matchEffectByName(effectId);
        if (!matched) return null;
        return mapEffectAction(matched, p);
      }
      return mapEffectAction(effectId, p);
    }

    // ── Effects by name (AI may use these) ──
    case 'sharpen':
    case 'add_sharpen':
      return {
        type: 'applyEffect',
        effectId: 'sharpen',
        parameters: { amount: Number(p.amount ?? p.value ?? 1.5) },
      };

    case 'vignette':
    case 'add_vignette':
      return {
        type: 'applyEffect',
        effectId: 'vignette',
        parameters: { angle: Number(p.angle ?? p.intensity ?? p.value ?? 0.5) },
      };

    case 'exposure':
    case 'set_exposure':
      return {
        type: 'applyEffect',
        effectId: 'exposure',
        parameters: { exposure: Number(p.exposure ?? p.value ?? 0) },
      };

    case 'color_temperature':
    case 'set_color_temperature':
    case 'white_balance':
      return {
        type: 'applyEffect',
        effectId: 'color_temperature',
        parameters: { temperature: Number(p.temperature ?? p.value ?? 6500) },
      };

    case 'crop':
    case 'set_crop':
      return {
        type: 'applyEffect',
        effectId: 'crop',
        parameters: {
          width: Number(p.width ?? p.w ?? 1920),
          height: Number(p.height ?? p.h ?? 1080),
          x: Number(p.x ?? p.offset_x ?? 0),
          y: Number(p.y ?? p.offset_y ?? 0),
        },
      };

    case 'fade_in':
    case 'add_fade_in':
      return {
        type: 'applyEffect',
        effectId: 'fade_in',
        parameters: { duration: Number(p.duration ?? p.value ?? 1.0) },
      };

    case 'fade_out':
    case 'add_fade_out':
    case 'fade_to_black':
      return {
        type: 'applyEffect',
        effectId: 'fade_out',
        parameters: {
          start: Number(p.start ?? p.at ?? 0),
          duration: Number(p.duration ?? p.value ?? 1.0),
        },
      };

    case 'cross_dissolve':
    case 'add_cross_dissolve':
      return {
        type: 'applyEffect',
        effectId: 'cross_dissolve',
        parameters: {
          duration: Number(p.duration ?? p.value ?? 1.0),
          offset: Number(p.offset ?? 0),
        },
      };

    default:
      console.warn(`[ActionMapper] Unrecognized action: "${action}"`, parameters);
      return null;
  }
}

/**
 * Map a known effect ID to an ApplyEffectAction with parameters from AI response.
 */
function mapEffectAction(effectId: string, p: Record<string, unknown>): ApplyEffectAction | null {
  const descriptor = getEffectDescriptor(effectId);
  if (!descriptor) return null;

  const parameters: Record<string, number> = {};
  for (const paramDef of descriptor.parameters) {
    const raw = p[paramDef.id] ?? p[paramDef.ffmpegParam] ?? p.value ?? p.amount;
    if (raw !== undefined) {
      parameters[paramDef.id] = Number(raw);
    }
  }

  return {
    type: 'applyEffect',
    effectId,
    parameters,
  };
}

/**
 * Try to match a string to an effect ID by name.
 */
function matchEffectByName(name: string): string | null {
  const normalized = name.toLowerCase().replace(/[\s_-]/g, '');
  for (const [id, descriptor] of EFFECT_REGISTRY) {
    const normalizedId = id.replace(/[\s_-]/g, '');
    const normalizedName = descriptor.name.toLowerCase().replace(/[\s_-]/g, '');
    if (normalized === normalizedId || normalized === normalizedName) {
      return id;
    }
  }
  return null;
}

/**
 * Map multiple raw AI actions.
 */
export function mapAIActions(rawActions: RawAIAction[]): EditAction[] {
  return rawActions
    .map(mapAIAction)
    .filter((action): action is EditAction => action !== null);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert a percentage value (e.g. 150) to a multiplier (1.5). */
function normalizeScale(value: unknown): number {
  const num = Number(value);
  // If the value looks like a percentage (> 10), divide by 100
  if (num > 10) return num / 100;
  return num;
}

/** Convert a percentage (e.g. 50 or 0.5) to a 0-1 range. */
function normalizePercent(value: unknown): number {
  const num = Number(value);
  if (num > 1) return num / 100;
  return num;
}

/** Map common filter name strings to FilterState keys. */
function mapFilterName(name: string): keyof FilterState | null {
  const map: Record<string, keyof FilterState> = {
    blur: 'blur',
    brightness: 'brightness',
    contrast: 'contrast',
    saturate: 'saturate',
    saturation: 'saturate',
    grayscale: 'grayscale',
    greyscale: 'grayscale',
    sepia: 'sepia',
    hue: 'hueRotate',
    'hue-rotate': 'hueRotate',
    huerotate: 'hueRotate',
  };
  return map[name] || null;
}
