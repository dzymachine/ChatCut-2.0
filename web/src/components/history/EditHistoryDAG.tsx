'use client';

import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { useEditorStore } from '@/lib/store/editor-store';
import { isOnActiveBranch } from '@/lib/history/dag-utils';
import { DAGNode, NODE_WIDTH, NODE_HEIGHT, type DAGFlowNode } from './DAGNode';
import { formatToolName } from './format-helpers';

// ── Module-scope node types (avoids React Flow re-render warnings) ──────────
const nodeTypes = { dagNode: DAGNode };

// ── Props ───────────────────────────────────────────────────────────────────
interface EditHistoryDAGProps {
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
}

// ── Layout helper ───────────────────────────────────────────────────────────
function layoutDAG(
  nodes: DAGFlowNode[],
  edges: Edge[],
): DAGFlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 60 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

// ── Component ───────────────────────────────────────────────────────────────
export function EditHistoryDAG({
  selectedNodeId,
  onNodeSelect,
}: EditHistoryDAGProps) {
  const editHistory = useEditorStore((s) => s.editHistory);
  const activeNodeId = useEditorStore((s) => s.activeNodeId);
  const activateNode = useEditorStore((s) => s.activateNode);

  // Phase 1: Layout — only re-run dagre when editHistory or activeNodeId change.
  const { layoutNodes, edges } = useMemo(() => {
    if (editHistory.length === 0) return { layoutNodes: [], edges: [] as Edge[] };

    const rawEdges: Edge[] = [];
    const rawNodes: DAGFlowNode[] = [];

    for (const editNode of editHistory) {
      const onBranch = isOnActiveBranch(editHistory, editNode.id, activeNodeId);

      rawNodes.push({
        id: editNode.id,
        type: 'dagNode',
        position: { x: 0, y: 0 }, // will be set by dagre
        data: {
          label: editNode.summary || formatToolName(editNode.toolName),
          toolName: editNode.toolName,
          isActive: editNode.id === activeNodeId,
          isOnBranch: onBranch,
          isDisabled: editNode.disabled === true,
          timestamp: editNode.createdAt,
        },
      });

      if (editNode.parentId) {
        rawEdges.push({
          id: `e-${editNode.parentId}-${editNode.id}`,
          source: editNode.parentId,
          target: editNode.id,
          style: { stroke: onBranch ? '#525252' : '#3f3f46', strokeWidth: 1.5 },
        });
      }
    }

    return { layoutNodes: layoutDAG(rawNodes, rawEdges), edges: rawEdges };
  }, [editHistory, activeNodeId]);

  // Phase 2: Apply selection — runs on selection change without re-running dagre.
  const rfNodes = useMemo(
    () =>
      layoutNodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    [layoutNodes, selectedNodeId],
  );
  const rfEdges = edges;

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeSelect(node.id);
    },
    [onNodeSelect],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      activateNode(node.id);
    },
    [activateNode],
  );

  if (editHistory.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-neutral-500">
        No edits yet.
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
