import { useMemo } from 'react';
import { useEditorStore } from '@/lib/store/editor-store';
import type { ProvenanceEntry, ClipProvenance } from '@/types/editor';
import { useShallow } from 'zustand/react/shallow';

const EMPTY_PROVENANCE: ClipProvenance = {};

/**
 * Returns the full provenance map for a clip.
 * Returns an empty object if clipId is null or the clip isn't found.
 */
export function useClipProvenance(clipId: string | null): ClipProvenance {
  return useEditorStore(
    useShallow((state) => {
      if (!clipId) return EMPTY_PROVENANCE;
      for (const track of state.project.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) return clip.provenance;
      }
      return EMPTY_PROVENANCE;
    })
  );
}

/**
 * Returns a single ProvenanceEntry for a specific property path on a clip,
 * or null if no provenance exists for that path.
 */
export function usePropertyProvenance(
  clipId: string | null,
  path: string,
): ProvenanceEntry | null {
  const provenance = useClipProvenance(clipId);
  return useMemo(() => provenance[path] ?? null, [provenance, path]);
}

/**
 * Returns the count and paths of unaccepted AI changes for a clip.
 * Filters entries where source is 'ai' and accepted is false.
 */
export function usePendingAIChanges(
  clipId: string | null,
): { count: number; paths: string[] } {
  const provenance = useClipProvenance(clipId);

  return useMemo(() => {
    const paths: string[] = [];
    for (const [key, entry] of Object.entries(provenance)) {
      if (entry.source === 'ai' && !entry.accepted) {
        paths.push(key);
      }
    }
    return { count: paths.length, paths };
  }, [provenance]);
}
