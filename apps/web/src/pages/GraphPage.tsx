import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDate, integerFormatter, titleCase } from '../lib/formatters';
import { useSimulationGraphLive } from '../hooks/useSimulationGraphLive';
import { EmptyState, ErrorPanel, LoadingPanel, MetricCard, Panel, StatusPill } from '../components/Ui';
import { SimulationGraphCanvas } from '../components/SimulationGraphCanvas';
import { SimulationGraphInspector } from '../components/SimulationGraphInspector';

export function GraphPage() {
  const simulationsQuery = useQuery({
    queryKey: ['simulations', 'graph'],
    queryFn: () => api.getSimulations({ limit: 30 }),
    refetchInterval: 10_000,
  });

  const searchParams = new URLSearchParams(window.location.search);
  const requestedSimulationId = searchParams.get('simulationId');
  const fallbackSimulation = requestedSimulationId
    ? simulationsQuery.data?.data.find((simulation) => simulation.id === requestedSimulationId)
    : simulationsQuery.data?.data.find((simulation) => simulation.status === 'running' || simulation.status === 'pending')
      ?? simulationsQuery.data?.data.find((simulation) => simulation.status === 'completed')
      ?? simulationsQuery.data?.data[0];
  const selectedSimulationId = requestedSimulationId ?? fallbackSimulation?.id ?? null;

  const graphQuery = useQuery({
    queryKey: ['simulation-graph', selectedSimulationId],
    queryFn: () => api.getSimulationGraph(selectedSimulationId!),
    enabled: Boolean(selectedSimulationId),
  });

  const liveEnabled = Boolean(
    graphQuery.data && graphQuery.data.status !== 'completed' && graphQuery.data.status !== 'failed',
  );
  const liveGraph = useSimulationGraphLive(
    selectedSimulationId,
    liveEnabled,
    graphQuery.data?.snapshot ?? null,
  );
  const snapshot = liveGraph.snapshot ?? graphQuery.data?.snapshot ?? null;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedNodeId(graphQuery.data?.entryNodeId ?? null);
  }, [graphQuery.data?.entryNodeId, selectedSimulationId]);

  if (simulationsQuery.isLoading || graphQuery.isLoading) {
    return <LoadingPanel label="Loading simulation graph and clone flow..." />;
  }

  if (simulationsQuery.error || graphQuery.error || liveGraph.error) {
    return (
      <ErrorPanel
        message={
          (simulationsQuery.error as Error | undefined)?.message
          ?? (graphQuery.error as Error | undefined)?.message
          ?? liveGraph.error?.message
          ?? 'Unknown error'
        }
      />
    );
  }

  if (!selectedSimulationId || !graphQuery.data) {
    return (
      <EmptyState
        title="No simulation selected"
        body="Create or complete a simulation first, then Monte will render the scenario graph here."
      />
    );
  }

  return (
    <div className="page-grid">
      <Panel className="hero-panel" eyebrow="Clone graph" title={fallbackSimulation?.name ?? 'Simulation graph'}>
        <div className="hero-panel__content">
          <div className="hero-panel__copy">
            <p className="hero-panel__lede">
              This canvas keeps the scenario graph stable while clone traffic, waiting decisions, and sampled traces move through it in real time.
            </p>
            <div className="hero-panel__chips">
              <StatusPill value={graphQuery.data.status} />
              <StatusPill value={titleCase(graphQuery.data.scenarioType)} />
              <StatusPill value={snapshot?.mode ?? 'static'} />
              <StatusPill value={liveGraph.transport} />
            </div>
          </div>
          <div className="hero-panel__brief">
            <div className="hero-panel__brief-item">
              <span>Clone pool</span>
              <strong>{integerFormatter.format(snapshot?.cloneCount ?? fallbackSimulation?.cloneCount ?? 0)}</strong>
            </div>
            <div className="hero-panel__brief-item">
              <span>Completed</span>
              <strong>{integerFormatter.format(snapshot?.completedClones ?? 0)}</strong>
            </div>
            <div className="hero-panel__brief-item">
              <span>Updated</span>
              <strong>{snapshot?.lastUpdated ? formatDate(snapshot.lastUpdated) : 'Graph route'}</strong>
            </div>
          </div>
        </div>
      </Panel>

      <div className="metrics-grid">
        <MetricCard label="Active clones" value={integerFormatter.format(snapshot?.activeClones ?? 0)} tone="accent" detail="Current node occupancy" />
        <MetricCard label="Waiting clones" value={integerFormatter.format(snapshot?.waitingClones ?? 0)} tone="warm" detail="In decision queues" />
        <MetricCard label="Visible traces" value={integerFormatter.format(snapshot?.sampledTraces.length ?? 0)} tone="success" detail="Sampled path overlays" />
        <MetricCard label="Graph size" value={`${graphQuery.data.nodes.length} / ${graphQuery.data.edges.length}`} detail="Nodes / edges" />
      </div>

      <div className="graph-layout">
        <Panel title="Scenario graph" eyebrow="Live canvas">
          {snapshot ? (
            <SimulationGraphCanvas
              graph={graphQuery.data}
              snapshot={snapshot}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          ) : (
            <EmptyState
              title="Graph snapshot not available yet"
              body="Monte can still render the scenario structure, but this run has not produced a live or completed graph snapshot yet."
            />
          )}
        </Panel>

        <SimulationGraphInspector
          graph={graphQuery.data}
          snapshot={snapshot}
          selectedNodeId={selectedNodeId}
        />
      </div>

      <Panel title="Cross-links" eyebrow="Jump surfaces">
        <div className="button-row">
          <Link className="ghost-button" to={`/live?simulationId=${selectedSimulationId}`}>
            Open live run
          </Link>
          <Link className="ghost-button ghost-button--filled" to={`/results?simulationId=${selectedSimulationId}`}>
            Open results
          </Link>
        </div>
      </Panel>
    </div>
  );
}
