'use client';

import { useMemo, useState } from 'react';
import { useEditorStore } from '@/lib/store/editor-store';
import { cva } from 'class-variance-authority';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import type { EditNode } from '@/lib/agent/types';
import { EditHistoryDAG } from './EditHistoryDAG';
import { NodeDetailPanel } from './NodeDetailPanel';
import { isOnActiveBranch } from '@/lib/history/dag-utils';
import {
  formatRelativeTime,
  formatToolName,
  formatArgs,
  EFFECT_TOOLS,
} from './format-helpers';

const segmentToggle = cva(
  'px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      active: {
        true: 'bg-neutral-700 text-neutral-200',
        false: 'bg-neutral-900 text-neutral-500 hover:text-neutral-300',
      },
    },
    defaultVariants: { active: false },
  }
);

const historyItemRow = cva(
  'group flex items-start justify-between gap-2 px-3 py-2 rounded-md transition-colors',
  {
    variants: {
      state: {
        disabled: 'opacity-50',
        orphan: 'opacity-40 border border-dashed border-neutral-700/60 hover:opacity-70',
        active: 'bg-neutral-800/70 border border-neutral-700',
        idle: 'hover:bg-neutral-800/50',
      },
    },
    defaultVariants: { state: 'idle' },
  }
);

interface EditHistoryPanelProps {
  onPopOut?: () => void;
  isFloating?: boolean;
}

export function EditHistoryPanel({ onPopOut, isFloating }: EditHistoryPanelProps = {}) {
  const editHistory = useEditorStore((s) => s.editHistory);
  const activeNodeId = useEditorStore((s) => s.activeNodeId);
  const rollbackToNode = useEditorStore((s) => s.rollbackToNode);
  const toggleEditNode = useEditorStore((s) => s.toggleEditNode);
  const deleteEditNode = useEditorStore((s) => s.deleteEditNode);

  const [view, setView] = useState<'list' | 'graph'>('list');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // After rollback, descendants of the active node are "orphans" on a parallel
  // branch. Hide by default so the list reflects the current state; toggle to
  // show all (e.g. to re-enter an orphan branch).
  const [showOrphans, setShowOrphans] = useState(false);

  const selectedNode: EditNode | undefined = selectedNodeId
    ? editHistory.find((n) => n.id === selectedNodeId)
    : undefined;

  // List view: show ancestors of activeNodeId (root → active) by default.
  // Orphans (descendants of any ancestor not on the active path) are excluded
  // unless showOrphans is true.
  const visibleHistory = useMemo(() => {
    if (!activeNodeId) return editHistory;
    if (showOrphans) return editHistory;
    return editHistory.filter((n) => isOnActiveBranch(editHistory, n.id, activeNodeId));
  }, [editHistory, activeNodeId, showOrphans]);
  const orphanCount = editHistory.length - visibleHistory.length;

  const reversedHistory = [...visibleHistory].reverse();

  if (reversedHistory.length === 0) {
    return (
      <div className="flex flex-col h-full bg-neutral-900">
        <div className="panel-section">
          <h3 className="text-sm font-medium text-neutral-200">Edit History</h3>
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="muted-label text-center">
            No edits yet. Use the chat to make changes and they will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* Header with view toggle */}
      <div className="panel-section">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-neutral-200">
              Edit History
            </h3>
            <p className="muted-label mt-0.5">
              {visibleHistory.length} of {editHistory.length} edit{editHistory.length !== 1 ? 's' : ''}
              {orphanCount > 0 && (
                <button
                  onClick={() => setShowOrphans((v) => !v)}
                  className="ml-2 px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-300 hover:bg-amber-900/50 transition-colors text-[10px] font-medium"
                  title="Edits from a branch you rolled back from — hidden by default"
                >
                  {showOrphans ? `hide other branch` : `${orphanCount} on other branch`}
                </button>
              )}
            </p>
          </div>

          {/* Pop-out button + List / Graph toggle */}
          <div className="flex items-center gap-1.5">
          {onPopOut && !isFloating && (
            <button
              onClick={onPopOut}
              className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
              title="Pop out edit history"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          )}
          <div className="flex rounded-md border border-neutral-700 overflow-hidden">
            <button
              onClick={() => setView('list')}
              className={segmentToggle({ active: view === 'list' })}
            >
              List
            </button>
            <button
              onClick={() => setView('graph')}
              className={segmentToggle({ active: view === 'graph' })}
            >
              Graph
            </button>
          </div>
          </div>
        </div>
      </div>

      {/* List View */}
      {view === 'list' && (
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {reversedHistory.map((node, index) => {
              const isLatest = index === 0 && !node.disabled;
              const detail = formatArgs(node.toolName, node.args);
              const isEffectNode =
                EFFECT_TOOLS.has(node.toolName) && !!node.appliedEffectId;
              const isDisabled = node.disabled === true;
              const isCascadeDisabled = !!node.cascadeDisabledBy;
              const isOnBranch = isOnActiveBranch(editHistory, node.id, activeNodeId);
              const isActive = node.id === activeNodeId;

              return (
                <div
                  key={node.id}
                  className={historyItemRow({
                    state: isDisabled ? 'disabled' : !isOnBranch ? 'orphan' : isActive ? 'active' : 'idle',
                  })}
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm break-words ${isDisabled ? 'text-neutral-500 line-through' : 'text-neutral-200'}`}
                    >
                      {node.summary || formatToolName(node.toolName)}
                    </p>
                    {detail && (
                      <p
                        className={`text-xs font-mono break-words mt-0.5 ${isDisabled ? 'text-neutral-600' : 'text-blue-400/80'}`}
                      >
                        {detail}
                      </p>
                    )}
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {formatRelativeTime(node.createdAt)}
                    </p>
                  </div>

                  <div className="shrink-0 flex items-center gap-1 mt-0.5">
                    {isEffectNode && !isCascadeDisabled && (
                      <>
                        <button
                          onClick={() => toggleEditNode(node.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-neutral-700"
                          title={isDisabled ? 'Enable effect' : 'Disable effect'}
                        >
                          {isDisabled ? (
                            <EyeOff className="size-3.5 text-neutral-400" />
                          ) : (
                            <Eye className="size-3.5 text-neutral-300" />
                          )}
                        </button>
                        <button
                          onClick={() => deleteEditNode(node.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-900/50"
                          title="Delete effect"
                        >
                          <Trash2 className="size-3.5 text-neutral-400 hover:text-red-400" />
                        </button>
                      </>
                    )}

                    {!isActive && !isEffectNode && (
                      <button
                        onClick={() => rollbackToNode(node.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs font-medium text-neutral-300 bg-neutral-700 hover:bg-neutral-600 rounded"
                        title={isOnBranch ? 'Move playhead to this state' : 'Switch to this branch'}
                      >
                        {isOnBranch ? 'Rollback' : 'Switch branch'}
                      </button>
                    )}

                    {isActive && (
                      <span className="px-2 py-0.5 text-xs font-medium text-green-400 bg-green-900/30 rounded">
                        Current
                      </span>
                    )}

                    {!isActive && !isOnBranch && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium text-amber-400/80 bg-amber-900/20 rounded" title="On a branch you rolled back from">
                        orphan
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Graph View */}
      {view === 'graph' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0">
            <EditHistoryDAG
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
            />
          </div>
          {selectedNode && (
            <div className="h-[280px] shrink-0 border-t border-neutral-800 overflow-auto">
              <NodeDetailPanel
                node={selectedNode}
                onClose={() => setSelectedNodeId(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
