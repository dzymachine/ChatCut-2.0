'use client';

import { X, RotateCcw, Eye, EyeOff, GitBranch } from 'lucide-react';
import type { EditNode } from '@/lib/agent/types';
import { useEditorStore } from '@/lib/store/editor-store';
import { getChildren } from '@/lib/history/dag-utils';
import {
  formatRelativeTime,
  formatToolName,
  formatArgs,
  EFFECT_TOOLS,
} from './format-helpers';

interface NodeDetailPanelProps {
  node: EditNode;
  onClose: () => void;
}

export function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  const editHistory = useEditorStore((s) => s.editHistory);
  const activateNode = useEditorStore((s) => s.activateNode);
  const toggleEditNode = useEditorStore((s) => s.toggleEditNode);

  const children = getChildren(editHistory, node.id);
  const isEffectNode = EFFECT_TOOLS.has(node.toolName) && !!node.appliedEffectId;
  const isDisabled = node.disabled === true;
  const detail = formatArgs(node.toolName, node.args);

  const effectParams = node.args.parameters as
    | Record<string, number>
    | undefined;

  return (
    <div className="bg-neutral-900 text-neutral-200 p-3 h-full overflow-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium truncate">
            {formatToolName(node.toolName)}
          </h4>
          <p className="text-xs text-neutral-500 mt-0.5">
            {formatRelativeTime(node.createdAt)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Summary */}
      {node.summary && (
        <p className="text-xs text-neutral-300 mb-3">{node.summary}</p>
      )}

      {/* Formatted argument detail */}
      {detail && (
        <p className="text-xs font-mono text-blue-400/80 mb-3">{detail}</p>
      )}

      {/* Arguments */}
      {Object.keys(node.args).length > 0 && (
        <div className="mb-3">
          <h5 className="text-xs font-medium text-neutral-400 mb-1">
            Arguments
          </h5>
          <div className="space-y-0.5">
            {Object.entries(node.args).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs font-mono">
                <span className="text-neutral-500 shrink-0">{key}:</span>
                <span className="text-neutral-300 break-all">
                  {typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Effect controls */}
      {isEffectNode && effectParams && Object.keys(effectParams).length > 0 && (
        <div className="mb-3">
          <h5 className="text-xs font-medium text-neutral-400 mb-1">
            Effect Parameters
          </h5>
          <div className="space-y-0.5 mb-2">
            {Object.entries(effectParams).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs font-mono">
                <span className="text-neutral-500 shrink-0">{key}:</span>
                <span className="text-neutral-300">
                  {typeof value === 'number' ? value.toFixed(2) : String(value)}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => toggleEditNode(node.id)}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
          >
            {isDisabled ? (
              <>
                <EyeOff className="size-3 text-neutral-400" />
                <span className="text-neutral-400">Disabled</span>
              </>
            ) : (
              <>
                <Eye className="size-3 text-neutral-300" />
                <span className="text-neutral-300">Enabled</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Activate button */}
      <button
        onClick={() => activateNode(node.id)}
        className="flex items-center gap-1.5 w-full text-xs font-medium px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors mb-3"
      >
        <RotateCcw className="size-3" />
        Restore this state
      </button>

      {/* Branch info */}
      {children.length > 0 && (
        <div>
          <h5 className="flex items-center gap-1 text-xs font-medium text-neutral-400 mb-1">
            <GitBranch className="size-3" />
            Children ({children.length})
          </h5>
          <div className="space-y-0.5">
            {children.map((child) => (
              <div
                key={child.id}
                className="text-xs text-neutral-400 truncate"
              >
                {child.summary || formatToolName(child.toolName)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
