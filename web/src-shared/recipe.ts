/**
 * Recipe AST — shared type definitions.
 *
 * A Recipe is a declarative filter graph that compiles to FFmpeg
 * filter syntax.  The agent composes recipes via structured nodes
 * (filter + params) or raw filter strings; the compiler produces
 * the final -vf / -filter_complex value generically.
 */

export type RecipeParamValue = number | string | boolean;

/**
 * A recipe node — either a structured filter (filter + params)
 * or a raw FFmpeg filter string.  Exactly one of `filter` or `raw`
 * should be set.
 */
export interface RecipeNode {
  id: string;
  filter?: string;
  params?: Record<string, RecipeParamValue>;
  raw?: string;
  /** Which revision added this node (append-only provenance). */
  revisionId?: string;
}

/** Directed edge in the filter graph. */
export interface RecipeConnection {
  from: string; // node id or "input"
  to: string;   // node id or "output"
}

/**
 * One entry in a recipe's append-only history.
 *
 * The LLM grows a recipe through `compose` (seed) → `append` (add nodes,
 * never mutate existing ones) → `refine` (explicit user-requested rewrite/
 * compaction). Each pass records which nodes it added, so the graph is
 * self-describing: get_recipe shows the model exactly how the look was built.
 */
export interface RecipeRevision {
  id: string;
  op: 'compose' | 'append' | 'refine' | 'tune';
  /** Node ids introduced by this revision. */
  addedNodeIds: string[];
  /** The user ask that motivated this pass (for the learned-template cache). */
  prompt?: string;
  ts: number;
}

/** A complete filter-graph recipe attached to a clip.
 *  `id` is optional because LLM-emitted recipes typically omit it; the
 *  compose_recipe handler assigns one before storing. */
export interface Recipe {
  id?: string;
  nodes: RecipeNode[];
  connections: RecipeConnection[];
  /** Append-only revision log. Absent on recipes from older projects. */
  revisions?: RecipeRevision[];
}
