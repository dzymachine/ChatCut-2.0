/**
 * ChatCut — FFmpeg Filter Graph Mapper
 *
 * Converts an effect stack (AppliedEffect[]) into FFmpeg filter graph syntax.
 * This is the bridge between the editor's effect system and FFmpeg export.
 *
 * Each effect descriptor maps to one or more FFmpeg filters. Simple effects
 * use direct parameter mapping; complex effects use custom builders.
 *
 * The output is a string suitable for FFmpeg's -filter_complex or -vf argument.
 */

import type { AppliedEffect } from '@/types/effects';
import { getEffectDescriptor } from './registry';

// ─── Filter String for a Single Effect ──────────────────────────────────────

/**
 * Convert a single AppliedEffect to its FFmpeg filter string.
 * Returns null if the effect is disabled, not found, or has no-op values.
 */
export function effectToFFmpegFilter(effect: AppliedEffect): string | null {
  if (!effect.enabled) return null;

  const descriptor = getEffectDescriptor(effect.effectId);
  if (!descriptor) {
    console.warn(`[FFmpegMapper] Unknown effect: ${effect.effectId}`);
    return null;
  }

  // Use custom builder for complex effects
  if (descriptor.ffmpegCustom) {
    return buildCustomFilter(effect);
  }

  // Standard mapping: filter_name=param1=value1:param2=value2
  return buildStandardFilter(effect, descriptor.ffmpegFilter);
}

/**
 * Standard filter builder: maps parameters directly to FFmpeg filter syntax.
 */
function buildStandardFilter(effect: AppliedEffect, filterName: string): string | null {
  const descriptor = getEffectDescriptor(effect.effectId);
  if (!descriptor) return null;

  const parts: string[] = [];

  for (const paramDef of descriptor.parameters) {
    const value = effect.parameters[paramDef.id];
    if (value === undefined) continue;

    // Skip parameters at their default values (no-op)
    if (value === paramDef.default) continue;

    parts.push(`${paramDef.ffmpegParam}=${formatFFmpegValue(value)}`);
  }

  if (parts.length === 0) return null;
  return `${filterName}=${parts.join(':')}`;
}

// ─── Custom Filter Builders ─────────────────────────────────────────────────

/**
 * Build a filter string for effects that need custom FFmpeg mapping.
 */
function buildCustomFilter(effect: AppliedEffect): string | null {
  const p = effect.parameters;

  switch (effect.effectId) {
    // ── Scale ──
    case 'scale': {
      const scale = p.scale ?? 1.0;
      if (scale === 1.0) return null;
      return `scale=iw*${formatFFmpegValue(scale)}:ih*${formatFFmpegValue(scale)}`;
    }

    // ── Position ──
    case 'position': {
      const x = p.positionX ?? 0;
      const y = p.positionY ?? 0;
      if (x === 0 && y === 0) return null;
      // Pad to create larger canvas, then crop to offset
      // This shifts the video by the specified amount
      const absX = Math.abs(x);
      const absY = Math.abs(y);
      const cropX = x > 0 ? 0 : absX;
      const cropY = y > 0 ? 0 : absY;
      const padX = x > 0 ? x : 0;
      const padY = y > 0 ? y : 0;
      return `pad=iw+${absX}:ih+${absY}:${padX}:${padY}:black,crop=iw-${absX}:ih-${absY}:${cropX}:${cropY}`;
    }

    // ── Rotation ──
    case 'rotation': {
      const degrees = p.degrees ?? 0;
      if (degrees === 0) return null;
      const radians = (degrees * Math.PI) / 180;
      return `rotate=${formatFFmpegValue(radians)}:fillcolor=black`;
    }

    // ── Opacity ──
    case 'opacity': {
      const opacity = p.opacity ?? 1.0;
      if (opacity === 1.0) return null;
      // Use colorchannelmixer to multiply alpha
      return `format=rgba,colorchannelmixer=aa=${formatFFmpegValue(opacity)}`;
    }

    // ── Grayscale ──
    case 'grayscale': {
      const amount = p.amount ?? 1.0;
      if (amount === 0) return null;
      if (amount >= 1.0) return 'hue=s=0';
      // Partial desaturation
      return `hue=s=${formatFFmpegValue(1 - amount)}`;
    }

    // ── Sharpen ──
    case 'sharpen': {
      const amount = p.amount ?? 1.5;
      if (amount === 0) return null;
      return `unsharp=5:5:${formatFFmpegValue(amount)}:5:5:${formatFFmpegValue(amount / 2)}`;
    }

    // ── Sepia ──
    case 'sepia': {
      const amount = p.amount ?? 1.0;
      if (amount === 0) return null;
      // Sepia tone via color channel mixing
      // Full sepia: R = 0.393R + 0.769G + 0.189B
      //             G = 0.349R + 0.686G + 0.168B
      //             B = 0.272R + 0.534G + 0.131B
      // Lerp between identity and sepia based on amount
      const lerp = (identity: number, sepia: number) =>
        formatFFmpegValue(identity + (sepia - identity) * amount);
      return `colorchannelmixer=${lerp(1, 0.393)}:${lerp(0, 0.769)}:${lerp(0, 0.189)}:0:${lerp(0, 0.349)}:${lerp(1, 0.686)}:${lerp(0, 0.168)}:0:${lerp(0, 0.272)}:${lerp(0, 0.534)}:${lerp(1, 0.131)}`;
    }

    // ── Cross Dissolve ──
    case 'cross_dissolve': {
      const duration = p.duration ?? 1.0;
      const offset = p.offset ?? 0;
      return `xfade=transition=fade:duration=${formatFFmpegValue(duration)}:offset=${formatFFmpegValue(offset)}`;
    }

    // ── Fade Out (to black) ──
    case 'fade_out': {
      const start = p.start ?? 0;
      const duration = p.duration ?? 1.0;
      return `fade=t=out:st=${formatFFmpegValue(start)}:d=${formatFFmpegValue(duration)}`;
    }

    // ── Fade In (from black) ──
    case 'fade_in': {
      const duration = p.duration ?? 1.0;
      return `fade=t=in:d=${formatFFmpegValue(duration)}`;
    }

    // ── Playback Speed ──
    case 'playback_speed': {
      const rate = p.rate ?? 1.0;
      if (rate === 1.0) return null;
      // Video: setpts, Audio: atempo (audio handled separately)
      return `setpts=${formatFFmpegValue(1 / rate)}*PTS`;
    }

    default:
      console.warn(`[FFmpegMapper] No custom builder for effect: ${effect.effectId}`);
      return null;
  }
}

// ─── Full Effect Stack → Filter Chain ───────────────────────────────────────

/**
 * Convert an entire effect stack to a comma-separated FFmpeg filter chain.
 * This is used for a single clip's video filters.
 */
export function effectStackToVideoFilters(effects: AppliedEffect[]): string {
  const filters: string[] = [];

  for (const effect of effects) {
    const filter = effectToFFmpegFilter(effect);
    if (filter) {
      filters.push(filter);
    }
  }

  return filters.join(',');
}

/**
 * Extract audio-specific filters from an effect stack.
 * Currently only playback speed affects audio (atempo filter).
 */
export function effectStackToAudioFilters(effects: AppliedEffect[]): string {
  const filters: string[] = [];

  for (const effect of effects) {
    if (!effect.enabled) continue;

    if (effect.effectId === 'playback_speed') {
      const rate = effect.parameters.rate ?? 1.0;
      if (rate !== 1.0) {
        // atempo only supports 0.5 to 100. Chain multiple for extreme values.
        filters.push(...buildAtempoChain(rate));
      }
    }
  }

  return filters.join(',');
}

/**
 * Build an atempo filter chain for a given speed rate.
 * FFmpeg's atempo filter only supports values between 0.5 and 100.0.
 * For values outside this range, we chain multiple atempo filters.
 */
function buildAtempoChain(rate: number): string[] {
  const filters: string[] = [];

  if (rate >= 0.5 && rate <= 100) {
    filters.push(`atempo=${formatFFmpegValue(rate)}`);
  } else if (rate < 0.5) {
    // Chain multiple atempo filters
    let remaining = rate;
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
    filters.push(`atempo=${formatFFmpegValue(remaining)}`);
  }

  return filters;
}

// ─── Multi-Clip Filter Complex ──────────────────────────────────────────────

/**
 * Data needed to build a filter_complex for a clip.
 */
export interface ClipExportData {
  /** Input index in the FFmpeg command */
  inputIndex: number;
  /** Source file path */
  sourcePath: string;
  /** Trim start (seconds) */
  sourceStart: number;
  /** Trim end (seconds) */
  sourceEnd: number;
  /** Position on timeline (seconds) */
  timelineStart: number;
  /** Effect stack */
  effects: AppliedEffect[];
}

/**
 * Build a complete FFmpeg filter_complex string for multiple clips.
 * Clips are trimmed, effects applied, then concatenated.
 *
 * Returns the full -filter_complex value and the output stream labels.
 */
export function buildFilterComplex(clips: ClipExportData[]): {
  filterComplex: string;
  videoOutput: string;
  audioOutput: string;
} {
  if (clips.length === 0) {
    return { filterComplex: '', videoOutput: '', audioOutput: '' };
  }

  const filterParts: string[] = [];
  const videoStreams: string[] = [];
  const audioStreams: string[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const inputV = `[${clip.inputIndex}:v]`;
    const inputA = `[${clip.inputIndex}:a]`;
    const outputV = `[v${i}]`;
    const outputA = `[a${i}]`;

    // 1. Trim the clip
    const trimStart = clip.sourceStart;
    const trimEnd = clip.sourceEnd;
    let videoChain = `${inputV}trim=start=${formatFFmpegValue(trimStart)}:end=${formatFFmpegValue(trimEnd)},setpts=PTS-STARTPTS`;
    let audioChain = `${inputA}atrim=start=${formatFFmpegValue(trimStart)}:end=${formatFFmpegValue(trimEnd)},asetpts=PTS-STARTPTS`;

    // 2. Apply video effects
    const videoFilters = effectStackToVideoFilters(clip.effects);
    if (videoFilters) {
      videoChain += `,${videoFilters}`;
    }

    // 3. Apply audio effects
    const audioFilters = effectStackToAudioFilters(clip.effects);
    if (audioFilters) {
      audioChain += `,${audioFilters}`;
    }

    filterParts.push(`${videoChain}${outputV}`);
    filterParts.push(`${audioChain}${outputA}`);
    videoStreams.push(`[v${i}]`);
    audioStreams.push(`[a${i}]`);
  }

  // 4. Concatenate all clips
  if (clips.length === 1) {
    return {
      filterComplex: filterParts.join(';'),
      videoOutput: '[v0]',
      audioOutput: '[a0]',
    };
  }

  const concatInput = videoStreams.map((v, i) => `${v}${audioStreams[i]}`).join('');
  filterParts.push(
    `${concatInput}concat=n=${clips.length}:v=1:a=1[vout][aout]`
  );

  return {
    filterComplex: filterParts.join(';'),
    videoOutput: '[vout]',
    audioOutput: '[aout]',
  };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Format a number for FFmpeg (fixed precision, no trailing zeros).
 */
function formatFFmpegValue(value: number): string {
  // Use up to 6 decimal places, strip trailing zeros
  return parseFloat(value.toFixed(6)).toString();
}
