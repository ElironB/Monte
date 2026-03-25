import type {
  CloneResult,
  GraphNode,
  Scenario,
  SimulationGraphEdge,
  SimulationGraphEdgeStats,
  SimulationGraphEnvelope,
  SimulationGraphMode,
  SimulationGraphNode,
  SimulationGraphNodeStats,
  SimulationGraphOutcome,
  SimulationGraphSnapshot,
  SimulationGraphTraceSample,
  SimulationState,
} from './types.js';

const TRACE_CATEGORY_ORDER: Array<'edge' | 'typical' | 'central'> = ['edge', 'typical', 'central'];
const DEFAULT_LABEL_LIMIT = 72;

export const DEFAULT_GRAPH_TRACE_SAMPLE_LIMIT = 12;

interface GraphStructure {
  entryNodeId: string;
  nodes: SimulationGraphNode[];
  edges: SimulationGraphEdge[];
}

interface LiveTraceSource {
  cloneId: string;
  category: 'edge' | 'central' | 'typical';
  currentNodeId?: string;
  pathNodeIds: string[];
  state: SimulationState;
}

interface MutableNodeStats extends SimulationGraphNodeStats {}
interface MutableEdgeStats extends SimulationGraphEdgeStats {}

function createNodeStats(nodeId: string): MutableNodeStats {
  return {
    nodeId,
    visitCount: 0,
    activeCount: 0,
    waitingCount: 0,
    completedCount: 0,
    successCount: 0,
    failureCount: 0,
    neutralCount: 0,
  };
}

function createEdgeStats(edge: SimulationGraphEdge): MutableEdgeStats {
  return {
    edgeId: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    transitionCount: 0,
  };
}

function sanitizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateLabel(value: string, limit = DEFAULT_LABEL_LIMIT): string {
  const normalized = sanitizeWhitespace(value);
  if (normalized.length <= limit) {
    return normalized;
  }

  const trimmed = normalized.slice(0, Math.max(0, limit - 1)).trimEnd();
  return `${trimmed}…`;
}

function titleCaseId(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getNodePresentation(node: GraphNode): Pick<SimulationGraphNode, 'label' | 'detail'> {
  if (node.type === 'decision') {
    const detail = sanitizeWhitespace(node.prompt);
    const headline = detail.split(/[?.!]/)[0] || detail;
    return {
      label: truncateLabel(headline),
      detail,
    };
  }

  if (node.type === 'event') {
    return {
      label: truncateLabel(node.name),
      detail: sanitizeWhitespace(node.description),
    };
  }

  const outcomeName = typeof node.results.outcome === 'string'
    ? titleCaseId(node.results.outcome)
    : titleCaseId(node.id);
  const detail = Object.entries(node.results)
    .map(([key, value]) => `${titleCaseId(key)}: ${String(value)}`)
    .join(' · ');

  return {
    label: truncateLabel(outcomeName),
    detail: detail || 'Terminal outcome',
  };
}

function getEdgeLookup(edges: SimulationGraphEdge[]): Map<string, SimulationGraphEdge> {
  return new Map(
    edges.map((edge) => [`${edge.kind}:${edge.fromNodeId}:${edge.branchId}`, edge]),
  );
}

function getTraceOutcome(metrics: Record<string, number>): SimulationGraphOutcome {
  const value = metrics.outcomeValue;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'neutral';
  }

  if (value >= 0.75) {
    return 'success';
  }

  if (value <= 0.25) {
    return 'failure';
  }

  return 'neutral';
}

function accumulateOutcome(stats: MutableNodeStats, outcome: SimulationGraphOutcome): void {
  if (outcome === 'success') {
    stats.successCount += 1;
    return;
  }

  if (outcome === 'failure') {
    stats.failureCount += 1;
    return;
  }

  stats.neutralCount += 1;
}

function getOrCreateNodeStats(
  map: Map<string, MutableNodeStats>,
  nodeId: string,
): MutableNodeStats {
  const existing = map.get(nodeId);
  if (existing) {
    return existing;
  }

  const next = createNodeStats(nodeId);
  map.set(nodeId, next);
  return next;
}

function getOrCreateEdgeStats(
  map: Map<string, MutableEdgeStats>,
  edge: SimulationGraphEdge,
): MutableEdgeStats {
  const existing = map.get(edge.id);
  if (existing) {
    return existing;
  }

  const next = createEdgeStats(edge);
  map.set(edge.id, next);
  return next;
}

function extractGraphTransitions(
  state: SimulationState,
  edgeLookup: Map<string, SimulationGraphEdge>,
): SimulationGraphEdge[] {
  const transitions: SimulationGraphEdge[] = [];

  for (const decision of state.decisions) {
    const edge = edgeLookup.get(`decision:${decision.nodeId}:${decision.choice}`);
    if (edge) {
      transitions.push(edge);
    }
  }

  for (const event of state.events) {
    if (event.source && event.source !== 'graph') {
      continue;
    }

    if (!event.outcomeId) {
      continue;
    }

    const edge = edgeLookup.get(`event:${event.nodeId}:${event.outcomeId}`);
    if (edge) {
      transitions.push(edge);
    }
  }

  return transitions;
}

function withCurrentNode(pathNodeIds: string[], currentNodeId?: string): string[] {
  if (!currentNodeId) {
    return [...pathNodeIds];
  }

  const next = [...pathNodeIds];
  if (next[next.length - 1] !== currentNodeId) {
    next.push(currentNodeId);
  }
  return next;
}

function selectTraceSamples(
  traces: SimulationGraphTraceSample[],
  limit: number,
): SimulationGraphTraceSample[] {
  if (limit <= 0) {
    return [];
  }

  if (traces.length <= limit) {
    return traces.slice(0, limit);
  }

  const activeFirst = [...traces].sort((left, right) =>
    left.status === right.status ? 0 : left.status === 'active' ? -1 : 1,
  );

  const buckets = new Map<'edge' | 'typical' | 'central', SimulationGraphTraceSample[]>(
    TRACE_CATEGORY_ORDER.map((category) => [category, []]),
  );

  for (const trace of activeFirst) {
    buckets.get(trace.category)?.push(trace);
  }

  const selected: SimulationGraphTraceSample[] = [];
  while (selected.length < limit) {
    let advanced = false;
    for (const category of TRACE_CATEGORY_ORDER) {
      const bucket = buckets.get(category);
      if (!bucket || bucket.length === 0) {
        continue;
      }

      selected.push(bucket.shift() as SimulationGraphTraceSample);
      advanced = true;
      if (selected.length >= limit) {
        break;
      }
    }

    if (!advanced) {
      break;
    }
  }

  return selected;
}

export function buildSimulationGraphStructure(scenario: Scenario): GraphStructure {
  const nodes = scenario.graph.map((node) => {
    const presentation = getNodePresentation(node);
    return {
      id: node.id,
      type: node.type,
      label: presentation.label,
      detail: presentation.detail,
    } satisfies SimulationGraphNode;
  });

  const edges = scenario.graph.flatMap<SimulationGraphEdge>((node) => {
    if (node.type === 'decision') {
      return node.options.map((option) => ({
        id: `decision:${node.id}:${option.id}`,
        fromNodeId: node.id,
        toNodeId: option.nextNodeId,
        kind: 'decision',
        branchId: option.id,
        label: truncateLabel(option.label),
      }));
    }

    if (node.type === 'event') {
      return node.outcomes.map((outcome) => ({
        id: `event:${node.id}:${outcome.id}`,
        fromNodeId: node.id,
        toNodeId: outcome.nextNodeId,
        kind: 'event',
        branchId: outcome.id,
        label: truncateLabel(outcome.label),
      }));
    }

    return [];
  });

  return {
    entryNodeId: scenario.entryNodeId,
    nodes,
    edges,
  };
}

export function createEmptySimulationGraphSnapshot(
  mode: SimulationGraphMode,
  cloneCount = 0,
  sampledTraceLimit = DEFAULT_GRAPH_TRACE_SAMPLE_LIMIT,
): SimulationGraphSnapshot {
  return {
    mode,
    cloneCount,
    completedClones: 0,
    activeClones: 0,
    waitingClones: 0,
    sampledTraceLimit,
    nodes: [],
    edges: [],
    sampledTraces: [],
  };
}

export function buildCompletedSimulationGraphSnapshot(
  structure: GraphStructure,
  results: CloneResult[],
  sampledTraceLimit = DEFAULT_GRAPH_TRACE_SAMPLE_LIMIT,
): SimulationGraphSnapshot {
  const edgeLookup = getEdgeLookup(structure.edges);
  const nodeStats = new Map<string, MutableNodeStats>();
  const edgeStats = new Map<string, MutableEdgeStats>();
  const tracePool: SimulationGraphTraceSample[] = [];

  for (const result of results) {
    const outcome = getTraceOutcome(result.metrics);
    for (const nodeId of result.path) {
      const stats = getOrCreateNodeStats(nodeStats, nodeId);
      stats.visitCount += 1;
      stats.completedCount += 1;
      accumulateOutcome(stats, outcome);
    }

    for (const edge of extractGraphTransitions(result.finalState, edgeLookup)) {
      const stats = getOrCreateEdgeStats(edgeStats, edge);
      stats.transitionCount += 1;
    }

    tracePool.push({
      cloneId: result.cloneId,
      category: result.stratification.category,
      status: 'completed',
      currentNodeId: result.path[result.path.length - 1],
      pathNodeIds: [...result.path],
      outcome,
    });
  }

  return {
    mode: 'completed',
    cloneCount: results.length,
    completedClones: results.length,
    activeClones: 0,
    waitingClones: 0,
    sampledTraceLimit,
    nodes: structure.nodes.map((node) => nodeStats.get(node.id) ?? createNodeStats(node.id)),
    edges: structure.edges.map((edge) => edgeStats.get(edge.id) ?? createEdgeStats(edge)),
    sampledTraces: selectTraceSamples(tracePool, sampledTraceLimit),
  };
}

export function buildLiveSimulationGraphSnapshot(options: {
  structure: GraphStructure;
  cloneCount: number;
  completedResults: CloneResult[];
  activeTraces: LiveTraceSource[];
  waitingNodeIds: string[];
  sampledTraceLimit?: number;
}): SimulationGraphSnapshot {
  const sampledTraceLimit = options.sampledTraceLimit ?? DEFAULT_GRAPH_TRACE_SAMPLE_LIMIT;
  const completedSnapshot = buildCompletedSimulationGraphSnapshot(
    options.structure,
    options.completedResults,
    sampledTraceLimit,
  );
  const edgeLookup = getEdgeLookup(options.structure.edges);
  const nodeStats = new Map<string, MutableNodeStats>(
    completedSnapshot.nodes.map((node) => [node.nodeId, { ...node }]),
  );
  const edgeStats = new Map<string, MutableEdgeStats>(
    completedSnapshot.edges.map((edge) => [edge.edgeId, { ...edge }]),
  );
  const tracePool = [...completedSnapshot.sampledTraces];

  for (const trace of options.activeTraces) {
    const livePath = withCurrentNode(trace.pathNodeIds, trace.currentNodeId);
    for (const nodeId of livePath) {
      const stats = getOrCreateNodeStats(nodeStats, nodeId);
      stats.visitCount += 1;
    }

    if (trace.currentNodeId) {
      const stats = getOrCreateNodeStats(nodeStats, trace.currentNodeId);
      stats.activeCount += 1;
    }

    for (const edge of extractGraphTransitions(trace.state, edgeLookup)) {
      const stats = getOrCreateEdgeStats(edgeStats, edge);
      stats.transitionCount += 1;
    }

    tracePool.push({
      cloneId: trace.cloneId,
      category: trace.category,
      status: 'active',
      currentNodeId: trace.currentNodeId,
      pathNodeIds: livePath,
    });
  }

  for (const nodeId of options.waitingNodeIds) {
    const stats = getOrCreateNodeStats(nodeStats, nodeId);
    stats.waitingCount += 1;
  }

  return {
    mode: 'live',
    cloneCount: options.cloneCount,
    completedClones: options.completedResults.length,
    activeClones: options.activeTraces.length,
    waitingClones: options.waitingNodeIds.length,
    sampledTraceLimit,
    nodes: options.structure.nodes.map((node) => nodeStats.get(node.id) ?? createNodeStats(node.id)),
    edges: options.structure.edges.map((edge) => edgeStats.get(edge.id) ?? createEdgeStats(edge)),
    sampledTraces: selectTraceSamples(tracePool, sampledTraceLimit),
  };
}

export function mergeSimulationGraphSnapshots(
  structure: GraphStructure,
  items: Array<SimulationGraphSnapshot | null | undefined>,
  mode: SimulationGraphMode = 'live',
  sampledTraceLimit = DEFAULT_GRAPH_TRACE_SAMPLE_LIMIT,
): SimulationGraphSnapshot {
  const nodeStats = new Map<string, MutableNodeStats>();
  const edgeStats = new Map<string, MutableEdgeStats>();
  const tracePool: SimulationGraphTraceSample[] = [];
  let cloneCount = 0;
  let completedClones = 0;
  let activeClones = 0;
  let waitingClones = 0;
  let lastUpdated: string | undefined;

  for (const item of items) {
    if (!item) {
      continue;
    }

    cloneCount += item.cloneCount;
    completedClones += item.completedClones;
    activeClones += item.activeClones;
    waitingClones += item.waitingClones;
    if (!lastUpdated || (item.lastUpdated && item.lastUpdated > lastUpdated)) {
      lastUpdated = item.lastUpdated;
    }

    for (const node of item.nodes) {
      const stats = getOrCreateNodeStats(nodeStats, node.nodeId);
      stats.visitCount += node.visitCount;
      stats.activeCount += node.activeCount;
      stats.waitingCount += node.waitingCount;
      stats.completedCount += node.completedCount;
      stats.successCount += node.successCount;
      stats.failureCount += node.failureCount;
      stats.neutralCount += node.neutralCount;
    }

    for (const edge of item.edges) {
      const shape = structure.edges.find((entry) => entry.id === edge.edgeId);
      if (!shape) {
        continue;
      }

      const stats = getOrCreateEdgeStats(edgeStats, shape);
      stats.transitionCount += edge.transitionCount;
    }

    tracePool.push(...item.sampledTraces);
  }

  return {
    mode,
    cloneCount,
    completedClones,
    activeClones,
    waitingClones,
    sampledTraceLimit,
    nodes: structure.nodes.map((node) => nodeStats.get(node.id) ?? createNodeStats(node.id)),
    edges: structure.edges.map((edge) => edgeStats.get(edge.id) ?? createEdgeStats(edge)),
    sampledTraces: selectTraceSamples(tracePool, sampledTraceLimit),
    lastUpdated,
  };
}

export function withSnapshotTimestamp(
  snapshot: SimulationGraphSnapshot,
  timestamp = new Date().toISOString(),
): SimulationGraphSnapshot {
  return {
    ...snapshot,
    lastUpdated: timestamp,
  };
}

export function createSimulationGraphEnvelope(options: {
  simulationId: string;
  name: string;
  title: string;
  primaryQuestion: string;
  status: string;
  scenarioType: string;
  structure: GraphStructure;
  snapshot: SimulationGraphSnapshot | null;
}): SimulationGraphEnvelope {
  return {
    simulationId: options.simulationId,
    name: options.name,
    title: options.title,
    primaryQuestion: options.primaryQuestion,
    status: options.status,
    scenarioType: options.scenarioType,
    entryNodeId: options.structure.entryNodeId,
    nodes: options.structure.nodes,
    edges: options.structure.edges,
    snapshot: options.snapshot,
  };
}
