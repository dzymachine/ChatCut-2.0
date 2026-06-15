/**
 * History slice — linear undo/redo stacks, undo batching, and the agent's
 * DAG-style edit history (EditNodes).
 *
 * Owns: `undoStack`, `redoStack`, `_undoBatch`, `editHistory`, `activeNodeId`
 * Actions: pushUndo, undo, redo, canUndo, canRedo, beginUndoBatch,
 * commitUndoBatch, cancelUndoBatch, appendEditNode, activateNode,
 * rollbackToNode, updateEditNodeSummary, toggleEditNode, deleteEditNode
 *
 * Cross-slice notes:
 *   - undo/redo/activateNode restore `project.tracks` and `playback` from
 *     command/node snapshots.
 *   - toggleEditNode/deleteEditNode call the project slice's
 *     toggleEffect/removeEffect.
 *   - project-slice actions (addClipFromMedia, addTrack) push undo entries
 *     via pushUndo; initProject clears both stacks and activeNodeId.
 */

import type { StateCreator } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { Command } from '@/types/editor';
import type { EditNode, EditNodeSnapshot } from '@/lib/agent/types';
import { calculateDuration } from '@/lib/project/sequence';
import type { EditorStore } from './types';

type HistorySliceKeys =
  | 'undoStack'
  | 'redoStack'
  | '_undoBatch'
  | 'editHistory'
  | 'activeNodeId'
  | 'pushUndo'
  | 'undo'
  | 'redo'
  | 'canUndo'
  | 'canRedo'
  | 'beginUndoBatch'
  | 'commitUndoBatch'
  | 'cancelUndoBatch'
  | 'appendEditNode'
  | 'activateNode'
  | 'rollbackToNode'
  | 'updateEditNodeSummary'
  | 'toggleEditNode'
  | 'deleteEditNode';

type HistorySlice = Pick<EditorStore, HistorySliceKeys>;

export const createHistorySlice: StateCreator<EditorStore, [], [], HistorySlice> = (set, get) => ({
  // ── Initial State ──
  undoStack: [],
  redoStack: [],
  _undoBatch: null,
  editHistory: [],
  activeNodeId: null,

  // ── Undo/Redo ──

  pushUndo: (command) => {
    const MAX_UNDO = 50;
    const fullCommand: Command = {
      ...command,
      id: uuid(),
      timestamp: Date.now(),
    };
    set((state) => {
      const stack = [...state.undoStack, fullCommand];
      if (stack.length > MAX_UNDO) stack.splice(0, stack.length - MAX_UNDO);
      return {
        undoStack: stack,
        redoStack: [],
      };
    });
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;

    const command = state.undoStack[state.undoStack.length - 1];
    const newUndoStack = state.undoStack.slice(0, -1);

    // Apply the previous state
    const updates: Partial<EditorStore> = {};
    if (command.previousState.tracks) {
      updates.project = {
        ...state.project,
        tracks: command.previousState.tracks,
        composition: {
          ...state.project.composition,
          duration: calculateDuration(command.previousState.tracks),
        },
      };
    }
    if (command.previousState.playback) {
      updates.playback = command.previousState.playback;
    }
    if (command.previousState.editHistory) {
      updates.editHistory = command.previousState.editHistory;
    }
    if (command.previousState.activeNodeId !== undefined) {
      (updates as Record<string, unknown>).activeNodeId = command.previousState.activeNodeId;
    }

    set({
      ...updates,
      undoStack: newUndoStack,
      redoStack: [...state.redoStack, command],
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;

    const command = state.redoStack[state.redoStack.length - 1];
    const newRedoStack = state.redoStack.slice(0, -1);

    const updates: Partial<EditorStore> = {};
    if (command.nextState.tracks) {
      updates.project = {
        ...state.project,
        tracks: command.nextState.tracks,
        composition: {
          ...state.project.composition,
          duration: calculateDuration(command.nextState.tracks),
        },
      };
    }
    if (command.nextState.playback) {
      updates.playback = command.nextState.playback;
    }
    if (command.nextState.editHistory) {
      updates.editHistory = command.nextState.editHistory;
    }
    if (command.nextState.activeNodeId !== undefined) {
      (updates as Record<string, unknown>).activeNodeId = command.nextState.activeNodeId;
    }

    set({
      ...updates,
      undoStack: [...state.undoStack, command],
      redoStack: newRedoStack,
    });
  },

  canUndo: () => {
    const state = get();
    // DAG-aware: can undo if active node has a parent
    if (state.activeNodeId) {
      const activeNode = state.editHistory.find(n => n.id === state.activeNodeId);
      if (activeNode?.parentId) return true;
    }
    return state.undoStack.length > 0;
  },

  canRedo: () => {
    const state = get();
    // DAG-aware: can redo if active node has children
    if (state.activeNodeId) {
      const hasChildren = state.editHistory.some(n => n.parentId === state.activeNodeId);
      if (hasChildren) return true;
    }
    return state.redoStack.length > 0;
  },

  beginUndoBatch: (description) => {
    const state = get();
    if (state._undoBatch) {
      console.warn('[EditorStore] beginUndoBatch called while batch already active — committing previous batch');
      state.commitUndoBatch();
    }
    set({
      _undoBatch: {
        description,
        snapshotTracks: structuredClone(state.project.tracks),
        snapshotPlayback: structuredClone(state.playback),
        snapshotEditHistory: state.editHistory,
      },
    });
  },

  commitUndoBatch: () => {
    const state = get();
    const batch = state._undoBatch;
    if (!batch) return;

    const afterTracks = state.project.tracks;
    const afterPlayback = state.playback;
    const afterEditHistory = state.editHistory;

    const tracksChanged = batch.snapshotTracks !== afterTracks && JSON.stringify(batch.snapshotTracks) !== JSON.stringify(afterTracks);
    const playbackChanged = batch.snapshotPlayback !== afterPlayback && JSON.stringify(batch.snapshotPlayback) !== JSON.stringify(afterPlayback);
    const editHistoryChanged = batch.snapshotEditHistory !== afterEditHistory;

    if (tracksChanged || playbackChanged || editHistoryChanged) {
      state.pushUndo({
        description: batch.description,
        previousState: {
          tracks: batch.snapshotTracks,
          ...(playbackChanged ? { playback: batch.snapshotPlayback } : {}),
          ...(editHistoryChanged ? { editHistory: batch.snapshotEditHistory } : {}),
        },
        nextState: {
          tracks: structuredClone(afterTracks),
          ...(playbackChanged ? { playback: structuredClone(afterPlayback) } : {}),
          ...(editHistoryChanged ? { editHistory: structuredClone(afterEditHistory) } : {}),
        },
      });
    }

    set({ _undoBatch: null });
  },

  cancelUndoBatch: () => {
    set({ _undoBatch: null });
  },

  // ── Edit History (Agent) ──

  appendEditNode: (node) => {
    const id = uuid();
    const state = get();
    const snapshot: EditNodeSnapshot = {
      tracks: structuredClone(state.project.tracks),
      playback: structuredClone(state.playback),
    };
    const fullNode: EditNode = {
      ...node,
      id,
      parentId: state.activeNodeId,
      snapshot,
      createdAt: Date.now(),
    };
    set((s) => {
      const newEditHistory = [...s.editHistory, fullNode];

      // Amend the most recent undo Command so its previousState/nextState
      // cover the editHistory transition this append creates. Without this,
      // Cmd-Z restores tracks but leaves the orphaned EditNode visible in
      // the panel — the classic "history doesn't update on undo" bug.
      //
      // We rely on tool-registry.executeToolWithHistory calling this
      // immediately after the handler's commitUndoBatch, so the latest
      // command IS the one we want to amend. If there's no command (the
      // append happened outside a tool-invocation context), we just append
      // without affecting undo state.
      let newUndoStack = s.undoStack;
      if (s.undoStack.length > 0) {
        const lastIdx = s.undoStack.length - 1;
        const lastCmd = s.undoStack[lastIdx];
        newUndoStack = [
          ...s.undoStack.slice(0, lastIdx),
          {
            ...lastCmd,
            previousState: {
              ...lastCmd.previousState,
              // If the handler's batch already captured editHistory (e.g.
              // toggle/delete edit-node flows), don't overwrite it — that
              // version corresponds to the batch's begin point. Otherwise
              // capture the pre-append history.
              editHistory: lastCmd.previousState.editHistory ?? s.editHistory,
              activeNodeId: lastCmd.previousState.activeNodeId ?? s.activeNodeId,
            },
            nextState: {
              ...lastCmd.nextState,
              editHistory: newEditHistory,
              activeNodeId: id,
            },
          },
        ];
      }

      return { editHistory: newEditHistory, undoStack: newUndoStack, activeNodeId: id };
    });
    return id;
  },

  activateNode: (nodeId) => {
    const state = get();
    const node = state.editHistory.find((n) => n.id === nodeId);
    if (!node) return;

    set({
      project: {
        ...state.project,
        tracks: structuredClone(node.snapshot.tracks),
        composition: {
          ...state.project.composition,
          duration: calculateDuration(node.snapshot.tracks),
        },
      },
      playback: structuredClone(node.snapshot.playback),
      activeNodeId: nodeId,
      // DO NOT truncate editHistory — branches are preserved
    });
  },

  rollbackToNode: (nodeId) => {
    // Backward compat wrapper
    get().activateNode(nodeId);
  },

  updateEditNodeSummary: (nodeId, summary) => {
    set((state) => ({
      editHistory: state.editHistory.map((node) =>
        node.id === nodeId ? { ...node, summary } : node
      ),
    }));
  },

  toggleEditNode: (nodeId) => {
    const state = get();
    const node = state.editHistory.find((n) => n.id === nodeId);
    if (!node) return;

    const isEffectTool = node.toolName === 'apply_effect' || node.toolName === 'update_effect_param';
    if (!isEffectTool || !node.appliedEffectId || !node.targetClipId) return;

    const enabling = node.disabled === true;

    get().beginUndoBatch(enabling ? 'Re-enable edit' : 'Disable edit');

    if (node.toolName === 'apply_effect') {
      get().toggleEffect(node.targetClipId, node.appliedEffectId, enabling);

      // Cascade to all update_effect_param nodes for the same effect
      set((s) => ({
        editHistory: s.editHistory.map((n) => {
          if (n.id === nodeId) {
            return { ...n, disabled: !enabling, cascadeDisabledBy: undefined };
          }
          if (
            n.toolName === 'update_effect_param' &&
            n.appliedEffectId === node.appliedEffectId &&
            n.targetClipId === node.targetClipId
          ) {
            if (!enabling) {
              // Only cascade-disable children that aren't already disabled.
              // Preserves a child's independent disable (cascadeDisabledBy === undefined)
              // or a disable from a different ancestor.
              if (!n.disabled) {
                return { ...n, disabled: true, cascadeDisabledBy: nodeId };
              }
              return n;
            }
            // Re-enable only children this node cascaded over.
            if (n.cascadeDisabledBy === nodeId) {
              return { ...n, disabled: false, cascadeDisabledBy: undefined };
            }
          }
          return n;
        }),
      }));
    } else {
      // update_effect_param — toggle the effect's enabled state
      get().toggleEffect(node.targetClipId, node.appliedEffectId, enabling);
      set((s) => ({
        editHistory: s.editHistory.map((n) =>
          n.id === nodeId ? { ...n, disabled: !enabling } : n
        ),
      }));
    }

    get().commitUndoBatch();
  },

  deleteEditNode: (nodeId) => {
    const state = get();
    const node = state.editHistory.find((n) => n.id === nodeId);
    if (!node) return;

    const isEffectTool = node.toolName === 'apply_effect' || node.toolName === 'update_effect_param';
    if (!isEffectTool || !node.appliedEffectId || !node.targetClipId) return;

    get().beginUndoBatch('Delete edit');

    if (node.toolName === 'apply_effect') {
      get().removeEffect(node.targetClipId, node.appliedEffectId);

      // Remove this node and all cascaded update_effect_param children
      set((s) => ({
        editHistory: s.editHistory.filter((n) => {
          if (n.id === nodeId) return false;
          if (
            n.toolName === 'update_effect_param' &&
            n.appliedEffectId === node.appliedEffectId &&
            n.targetClipId === node.targetClipId
          ) return false;
          return true;
        }),
      }));
    } else {
      // update_effect_param — remove this specific parameter update
      // Revert would require stored previous values; for now just remove the node
      set((s) => ({
        editHistory: s.editHistory.filter((n) => n.id !== nodeId),
      }));
    }

    get().commitUndoBatch();
  },
});
