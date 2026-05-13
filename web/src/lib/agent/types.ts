/**
 * ChatCut Agent — Core Types
 *
 * Types for the agentic tool-calling system: tool calls, results, and the
 * edit history tree that enables rollback/branching.
 */

import type { Track, PlaybackState } from '@/types/editor';

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

/** Snapshot of the full project state at a point in the edit history. */
export interface EditNodeSnapshot {
  tracks: Track[];
  playback: PlaybackState;
}

/**
 * A node in the edit history DAG.
 *
 * Each mutation tool call appends one node. Introspection calls do NOT create
 * nodes. The `snapshot` stores the full project state AFTER this edit was
 * applied, enabling DAG-based rollback without dependency on the undoStack.
 */
export interface EditNode {
  id: string;
  parentId: string | null;
  toolName: string;
  args: Record<string, unknown>;
  summary?: string;
  /** Full state AFTER this edit was applied — enables DAG rollback. */
  snapshot: EditNodeSnapshot;
  createdAt: number;
  /** Whether this edit is currently disabled (effect toggled off). */
  disabled?: boolean;
  /** The AppliedEffect.id this node created or modified (for apply_effect / update_effect_param). */
  appliedEffectId?: string;
  /** The clip this effect targets. */
  targetClipId?: string;
  /** If cascade-disabled by a parent apply_effect node, stores that node's id. */
  cascadeDisabledBy?: string;
}
