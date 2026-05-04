'use client';

import { useEditorStore } from '@/lib/store/editor-store';
import { ScrollArea } from '@/components/ui/scroll-area';

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.floor(diffHours / 24)}d ago`;
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatArgs(toolName: string, args: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'apply_effect': {
      const effectId = args.effect_id as string;
      const params = args.parameters as Record<string, number> | undefined;
      if (!effectId) return null;
      const name = effectId.replace(/_/g, ' ');
      if (params && Object.keys(params).length > 0) {
        const paramStr = Object.entries(params)
          .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`)
          .join(', ');
        return `${name} (${paramStr})`;
      }
      return name;
    }
    case 'update_effect_param': {
      const params = args.parameters as Record<string, number> | undefined;
      if (params) {
        return Object.entries(params)
          .map(([k, v]) => `${k} = ${typeof v === 'number' ? v.toFixed(2) : v}`)
          .join(', ');
      }
      return null;
    }
    case 'trim_clip': {
      const parts: string[] = [];
      if (args.source_start != null) parts.push(`start: ${Number(args.source_start).toFixed(1)}s`);
      if (args.source_end != null) parts.push(`end: ${Number(args.source_end).toFixed(1)}s`);
      return parts.length > 0 ? parts.join(', ') : null;
    }
    case 'move_clip':
      return args.timeline_start != null ? `to ${Number(args.timeline_start).toFixed(1)}s` : null;
    case 'remove_clip':
      return args.clip_id ? `clip ${(args.clip_id as string).slice(0, 8)}` : null;
    default:
      return null;
  }
}

export function EditHistoryPanel() {
  const editHistory = useEditorStore((s) => s.editHistory);
  const rollbackToNode = useEditorStore((s) => s.rollbackToNode);

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
      <div className="px-3 py-2 border-b border-neutral-800">
        <h3 className="text-sm font-medium text-neutral-200">Edit History</h3>
        <p className="text-xs text-neutral-500 mt-0.5">
          {editHistory.length} edit{editHistory.length !== 1 ? 's' : ''}
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {reversedHistory.map((node, index) => {
            const isLatest = index === 0;
            const detail = formatArgs(node.toolName, node.args);
            return (
              <div
                key={node.id}
                className={`group flex items-start justify-between gap-2 px-3 py-2 rounded-md transition-colors ${
                  isLatest
                    ? 'bg-neutral-800/70 border border-neutral-700'
                    : 'hover:bg-neutral-800/50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-200 truncate">
                    {node.summary || formatToolName(node.toolName)}
                  </p>
                  {detail && (
                    <p className="text-xs text-blue-400/80 font-mono truncate mt-0.5">
                      {detail}
                    </p>
                  )}
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {formatRelativeTime(node.createdAt)}
                  </p>
                </div>
                {!isLatest && (
                  <button
                    onClick={() => rollbackToNode(node.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs font-medium text-neutral-300 bg-neutral-700 hover:bg-neutral-600 rounded mt-0.5"
                  >
                    Rollback
                  </button>
                )}
                {isLatest && (
                  <span className="shrink-0 px-2 py-0.5 text-xs font-medium text-green-400 bg-green-900/30 rounded mt-0.5">
                    Current
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
