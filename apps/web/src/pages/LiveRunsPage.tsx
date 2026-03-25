import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, getApiBaseUrl } from '../lib/api';
import { formatDate, formatDurationMs, integerFormatter, titleCase } from '../lib/formatters';
import type { SimulationProgress } from '../lib/types';
import { EmptyState, ErrorPanel, KeyValueGrid, LoadingPanel, MetricCard, Panel, StatusPill } from '../components/Ui';

export function LiveRunsPage() {
  const simulationsQuery = useQuery({
    queryKey: ['simulations', 'live'],
    queryFn: () => api.getSimulations({ limit: 20 }),
    refetchInterval: 10_000,
  });

  const searchParams = new URLSearchParams(window.location.search);
  const requestedSimulationId = searchParams.get('simulationId');
  const fallbackSimulation = simulationsQuery.data?.data.find((simulation) => simulation.status === 'pending' || simulation.status === 'running') ?? simulationsQuery.data?.data[0];
  const selectedSimulationId = requestedSimulationId ?? fallbackSimulation?.id ?? null;

  const progressQuery = useQuery({
    queryKey: ['simulation-progress', selectedSimulationId],
    queryFn: () => api.getSimulationProgress(selectedSimulationId!),
    enabled: Boolean(selectedSimulationId),
    refetchInterval: 5000,
  });

  const [liveProgress, setLiveProgress] = useState<{
    simulationId: string;
    payload: SimulationProgress;
  } | null>(null);

  useEffect(() => {
    if (!selectedSimulationId) {
      return;
    }

    const source = new EventSource(`${getApiBaseUrl()}/stream/simulation/${selectedSimulationId}/progress`);

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;

        if (payload.type === 'progress' && payload.data && typeof payload.data === 'object') {
          setLiveProgress({
            simulationId: selectedSimulationId,
            payload: payload.data as SimulationProgress,
          });
          return;
        }

        if (payload.type === 'ping' || payload.type === 'connected') {
          return;
        }

        setLiveProgress({
          simulationId: selectedSimulationId,
          payload: payload as unknown as SimulationProgress,
        });
      } catch {
        // Ignore malformed payloads and keep REST polling alive.
      }
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [selectedSimulationId]);

  if (simulationsQuery.isLoading || progressQuery.isLoading) {
    return <LoadingPanel label="Connecting to live simulation progress..." />;
  }

  if (simulationsQuery.error || progressQuery.error) {
    return <ErrorPanel message={(simulationsQuery.error as Error | undefined)?.message ?? (progressQuery.error as Error | undefined)?.message ?? 'Unknown error'} />;
  }

  if (!selectedSimulationId || !progressQuery.data) {
    return <EmptyState title="No simulation selected" body="Queue or select a simulation to watch phase-aware progress here." />;
  }

  const progress = liveProgress?.simulationId === selectedSimulationId ? liveProgress.payload : progressQuery.data;

  return (
    <div className="page-grid">
      <Panel className="hero-panel" eyebrow="Live execution" title={`${titleCase(progress.phase)} phase`}>
        <div className="hero-panel__content">
          <div>
            <p className="hero-panel__lede">
              Monte reports phase-aware progress rather than sitting at 99%. This view listens to the SSE stream and falls back to REST polling.
            </p>
            <div className="hero-panel__chips">
              <StatusPill value={progress.status} />
              <StatusPill value={`${Math.round(progress.progress)}% overall`} />
              {progress.aggregationStage ? <StatusPill value={progress.aggregationStage} /> : null}
            </div>
            <div className="button-row">
              <Link className="ghost-button" to={`/graph?simulationId=${selectedSimulationId}`}>
                Open graph
              </Link>
            </div>
          </div>
        </div>
      </Panel>

      <div className="metrics-grid">
        <MetricCard label="Phase progress" value={`${Math.round(progress.phaseProgress ?? progress.progress)}%`} tone="accent" detail={titleCase(progress.phase)} />
        <MetricCard label="Processed clones" value={integerFormatter.format(progress.processedClones ?? 0)} detail={`${integerFormatter.format(progress.cloneCount)} total`} />
        <MetricCard label="Decision frontier" value={integerFormatter.format(progress.activeFrontier ?? 0)} tone="warm" detail={`${integerFormatter.format(progress.waitingDecisions ?? 0)} waiting`} />
        <MetricCard label="ETA" value={formatDurationMs(progress.estimatedTimeRemaining)} tone="success" detail={progress.lastUpdated ? `Updated ${formatDate(progress.lastUpdated)}` : 'Live stream'} />
      </div>

      <div className="two-column-grid">
        <Panel title="Execution detail" eyebrow="Snapshot">
          <KeyValueGrid
            items={[
              { label: 'Current batch', value: progress.currentBatch ?? 'n/a' },
              { label: 'Completed batches', value: `${progress.completedBatches}/${progress.totalBatches}` },
              { label: 'Batch clones', value: progress.batchCloneCount ?? 'n/a' },
              { label: 'Batch progress', value: progress.batchProcessedClones ?? 'n/a' },
              { label: 'Resolved decisions', value: progress.resolvedDecisions ?? 'n/a' },
              { label: 'Estimated decisions', value: progress.estimatedDecisionCount ?? 'n/a' },
            ]}
          />
        </Panel>

        <Panel title="Operational notes" eyebrow="Why this matters">
          <div className="prose-stack">
            <p>The backend exposes `queued`, `executing`, `persisting`, `aggregating`, `completed`, and `failed` phases instead of flattening the run into one spinner.</p>
            <p>Decision batching and frontier stats are surfaced here directly from the existing runtime progress payload.</p>
            {progress.error ? <p className="form-message form-message--error">{progress.error}</p> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
