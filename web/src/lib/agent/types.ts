/**
 * ChatCut Agent — Core Types
 *
 * Types for the agentic tool-calling system: tool calls, results, and the
 * edit history tree that enables rollback/branching.
 */

// ─── Tool Call / Result ────────────────────────────────────────────────────────

/** A single tool invocation from the LLM. */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** The result returned after executing a tool. */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── Edit History ──────────────────────────────────────────────────────────────

/**
 * A node in the edit history DAG.
 *
 * Each mutation tool call appends one node. Introspection calls do NOT create
 * nodes. The `snapshotIndex` points into the undoStack so that `rollbackToNode`
 * can restore the project state to the point AFTER this edit was applied.
 */
export interface EditNode {
  id: string;
  parentId: string | null;
  toolName: string;
  args: Record<string, unknown>;
  summary?: string;
  /** Index into the undoStack — the Command at this index is the one this edit pushed. */
  snapshotIndex: number;
  createdAt: number;
}
