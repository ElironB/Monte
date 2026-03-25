import type {
  SimulationGraphEdge,
  SimulationGraphEdgeStats,
  SimulationGraphEnvelope,
  SimulationGraphNode,
  SimulationGraphNodeStats,
  SimulationGraphSnapshot,
  SimulationGraphTraceSample,
} from './types';

const GRAPH_PADDING_X = 84;
const GRAPH_PADDING_Y = 64;
const GRAPH_COLUMN_GAP = 244;
const GRAPH_ROW_GAP = 132;

export interface GraphLayoutNode extends SimulationGraphNode {
  depth: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface GraphLayoutEdge extends SimulationGraphEdge {
  path: string;
}

export interface GraphLayoutResult {
  width: number;
  height: number;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
}

function getNodeDimensions(type: SimulationGraphNode['type']) {
  if (type === 'decision') {
    return { width: 212, height: 98 };
  }

  if (type === 'event') {
    return { width: 188, height: 82 };
  }

  return { width: 170, height: 68 };
}

function buildDepthMap(graph: SimulationGraphEnvelope): Map<string, number> {
  const depthMap = new Map<string, number>([[graph.entryNodeId, 0]]);
  const adjacency = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const entries = adjacency.get(edge.fromNodeId) ?? [];
    entries.push(edge.toNodeId);
    adjacency.set(edge.fromNodeId, entries);
  }

  const queue = [graph.entryNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    const depth = depthMap.get(nodeId) ?? 0;
    for (const nextNodeId of adjacency.get(nodeId) ?? []) {
      if (!depthMap.has(nextNodeId)) {
        depthMap.set(nextNodeId, depth + 1);
        queue.push(nextNodeId);
      }
    }
  }

  let fallbackDepth = Math.max(...depthMap.values(), 0) + 1;
  for (const node of graph.nodes) {
    if (!depthMap.has(node.id)) {
      depthMap.set(node.id, fallbackDepth);
      fallbackDepth += 1;
    }
  }

  return depthMap;
}

function buildEdgePath(from: GraphLayoutNode, to: GraphLayoutNode): string {
  const startX = from.x + from.width;
  const startY = from.centerY;
  const endX = to.x;
  const endY = to.centerY;
  const curve = Math.max(34, Math.abs(endX - startX) * 0.45);

  return [
    `M ${startX} ${startY}`,
    `C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`,
  ].join(' ');
}

function buildTracePath(pathNodeIds: string[], nodeMap: Map<string, GraphLayoutNode>): string | null {
  const points = pathNodeIds
    .map((nodeId) => nodeMap.get(nodeId))
    .filter((node): node is GraphLayoutNode => Boolean(node))
    .map((node) => ({ x: node.centerX, y: node.centerY }));

  if (points.length < 2) {
    return null;
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const curve = Math.max(24, Math.abs(current.x - previous.x) * 0.42);
    commands.push(
      `C ${previous.x + curve} ${previous.y}, ${current.x - curve} ${current.y}, ${current.x} ${current.y}`,
    );
  }

  return commands.join(' ');
}

export function layoutSimulationGraph(graph: SimulationGraphEnvelope): GraphLayoutResult {
  const depthMap = buildDepthMap(graph);
  const byDepth = new Map<number, SimulationGraphNode[]>();

  for (const node of graph.nodes) {
    const depth = depthMap.get(node.id) ?? 0;
    const entries = byDepth.get(depth) ?? [];
    entries.push(node);
    byDepth.set(depth, entries);
  }

  const nodes: GraphLayoutNode[] = [];
  const maxDepth = Math.max(...byDepth.keys(), 0);

  for (const [depth, entries] of [...byDepth.entries()].sort((left, right) => left[0] - right[0])) {
    entries.forEach((node, row) => {
      const dimensions = getNodeDimensions(node.type);
      const x = GRAPH_PADDING_X + depth * GRAPH_COLUMN_GAP;
      const y = GRAPH_PADDING_Y + row * GRAPH_ROW_GAP;
      nodes.push({
        ...node,
        depth,
        row,
        x,
        y,
        width: dimensions.width,
        height: dimensions.height,
        centerX: x + dimensions.width / 2,
        centerY: y + dimensions.height / 2,
      });
    });
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphLayoutEdge[] = graph.edges
    .map((edge) => {
      const from = nodeMap.get(edge.fromNodeId);
      const to = nodeMap.get(edge.toNodeId);
      if (!from || !to) {
        return null;
      }

      return {
        ...edge,
        path: buildEdgePath(from, to),
      };
    })
    .filter((edge): edge is GraphLayoutEdge => Boolean(edge));

  const deepestColumnHeight = Math.max(
    ...[...byDepth.values()].map((entries) => entries.length),
    1,
  );

  return {
    width: GRAPH_PADDING_X * 2 + maxDepth * GRAPH_COLUMN_GAP + 240,
    height: GRAPH_PADDING_Y * 2 + deepestColumnHeight * GRAPH_ROW_GAP,
    nodes,
    edges,
  };
}

export function getNodeStatsMap(snapshot: SimulationGraphSnapshot | null | undefined) {
  return new Map<string, SimulationGraphNodeStats>(
    (snapshot?.nodes ?? []).map((node) => [node.nodeId, node]),
  );
}

export function getEdgeStatsMap(snapshot: SimulationGraphSnapshot | null | undefined) {
  return new Map<string, SimulationGraphEdgeStats>(
    (snapshot?.edges ?? []).map((edge) => [edge.edgeId, edge]),
  );
}

export function getTracePath(
  trace: SimulationGraphTraceSample,
  nodeMap: Map<string, GraphLayoutNode>,
): string | null {
  return buildTracePath(trace.pathNodeIds, nodeMap);
}

export function formatNodeVisitRatio(
  stats: SimulationGraphNodeStats | undefined,
  cloneCount: number,
): number {
  if (!stats || cloneCount <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, stats.visitCount / cloneCount));
}

export function getNodeOutcomeTone(stats: SimulationGraphNodeStats | undefined): 'success' | 'failure' | 'neutral' {
  if (!stats) {
    return 'neutral';
  }

  if (stats.successCount > Math.max(stats.failureCount, stats.neutralCount)) {
    return 'success';
  }

  if (stats.failureCount > Math.max(stats.successCount, stats.neutralCount)) {
    return 'failure';
  }

  return 'neutral';
}
