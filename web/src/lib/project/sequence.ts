/**
 * Sequence (composition) derivation — the ONE place that computes
 * composition fields from the track tree and source assets.
 *
 * The store previously recalculated duration inline at 9 call-sites and
 * adopted source dims/fps ad-hoc inside addClipFromMedia; both now flow
 * through here.
 */

import type { Composition, Track } from '@/types/editor';
import type { Asset } from '@/types/media';

/** Total composition duration = end of the right-most clip across all tracks. */
export function calculateDuration(tracks: Track[]): number {
  let maxEnd = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
      maxEnd = Math.max(maxEnd, clipEnd);
    }
  }
  return maxEnd;
}

/**
 * Derive the composition patch after a track mutation.
 *
 * Always recomputes duration. When `adoptFromAsset` is set (the FIRST real
 * clip landing in the project), the composition also adopts the source's
 * dimensions and frame rate so every add path (drop, chat, AI) produces a
 * composition that matches the media instead of the 1920×1080@30 default.
 */
export function deriveSequencePatch(
  tracks: Track[],
  adoptFromAsset?: Asset | null,
): Partial<Composition> {
  const patch: Partial<Composition> = { duration: calculateDuration(tracks) };

  if (adoptFromAsset) {
    if (adoptFromAsset.width && adoptFromAsset.height) {
      patch.width = adoptFromAsset.width;
      patch.height = adoptFromAsset.height;
    }
    if (adoptFromAsset.fps) {
      patch.fps = adoptFromAsset.fps;
    }
  }

  return patch;
}
