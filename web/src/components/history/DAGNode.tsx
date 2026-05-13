'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export interface DAGNodeData {
  label: string;
  toolName: string;
  isActive: boolean;
  isOnBranch: boolean;
  isDisabled: boolean;
  timestamp: number;
  [key: string]: unknown;
}

export type DAGFlowNode = Node<DAGNodeData, 'dagNode'>;

const NODE_WIDTH = 140;
const NODE_HEIGHT = 52;

export { NODE_WIDTH, NODE_HEIGHT };

export function DAGNode({ data, selected }: NodeProps<DAGFlowNode>) {
  const { label, isActive, isOnBranch, isDisabled } = data;

  // Build class list based on state
  let borderClass: string;
  let bgClass: string;
  let opacityClass: string;

  if (isActive) {
    borderClass = 'border-blue-500';
    bgClass = 'bg-neutral-800';
    opacityClass = 'opacity-100';
  } else if (isOnBranch) {
    borderClass = 'border-neutral-600';
    bgClass = 'bg-neutral-850';
    opacityClass = 'opacity-100';
  } else {
    borderClass = 'border-dashed border-neutral-700';
    bgClass = 'bg-neutral-900';
    opacityClass = 'opacity-40';
  }

  const selectedClass = selected ? 'ring-2 ring-blue-400' : '';
  const textClass = isDisabled
    ? 'line-through text-neutral-500'
    : 'text-neutral-200';

  return (
    <div
      className={`
        flex items-center justify-center rounded-md border px-2 py-1
        text-xs select-none cursor-pointer transition-all
        ${borderClass} ${bgClass} ${opacityClass} ${selectedClass}
      `}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-1.5 !h-1.5 !bg-neutral-500 !border-none !min-w-0 !min-h-0"
      />

      <span className={`truncate leading-tight ${textClass}`}>{label}</span>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-1.5 !h-1.5 !bg-neutral-500 !border-none !min-w-0 !min-h-0"
      />
    </div>
  );
}
