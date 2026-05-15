'use client';

import { useState } from 'react';
import { useEditorStore } from '@/lib/store/editor-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import type { EditNode } from '@/lib/agent/types';
import { EditHistoryDAG } from './EditHistoryDAG';
import { NodeDetailPanel } from './NodeDetailPanel';
import {
  formatRelativeTime,
  formatToolName,
  formatArgs,
  EFFECT_TOOLS,
} from './format-helpers';

interface EditHistoryPanelProps {
  onPopOut?: () => void;
  isFloating?: boolean;
}

export function EditHistoryPanel({ onPopOut, isFloating }: EditHistoryPanelProps = {}) {
  const editHistory = useEditorStore((s) => s.editHistory);
  const rollbackToNode = useEditorStore((s) => s.rollbackToNode);
  const toggleEditNode = useEditorStore((s) => s.toggleEditNode);
  const deleteEditNode = useEditorStore((s) => s.deleteEditNode);

  const [view, setView] = useState<'list' | 'graph'>('list');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode: EditNode | undefined = selectedNodeId
    ? editHistory.find((n) => n.id === selectedNodeId)
    : undefined;

  const reversedHistory = [...editHistory].reverse();

  if (reversedHistory.length === 0) {
    return (
      <div className="flex flex-col h-full bg-neutral-900">
        <div className="px-3 py-2 border-b border-neutral-800">
          <h3 className="text-sm font-medium text-neutral-200">Edit History</h3>
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-xs text-neutral-500 text-center">
            No edits yet. Use the chat to make changes and they will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* Header with view toggle */}
      <div className="px-3 py-2 border-b border-neutral-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-neutral-200">
              Edit History
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              {editHistory.length} edit{editHistory.length !== 1 ? 's' : ''}
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
              className={`px-2 py-0.5 text-xs font-medium transition-colors ${
                view === 'list'
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'bg-neutral-900 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setView('graph')}
              className={`px-2 py-0.5 text-xs font-medium transition-colors ${
                view === 'graph'
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'bg-neutral-900 text-neutral-500 hover:text-neutral-300'
              }`}
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

              return (
                <div
                  key={node.id}
                  className={`group flex items-start justify-between gap-2 px-3 py-2 rounded-md transition-colors ${
                    isDisabled
                      ? 'opacity-50'
                      : isLatest
                        ? 'bg-neutral-800/70 border border-neutral-700'
                        : 'hover:bg-neutral-800/50'
                  }`}
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

                    {!isLatest && !isEffectNode && (
                      <button
                        onClick={() => rollbackToNode(node.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs font-medium text-neutral-300 bg-neutral-700 hover:bg-neutral-600 rounded"
                      >
                        Rollback
                      </button>
                    )}

                    {isLatest && (
                      <span className="px-2 py-0.5 text-xs font-medium text-green-400 bg-green-900/30 rounded">
                        Current
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
