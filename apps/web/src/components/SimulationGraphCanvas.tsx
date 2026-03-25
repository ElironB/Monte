import { useEffect, useRef, useState } from 'react';
import {
  formatNodeVisitRatio,
  getEdgeStatsMap,
  getNodeOutcomeTone,
  getNodeStatsMap,
  getTracePath,
  layoutSimulationGraph,
} from '../lib/graph';
import type { SimulationGraphEnvelope, SimulationGraphSnapshot } from '../lib/types';

const MIN_SCALE = 0.42;
const MAX_SCALE = 3.2;
const ZOOM_STEP = 0.12;
const DRAG_THRESHOLD = 4;

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function getWrappedNodeLabelLines(label: string, maxCharsPerLine: number): string[] {
  const words = label.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;

      if (lines.length === 2) {
        break;
      }
    } else {
      current = next.length > maxCharsPerLine ? truncateText(next, maxCharsPerLine) : next;
    }
  }

  const consumedWords = lines.join(' ').split(' ').filter(Boolean).length + (current ? current.split(' ').filter(Boolean).length : 0);
  const hasRemainingWords = consumedWords < words.length;

  if (current && lines.length < 2) {
    lines.push(current);
  }

  if (lines.length === 0) {
    return [truncateText(label, maxCharsPerLine)];
  }

  if (hasRemainingWords) {
    lines[Math.min(lines.length - 1, 1)] = truncateText(lines[Math.min(lines.length - 1, 1)], maxCharsPerLine);
    if (!lines[Math.min(lines.length - 1, 1)].endsWith('...')) {
      lines[Math.min(lines.length - 1, 1)] = truncateText(`${lines[Math.min(lines.length - 1, 1)]}...`, maxCharsPerLine);
    }
  }

  return lines.slice(0, 2);
}

function clampScale(value: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(value.toFixed(3))));
}

function getCompactEdgeLabel(label: string) {
  const normalized = label.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 24) {
    return normalized;
  }

  return `${normalized.slice(0, 21).trimEnd()}...`;
}

export function SimulationGraphCanvas({
  graph,
  snapshot,
  selectedNodeId,
  onSelectNode,
}: {
  graph: SimulationGraphEnvelope;
  snapshot: SimulationGraphSnapshot | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const layout = layoutSimulationGraph(graph);
  const nodeStatsMap = getNodeStatsMap(snapshot);
  const edgeStatsMap = getEdgeStatsMap(snapshot);
  const nodeMap = new Map(layout.nodes.map((node) => [node.id, node]));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    targetNodeId: string | null;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewport, setViewport] = useState({ x: 32, y: 32, scale: 1 });

  const fitToView = () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const padding = 42;
    const availableWidth = Math.max(320, container.clientWidth - padding * 2);
    const availableHeight = Math.max(280, container.clientHeight - padding * 2);
    const scale = Math.min(
      1,
      availableWidth / Math.max(layout.width, 1),
      availableHeight / Math.max(layout.height, 1),
    );
    setViewport({
      scale: Math.max(0.62, clampScale(scale)),
      x: Math.max((container.clientWidth - layout.width * scale) / 2, 20),
      y: Math.max((container.clientHeight - layout.height * scale) / 2, 20),
    });
  };

  useEffect(() => {
    fitToView();
  }, [graph.simulationId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const direction = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setViewport((current) => ({
        ...current,
        scale: clampScale(current.scale + direction),
      }));
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const maxEdgeCount = Math.max(
    ...[...(snapshot?.edges ?? []).map((edge) => edge.transitionCount), 1],
  );

  const visibleTraces = (snapshot?.sampledTraces ?? []).filter((trace) =>
    selectedNodeId ? trace.pathNodeIds.includes(selectedNodeId) : true,
  );
  const shouldShowGlobalEdgeLabels = !selectedNodeId && viewport.scale >= 1.45;

  return (
    <div className="graph-canvas">
      <div className="graph-canvas__toolbar">
        <div className="graph-canvas__meta">
          <span>{layout.nodes.length} nodes</span>
          <span>{layout.edges.length} edges</span>
          <span>{snapshot?.sampledTraces.length ?? 0} sampled traces</span>
        </div>
        <div className="button-row">
          <button className="ghost-button" type="button" onClick={() => setViewport((current) => ({ ...current, scale: clampScale(current.scale + ZOOM_STEP) }))}>
            Zoom in
          </button>
          <button className="ghost-button" type="button" onClick={() => setViewport((current) => ({ ...current, scale: clampScale(current.scale - ZOOM_STEP) }))}>
            Zoom out
          </button>
          <button className="ghost-button" type="button" onClick={fitToView}>
            Fit
          </button>
          <button className="ghost-button" type="button" onClick={() => setViewport({ x: 32, y: 32, scale: 1 })}>
            Reset
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`graph-stage${isDragging ? ' graph-stage--dragging' : ''}`}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }

          window.getSelection()?.removeAllRanges();
          const targetNodeId = (event.target as Element)
            .closest('[data-node-id]')
            ?.getAttribute('data-node-id');
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: viewport.x,
            originY: viewport.y,
            moved: false,
            targetNodeId: targetNodeId ?? null,
          };
        }}
        onPointerMove={(event) => {
          if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
            return;
          }

          const deltaX = event.clientX - dragRef.current.startX;
          const deltaY = event.clientY - dragRef.current.startY;

          if (!dragRef.current.moved && (Math.abs(deltaX) >= DRAG_THRESHOLD || Math.abs(deltaY) >= DRAG_THRESHOLD)) {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current.moved = true;
            setIsDragging(true);
          }

          if (!dragRef.current.moved) {
            return;
          }

          event.preventDefault();
          setViewport((current) => ({
            ...current,
            x: (dragRef.current?.originX ?? current.x) + deltaX,
            y: (dragRef.current?.originY ?? current.y) + deltaY,
          }));
        }}
        onPointerUp={(event) => {
          if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
            return;
          }

          if (dragRef.current.moved && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (!dragRef.current.moved && dragRef.current.targetNodeId) {
            onSelectNode(dragRef.current.targetNodeId);
          }
          dragRef.current = null;
          setIsDragging(false);
        }}
        onPointerCancel={(event) => {
          if (dragRef.current?.moved && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          dragRef.current = null;
          setIsDragging(false);
        }}
      >
        <svg className="graph-stage__svg" viewBox={`0 0 ${layout.width} ${layout.height}`}>
          <defs>
            <pattern id="graph-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(27, 24, 20, 0.05)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={layout.width} height={layout.height} fill="url(#graph-grid)" />
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            {visibleTraces.map((trace) => {
              const path = getTracePath(trace, nodeMap);
              if (!path) {
                return null;
              }

              return (
                <path
                  key={`${trace.cloneId}-${trace.status}`}
                  className={`graph-trace graph-trace--${trace.status}`}
                  d={path}
                />
              );
            })}

            {layout.edges.map((edge) => {
              const edgeStats = edgeStatsMap.get(edge.id);
              const selected = selectedNodeId ? edge.fromNodeId === selectedNodeId || edge.toNodeId === selectedNodeId : false;
              const strokeWidth = 1.4 + ((edgeStats?.transitionCount ?? 0) / maxEdgeCount) * 4.2;
              const fromNode = nodeMap.get(edge.fromNodeId);
              const toNode = nodeMap.get(edge.toNodeId);
              const labelX = ((fromNode?.centerX ?? 0) + (toNode?.centerX ?? 0)) / 2;
              const labelY = ((fromNode?.centerY ?? 0) + (toNode?.centerY ?? 0)) / 2 - 10;
              const showLabel = selected ? true : shouldShowGlobalEdgeLabels;

              return (
                <g key={edge.id}>
                  <path
                    className={`graph-edge${selected ? ' graph-edge--selected' : ''}`}
                    d={edge.path}
                    style={{ strokeWidth }}
                  />
                  {showLabel ? (
                    <text
                      className="graph-edge__label"
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                    >
                      {getCompactEdgeLabel(edge.label)}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {layout.nodes.map((node) => {
              const stats = nodeStatsMap.get(node.id);
              const selected = selectedNodeId === node.id;
              const visitRatio = formatNodeVisitRatio(stats, Math.max(snapshot?.cloneCount ?? 0, 1));
              const outcomeTone = getNodeOutcomeTone(stats);
              const maxCharsPerLine = Math.max(14, Math.floor((node.width - 42) / 8.4));
              const labelLines = getWrappedNodeLabelLines(node.label, maxCharsPerLine);

              return (
                <g
                  key={node.id}
                  data-node-id={node.id}
                  className={`graph-node graph-node--${node.type} graph-node--${outcomeTone}${selected ? ' graph-node--selected' : ''}${(stats?.activeCount ?? 0) > 0 ? ' graph-node--active' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                >
                  <rect className="graph-node__body" width={node.width} height={node.height} rx={node.type === 'decision' ? 14 : 12} />
                  <rect
                    className="graph-node__fill"
                    width={Math.max(6, node.width * visitRatio)}
                    height={4}
                    x={0}
                    y={node.height - 4}
                    rx={999}
                  />
                  <text className="graph-node__title" x={18} y={30}>
                    {labelLines.map((line, index) => (
                      <tspan key={`${node.id}-${index}`} x={18} dy={index === 0 ? 0 : 18}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <text className="graph-node__meta" x={18} y={node.height - 16}>
                    {(stats?.visitCount ?? 0).toLocaleString()} visits
                  </text>
                  <text className="graph-node__badge" x={node.width - 16} y={18} textAnchor="end">
                    {(stats?.activeCount ?? 0) > 0 ? `${stats?.activeCount} active` : node.type}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
