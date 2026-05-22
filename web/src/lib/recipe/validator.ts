/**
 * Recipe Validator — structural validation (runs in the browser).
 *
 * Checks for cycles, dangling references, and empty recipes.
 * FFmpeg dry-run validation happens server-side in Rust.
 */

import type { Recipe } from '../../../src-shared/recipe';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateRecipeStructure(recipe: Recipe): ValidationResult {
  const errors: string[] = [];

  if (recipe.nodes.length === 0) {
    errors.push('Recipe has no nodes');
    return { valid: false, errors };
  }

  const nodeIds = new Set(recipe.nodes.map((n) => n.id));

  // Check for duplicate node IDs
  if (nodeIds.size !== recipe.nodes.length) {
    errors.push('Recipe contains duplicate node IDs');
  }

  // Validate connections reference existing nodes
  for (const conn of recipe.connections) {
    if (conn.from !== 'input' && !nodeIds.has(conn.from)) {
      errors.push(`Connection references unknown source node: ${conn.from}`);
    }
    if (conn.to !== 'output' && !nodeIds.has(conn.to)) {
      errors.push(`Connection references unknown target node: ${conn.to}`);
    }
  }

  // Check for cycles via topological sort attempt
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    adj.set(id, []);
    inDegree.set(id, 0);
  }

  for (const conn of recipe.connections) {
    if (conn.from !== 'input' && conn.to !== 'output') {
      adj.get(conn.from)?.push(conn.to);
      inDegree.set(conn.to, (inDegree.get(conn.to) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited++;
    for (const next of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (visited !== nodeIds.size) {
    errors.push('Recipe contains a cycle');
  }

  return { valid: errors.length === 0, errors };
}
