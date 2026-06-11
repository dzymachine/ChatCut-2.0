/**
 * Recipe merge — append-only growth of a clip's filter graph.
 *
 * The LLM "tacks onto" an existing recipe with a FRAGMENT (new nodes + the
 * connections among them). Semantics:
 *
 *   - Within a fragment, `from: "input"` means THE END of the existing
 *     recipe (its current output), and `to: "output"` is the clip output.
 *     The fragment is spliced between them.
 *   - Appends are STRICTLY additive: existing nodes/connections are never
 *     mutated or removed. The single permitted rewire is tail extension —
 *     the old `→ output` edge is re-pointed through the fragment.
 *   - Every appended node is tagged with the revision that introduced it,
 *     and the revision is recorded on the recipe's append-only log.
 */

import { v4 as uuid } from 'uuid';
import type {
  Recipe,
  RecipeConnection,
  RecipeNode,
  RecipeRevision,
} from '../../../src-shared/recipe';

export interface RecipeFragment {
  nodes: RecipeNode[];
  connections?: RecipeConnection[];
}

export type MergeResult =
  | { ok: true; recipe: Recipe; revision: RecipeRevision }
  | { ok: false; error: string };

/** Find the tail node id(s) of a recipe — nodes whose edge feeds "output". */
function findTailIds(recipe: Recipe): string[] {
  const tails = recipe.connections
    .filter((c) => c.to === 'output')
    .map((c) => c.from)
    .filter((f) => f !== 'input');
  if (tails.length > 0) return [...new Set(tails)];
  // Degenerate graphs (no explicit →output edge): fall back to nodes with no
  // outgoing edge; final fallback is the last node in array order.
  const sources = new Set(recipe.connections.map((c) => c.from));
  const noOutgoing = recipe.nodes.filter((n) => !sources.has(n.id)).map((n) => n.id);
  if (noOutgoing.length > 0) return noOutgoing;
  return recipe.nodes.length > 0 ? [recipe.nodes[recipe.nodes.length - 1].id] : [];
}

/**
 * Append a fragment to an existing recipe. Returns the MERGED recipe (a new
 * object — inputs are not mutated) plus the revision record, or an error.
 */
export function appendToRecipe(
  current: Recipe,
  fragment: RecipeFragment,
  prompt?: string,
): MergeResult {
  if (!fragment.nodes || fragment.nodes.length === 0) {
    return { ok: false, error: 'Fragment has no nodes to append.' };
  }

  const existingIds = new Set(current.nodes.map((n) => n.id));
  for (const node of fragment.nodes) {
    if (existingIds.has(node.id)) {
      return {
        ok: false,
        error: `Node id "${node.id}" already exists in the recipe — appends never modify existing nodes. Use fresh ids (the current graph has: ${[...existingIds].join(', ')}).`,
      };
    }
  }
  const fragmentIds = new Set(fragment.nodes.map((n) => n.id));
  if (fragmentIds.size !== fragment.nodes.length) {
    return { ok: false, error: 'Fragment contains duplicate node ids.' };
  }

  // Fragment connections may only reference fragment nodes + input/output.
  const fragConnections = fragment.connections ?? [];
  for (const conn of fragConnections) {
    if (conn.from !== 'input' && !fragmentIds.has(conn.from)) {
      return {
        ok: false,
        error: `Fragment connection references "${conn.from}" — fragment connections may only reference the NEW nodes, plus "input" (= the existing recipe's output) and "output".`,
      };
    }
    if (conn.to !== 'output' && !fragmentIds.has(conn.to)) {
      return {
        ok: false,
        error: `Fragment connection references "${conn.to}" — fragment connections may only reference the NEW nodes, plus "input" and "output".`,
      };
    }
  }

  // No connections supplied → chain fragment nodes in array order.
  const effectiveFragConnections: RecipeConnection[] =
    fragConnections.length > 0
      ? fragConnections
      : [
          { from: 'input', to: fragment.nodes[0].id },
          ...fragment.nodes.slice(0, -1).map((n, i) => ({
            from: n.id,
            to: fragment.nodes[i + 1].id,
          })),
          { from: fragment.nodes[fragment.nodes.length - 1].id, to: 'output' },
        ];

  const tailIds = findTailIds(current);
  const revision: RecipeRevision = {
    id: `rev-${uuid()}`,
    op: 'append',
    addedNodeIds: fragment.nodes.map((n) => n.id),
    ...(prompt ? { prompt } : {}),
    ts: Date.now(),
  };

  // Tail extension: drop the old →output edges; splice the fragment in.
  const keptConnections = current.connections.filter((c) => c.to !== 'output');
  const splicedFragment: RecipeConnection[] = effectiveFragConnections.flatMap((c) => {
    if (c.from === 'input') {
      // "input" in a fragment = the existing tail(s). Usually exactly one.
      return tailIds.length > 0
        ? tailIds.map((t) => ({ from: t, to: c.to }))
        : [{ from: 'input', to: c.to }]; // appending to an empty recipe
    }
    return [c];
  });

  const merged: Recipe = {
    ...current,
    nodes: [
      ...current.nodes,
      ...fragment.nodes.map((n) => ({ ...n, revisionId: revision.id })),
    ],
    connections: [...keptConnections, ...splicedFragment],
    revisions: [...(current.revisions ?? []), revision],
  };

  return { ok: true, recipe: merged, revision };
}

/**
 * Replace a recipe wholesale (the explicit "refine/compact" pass). Prior
 * revisions are carried forward so provenance survives; the prior GRAPH is
 * recoverable via the edit-history DAG snapshot of the preceding tool call.
 */
export function refineRecipe(
  current: Recipe | undefined,
  replacement: Recipe,
  prompt?: string,
): { recipe: Recipe; revision: RecipeRevision } {
  const revision: RecipeRevision = {
    id: `rev-${uuid()}`,
    op: 'refine',
    addedNodeIds: replacement.nodes.map((n) => n.id),
    ...(prompt ? { prompt } : {}),
    ts: Date.now(),
  };

  return {
    recipe: {
      ...replacement,
      id: replacement.id ?? current?.id,
      nodes: replacement.nodes.map((n) => ({ ...n, revisionId: revision.id })),
      revisions: [...(current?.revisions ?? []), revision],
    },
    revision,
  };
}

/** Tag a freshly composed recipe with its seed revision. */
export function withComposeRevision(recipe: Recipe, prompt?: string): Recipe {
  const revision: RecipeRevision = {
    id: `rev-${uuid()}`,
    op: 'compose',
    addedNodeIds: recipe.nodes.map((n) => n.id),
    ...(prompt ? { prompt } : {}),
    ts: Date.now(),
  };
  return {
    ...recipe,
    nodes: recipe.nodes.map((n) => ({ ...n, revisionId: revision.id })),
    revisions: [revision],
  };
}
