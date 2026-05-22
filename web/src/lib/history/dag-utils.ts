/**
 * ChatCut — DAG Edit History Utilities
 *
 * Pure functions for traversing the edit history DAG. Used by both the
 * editor store (for navigation/rollback) and the visualization layer
 * (for rendering the branching tree).
 */

import type { EditNode } from '@/lib/agent/types';

/** Get direct children of a node */
export function getChildren(history: EditNode[], nodeId: string): EditNode[] {
  return history.filter(n => n.parentId === nodeId);
}

/** Get all ancestors from a node back to the root */
export function getAncestors(history: EditNode[], nodeId: string): EditNode[] {
  const ancestors: EditNode[] = [];
  let current = history.find(n => n.id === nodeId);
  while (current?.parentId) {
    const parent = history.find(n => n.id === current!.parentId);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

/** Get the set of node IDs on the active branch (from root to activeNodeId) */
export function getActiveBranch(history: EditNode[], activeNodeId: string | null): Set<string> {
  if (!activeNodeId) return new Set();
  const branch = new Set<string>();
  branch.add(activeNodeId);
  let current = history.find(n => n.id === activeNodeId);
  while (current?.parentId) {
    branch.add(current.parentId);
    current = history.find(n => n.id === current!.parentId);
  }
  return branch;
}

/** Get root nodes (nodes with no parent) */
export function getRoots(history: EditNode[]): EditNode[] {
  return history.filter(n => n.parentId === null);
}

/** Check if a node is on the active branch */
export function isOnActiveBranch(
  history: EditNode[],
  nodeId: string,
  activeNodeId: string | null
): boolean {
  return getActiveBranch(history, activeNodeId).has(nodeId);
}

/** Check if a node is an ancestor of another node */
export function isAncestorOf(
  history: EditNode[],
  possibleAncestorId: string,
  descendantId: string
): boolean {
  const ancestors = getAncestors(history, descendantId);
  return ancestors.some(a => a.id === possibleAncestorId);
}

/** Get the most recent child of a node (by createdAt) */
export function getMostRecentChild(history: EditNode[], nodeId: string): EditNode | null {
  const children = getChildren(history, nodeId);
  if (children.length === 0) return null;
  return children.reduce((a, b) => a.createdAt > b.createdAt ? a : b);
}
