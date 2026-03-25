import { EmptyState, KeyValueGrid, Panel, StatusPill } from './Ui';
import type {
  SimulationGraphEnvelope,
  SimulationGraphSnapshot,
  SimulationGraphTraceSample,
} from '../lib/types';

function formatShortId(value: string) {
  return value.slice(0, 8);
}

function getRelevantTraces(
  traces: SimulationGraphTraceSample[],
  selectedNodeId: string,
) {
  return traces.filter((trace) => trace.pathNodeIds.includes(selectedNodeId)).slice(0, 6);
}

export function SimulationGraphInspector({
  graph,
  snapshot,
  selectedNodeId,
}: {
  graph: SimulationGraphEnvelope;
  snapshot: SimulationGraphSnapshot | null;
  selectedNodeId: string | null;
}) {
  if (!selectedNodeId) {
    return (
      <Panel title="Node inspector" eyebrow="Click a node">
        <EmptyState
          title="Nothing selected yet"
          body="Pick any node in the graph to inspect clone traffic, outcome mix, outgoing branches, and sampled traces."
        />
      </Panel>
    );
  }

  const node = graph.nodes.find((entry) => entry.id === selectedNodeId);
  if (!node) {
    return (
      <Panel title="Node inspector" eyebrow="Unavailable">
        <EmptyState
          title="Node not found"
          body="The selected node is no longer present in the current graph payload."
        />
      </Panel>
    );
  }

  const stats = snapshot?.nodes.find((entry) => entry.nodeId === selectedNodeId);
  const outgoingEdges = graph.edges.filter((edge) => edge.fromNodeId === selectedNodeId);
  const totalOutgoing = outgoingEdges.reduce((total, edge) => {
    const edgeStats = snapshot?.edges.find((entry) => entry.edgeId === edge.id);
    return total + (edgeStats?.transitionCount ?? 0);
  }, 0);
  const traces = getRelevantTraces(snapshot?.sampledTraces ?? [], selectedNodeId);

  return (
    <Panel title={node.label} eyebrow={`${node.type} node`}>
      <div className="graph-inspector__intro">
        <p>{node.detail}</p>
        <div className="hero-panel__chips">
          <StatusPill value={graph.status} />
          <StatusPill value={node.type} />
          <StatusPill value={snapshot?.mode ?? 'static'} />
        </div>
      </div>

      <KeyValueGrid
        items={[
          { label: 'Visits', value: stats?.visitCount ?? 0 },
          { label: 'Active clones', value: stats?.activeCount ?? 0 },
          { label: 'Waiting clones', value: stats?.waitingCount ?? 0 },
          { label: 'Completed clones', value: stats?.completedCount ?? 0 },
          { label: 'Success touches', value: stats?.successCount ?? 0 },
          { label: 'Failure touches', value: stats?.failureCount ?? 0 },
        ]}
      />

      <section className="graph-inspector__section">
        <div className="graph-inspector__section-head">
          <p className="panel__eyebrow">Outgoing branches</p>
          <span>{totalOutgoing} transitions</span>
        </div>
        {outgoingEdges.length ? (
          <div className="graph-inspector__branches">
            {outgoingEdges.map((edge) => {
              const edgeStats = snapshot?.edges.find((entry) => entry.edgeId === edge.id);
              const transitionCount = edgeStats?.transitionCount ?? 0;
              const ratio = totalOutgoing > 0 ? transitionCount / totalOutgoing : 0;

              return (
                <article key={edge.id} className="graph-branch">
                  <div className="graph-branch__row">
                    <strong>{edge.label}</strong>
                    <span>{transitionCount}</span>
                  </div>
                  <div className="graph-branch__track">
                    <div className="graph-branch__fill" style={{ width: `${Math.max(8, ratio * 100)}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="graph-inspector__empty">This node does not emit downstream branches.</p>
        )}
      </section>

      <section className="graph-inspector__section">
        <div className="graph-inspector__section-head">
          <p className="panel__eyebrow">Sampled clones</p>
          <span>{traces.length} shown</span>
        </div>
        {traces.length ? (
          <div className="data-list">
            {traces.map((trace) => (
              <article key={`${trace.cloneId}-${trace.status}`} className="data-list__item">
                <div>
                  <strong>{formatShortId(trace.cloneId)}</strong>
                  <p>{trace.pathNodeIds.length} visited nodes</p>
                </div>
                <div className="data-list__meta">
                  <StatusPill value={trace.category} />
                  <StatusPill value={trace.status} />
                  {trace.outcome ? <StatusPill value={trace.outcome} /> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="graph-inspector__empty">No sampled traces crossed this node in the current snapshot.</p>
        )}
      </section>
    </Panel>
  );
}
