/**
 * ChatCut — Effect System Type Definitions
 *
 * The unified effect descriptor system that drives everything:
 *   - Preview rendering (Canvas 2D / WebGL)
 *   - Export rendering (FFmpeg filter graphs)
 *   - AI action mapping
 *   - UI controls
 *
 * Adding a new effect = one descriptor in the registry. The descriptor
 * defines the effect's parameters, FFmpeg filter mapping, and defaults.
 *
 * RULES:
 *   - All types must be JSON-serializable.
 *   - Parameter values are always numbers (enums map to numeric indices).
 *   - Times are in SECONDS relative to clip start.
 */

// ─── Effect Descriptor (the "template") ─────────────────────────────────────

/** Category of an effect — determines where it appears in the UI and how it's processed. */
export type EffectCategory = 'transform' | 'color' | 'blur' | 'style' | 'transition' | 'speed';

/**
 * An EffectDescriptor defines an available effect type.
 * These are registered once in the effect registry and never mutated.
 */
export interface EffectDescriptor {
  /** Unique identifier, e.g. "gaussian_blur" */
  id: string;
  /** Human-readable name, e.g. "Gaussian Blur" */
  name: string;
  /** Category for UI grouping and processing logic */
  category: EffectCategory;
  /** Parameter definitions for this effect */
  parameters: EffectParameterDef[];
  /** FFmpeg filter name, e.g. "gblur" */
  ffmpegFilter: string;
  /** Optional: custom FFmpeg filter string builder (for complex mappings) */
  ffmpegCustom?: boolean;
  /** Whether this is a built-in effect that's always present on every clip */
  builtIn?: boolean;
}

/** Type of an effect parameter */
export type EffectParamType = 'number' | 'boolean' | 'enum';

/**
 * Defines a single parameter for an effect.
 */
export interface EffectParameterDef {
  /** Unique identifier within the effect, e.g. "sigma" */
  id: string;
  /** Human-readable name, e.g. "Blur Radius" */
  name: string;
  /** Parameter type */
  type: EffectParamType;
  /** Minimum value (for number type) */
  min?: number;
  /** Maximum value (for number type) */
  max?: number;
  /** Step size for UI sliders */
  step?: number;
  /** Default value */
  default: number;
  /** FFmpeg parameter name, e.g. "sigma" — maps to FFmpeg filter param */
  ffmpegParam: string;
  /** Optional: enum labels (for enum type) */
  enumLabels?: string[];
}

// ─── Applied Effect Instance (stored on each Clip) ──────────────────────────

/**
 * An AppliedEffect is an instance of an EffectDescriptor applied to a clip.
 * Each clip can have multiple applied effects (the "effect stack").
 * Effects are applied in order (first to last).
 */
export interface AppliedEffect {
  /** Unique instance ID (uuid) */
  id: string;
  /** References EffectDescriptor.id — which effect this is */
  effectId: string;
  /** Current parameter values — keys are EffectParameterDef.id */
  parameters: Record<string, number>;
  /** Keyframes for animation (empty = static value) */
  keyframes: EffectKeyframe[];
  /** Whether this effect is active */
  enabled: boolean;
}

// ─── Keyframes ──────────────────────────────────────────────────────────────

/** Interpolation mode between keyframes */
export type KeyframeInterpolation = 'linear' | 'bezier' | 'hold' | 'ease_in' | 'ease_out';

/**
 * A keyframe for a specific parameter of an effect.
 */
export interface EffectKeyframe {
  /** Time in seconds (relative to clip start) */
  time: number;
  /** Parameter ID this keyframe is for */
  parameterId: string;
  /** Value at this keyframe */
  value: number;
  /** Interpolation mode to the next keyframe */
  interpolation: KeyframeInterpolation;
}

// ─── Effect Action Types ────────────────────────────────────────────────────

/**
 * EditAction for applying an effect through the command system.
 * This extends the existing EditAction union.
 */
export interface ApplyEffectAction {
  type: 'applyEffect';
  effectId: string;
  parameters: Record<string, number>;
  clipId?: string;
}

/**
 * EditAction for removing an effect from a clip.
 */
export interface RemoveEffectAction {
  type: 'removeEffect';
  appliedEffectId: string;
  clipId?: string;
}

/**
 * EditAction for updating an effect's parameters.
 */
export interface UpdateEffectAction {
  type: 'updateEffect';
  appliedEffectId: string;
  parameters: Record<string, number>;
  clipId?: string;
}

/**
 * EditAction for toggling an effect's enabled state.
 */
export interface ToggleEffectAction {
  type: 'toggleEffect';
  appliedEffectId: string;
  enabled: boolean;
  clipId?: string;
}

/** All effect-related action types */
export type EffectAction =
  | ApplyEffectAction
  | RemoveEffectAction
  | UpdateEffectAction
  | ToggleEffectAction;

// ─── Helper: Default Applied Effect ─────────────────────────────────────────

/**
 * Create a default AppliedEffect from a descriptor.
 * Uses the descriptor's default parameter values.
 */
export function createDefaultAppliedEffect(
  descriptor: EffectDescriptor,
  id: string
): AppliedEffect {
  const parameters: Record<string, number> = {};
  for (const param of descriptor.parameters) {
    parameters[param.id] = param.default;
  }
  return {
    id,
    effectId: descriptor.id,
    parameters,
    keyframes: [],
    enabled: true,
  };
}
