# F003: Tree-as-Project File

> **Status:** planned
> **Target:** Phase 2 (post 2026-05-15)
> **Last touched:** 2026-05-11

## Summary

The `editHistory` tree **is** the `.chatcut` project file. Rolling back = checking out a node. Branches enable A/B exploration of different edit paths.

## Origin

Sprint plan §"Vision direction" item 4 (`docs/superpowers/plans/2026-05-01-agentic-chat-first-sprint.md:281`). Data model from the current sprint already supports it — `EditNode` has `parentId` for tree structure (`lib/agent/types.ts`).

## Requirements (placeholder)

1. **Persistent tree:** Save the full `editHistory` tree to the `.chatcut` file (currently only saves final project state).
2. **Branch creation:** When rolling back to a node and making a new edit, create a branch (sibling node) instead of truncating.
3. **Branch navigation:** UI shows the tree with branches. Click any node to restore that state.
4. **Diff view:** Show what changed between any two nodes (track-level diff, not pixel diff).
5. **Merge:** Ability to merge effects/changes from one branch into another.

## Dependencies

- Current `rollbackToNode()` truncates history past the target node (`editor-store.ts`). Must change to preserve siblings.
- Serializer (`lib/project/serializer.ts`) must include `editHistory[]` in the save format.
- Tree visualization component (could use a library like `react-flow` or custom SVG).

## Current state of support

- `EditNode` already has `parentId: string | null` (`lib/agent/types.ts`) — tree-ready.
- `rollbackToNode()` currently truncates. Changing to branch-preserving is the main code change.
- Undo stack snapshots (`undoStack[snapshotIndex]`) already capture full state per node.
