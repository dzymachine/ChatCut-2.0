/**
 * Recipe Compiler — Recipe AST → FFmpeg filter chain string.
 *
 * Generic compilation: no per-filter switch statements.  Walks nodes
 * in topological order and emits standard FFmpeg filter syntax.
 */

import type { Recipe, RecipeNode } from '../../../src-shared/recipe';

/**
 * Compile a Recipe AST into an FFmpeg filter chain string.
 * Nodes are visited in topological order and joined with `,`.
 */
export function compileRecipe(recipe: Recipe): string {
  const order = topologicalSort(recipe);

  const nodeMap = new Map<string, Recipe['nodes'][number]>();
  for (const node of recipe.nodes) {
    nodeMap.set(node.id, node);
  }

  const filters: string[] = [];

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    if (node.raw) {
      filters.push(node.raw);
    } else if (node.filter) {
      const entries = Object.entries(node.params ?? {});
      if (entries.length === 0) {
        filters.push(node.filter);
      } else {
        const paramStr = entries
          .map(([k, v]) => `${k}=${formatValue(v)}`)
          .join(':');
        filters.push(`${node.filter}=${paramStr}`);
      }
    }
  }

  return filters.join(',');
}

function topologicalSort(recipe: Recipe): string[] {
  const nodeIds = new Set(recipe.nodes.map((n) => n.id));

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

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const next of adj.get(current) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (result.length !== nodeIds.size) {
    throw new Error('Recipe contains a cycle');
  }

  return result;
}

function formatValue(value: number | string | boolean): string {
  if (typeof value === 'number') {
    return parseFloat(value.toFixed(6)).toString();
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  return String(value);
}
