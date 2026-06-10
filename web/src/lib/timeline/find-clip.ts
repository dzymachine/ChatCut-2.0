/**
 * Shared clip lookup across the track tree.
 *
 * The "loop every track, find the clip" pattern was duplicated in the
 * serializer, command handler, and several store actions — one helper,
 * one shape for the result.
 */

import type { Clip, Track } from '@/types/editor';

export interface ClipLocation {
  clip: Clip;
  track: Track;
  /** Index of the clip within track.clips. */
  clipIndex: number;
}

/** Find a clip (and its containing track) by id. Returns null if absent. */
export function findClipById(tracks: Track[], clipId: string): ClipLocation | null {
  for (const track of tracks) {
    const clipIndex = track.clips.findIndex((c) => c.id === clipId);
    if (clipIndex >= 0) {
      return { clip: track.clips[clipIndex], track, clipIndex };
    }
  }
  return null;
}
