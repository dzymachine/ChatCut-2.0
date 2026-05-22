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
}

/** Directed edge in the filter graph. */
export interface RecipeConnection {
  from: string; // node id or "input"
  to: string;   // node id or "output"
}

/** A complete filter-graph recipe attached to a clip. */
export interface Recipe {
  id: string;
  nodes: RecipeNode[];
  connections: RecipeConnection[];
}
