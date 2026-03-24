import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import {
  compactFormatter,
  currencyFormatter,
  formatDurationMs,
  formatPercentFromRatio,
  formatTooltipNumber,
  titleCase,
} from '../lib/formatters';
import { EmptyState, ErrorPanel, LoadingPanel, MetricCard, Panel, StatusPill } from '../components/Ui';

const CHART_GRID = 'rgba(27, 24, 20, 0.08)';
const CHART_AXIS = '#7a7268';
const CHART_FILL = '#7a5d2d';
const CHART_FILL_SOFT = '#b69b71';

export function ResultsPage() {
  const simulationsQuery = useQuery({
    queryKey: ['simulations', 'results'],
    queryFn: () => api.getSimulations({ limit: 30 }),
    refetchInterval: 10_000,
  });

  const searchParams = new URLSearchParams(window.location.search);
  const requestedSimulationId = searchParams.get('simulationId');
  const completedSimulation = requestedSimulationId
    ? simulationsQuery.data?.data.find((simulation) => simulation.id === requestedSimulationId)
    : simulationsQuery.data?.data.find((simulation) => simulation.status === 'completed');

  const resultsQuery = useQuery({
    queryKey: ['simulation-results', completedSimulation?.id],
    queryFn: () => api.getSimulationResults(completedSimulation!.id, true),
    enabled: Boolean(completedSimulation?.id),
  });

  if (simulationsQuery.isLoading || resultsQuery.isLoading) {
    return <LoadingPanel label="Loading simulation results and telemetry..." />;
  }

  if (simulationsQuery.error || resultsQuery.error) {
    return <ErrorPanel message={(simulationsQuery.error as Error | undefined)?.message ?? (resultsQuery.error as Error | undefined)?.message ?? 'Unknown error'} />;
  }

  if (!completedSimulation || !resultsQuery.data?.distributions) {
    return <EmptyState title="No completed results yet" body="Finish a simulation and the dashboard will unpack distributions, narrative, and runtime telemetry here." />;
  }

  const results = resultsQuery.data.distributions;
  const telemetry = results.runtimeTelemetry;
  const outcomeData = [
    { label: 'Success', value: results.outcomeDistribution.success },
    { label: 'Neutral', value: results.outcomeDistribution.neutral },
    { label: 'Failure', value: results.outcomeDistribution.failure },
  ];
  const stratifiedData = Object.entries(results.stratifiedBreakdown).map(([label, value]) => ({
    label: titleCase(label),
    avgOutcome: value.avgOutcome,
    count: value.count,
  }));
  const timelineMetric = Object.keys(results.timeline.metrics)[0];
  const timelineData = timelineMetric
    ? results.timeline.months.map((month, index) => ({
        month,
        value: results.timeline.metrics[timelineMetric]?.[index] ?? 0,
      }))
    : [];

  return (
    <div className="page-grid">
      <Panel className="hero-panel" eyebrow="Completed run" title={completedSimulation.name}>
        <div className="hero-panel__content">
          <div className="hero-panel__copy">
            <p className="hero-panel__lede">{results.decisionIntelligence?.summary ?? 'Aggregated clone results are ready for review.'}</p>
            <div className="hero-panel__chips">
              <StatusPill value={completedSimulation.status} />
              <StatusPill value={titleCase(completedSimulation.scenarioType)} />
              <StatusPill value={`${results.cloneCount} clones`} />
            </div>
          </div>
          <div className="hero-panel__brief">
            <div className="hero-panel__brief-item">
              <span>Success rate</span>
              <strong>{formatPercentFromRatio(results.statistics.successRate)}</strong>
            </div>
            <div className="hero-panel__brief-item">
              <span>Wall clock</span>
              <strong>{formatDurationMs(telemetry?.wallClockDurationMs)}</strong>
            </div>
            <div className="hero-panel__brief-item">
              <span>Peak frontier</span>
              <strong>{telemetry?.peakActiveFrontier ?? 'n/a'}</strong>
            </div>
          </div>
        </div>
      </Panel>

      <div className="metrics-grid">
        <MetricCard label="Success rate" value={formatPercentFromRatio(results.statistics.successRate)} tone="success" />
        <MetricCard label="Median capital" value={currencyFormatter.format(results.statistics.medianCapital)} tone="accent" />
        <MetricCard label="Mean health" value={formatPercentFromRatio(results.statistics.meanHealth)} tone="warm" />
        <MetricCard label="Wall clock" value={formatDurationMs(telemetry?.wallClockDurationMs)} detail={telemetry ? `${telemetry.batchCount} batches` : 'No runtime telemetry'} />
      </div>

      <div className="two-column-grid">
        <Panel title="Outcome distribution" eyebrow="Aggregate verdict">
          <div className="chart-wrap chart-wrap--medium">
            <ResponsiveContainer>
              <BarChart data={outcomeData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="label" stroke={CHART_AXIS} />
                <YAxis tickFormatter={(value) => `${Math.round(value * 100)}%`} stroke={CHART_AXIS} />
                <Tooltip formatter={(value) => formatTooltipNumber(value, formatPercentFromRatio)} />
                <Bar dataKey="value" fill={CHART_FILL} radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Stratified breakdown" eyebrow="Population shape">
          <div className="chart-wrap chart-wrap--medium">
            <ResponsiveContainer>
              <BarChart data={stratifiedData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                <XAxis dataKey="label" stroke={CHART_AXIS} />
                <YAxis stroke={CHART_AXIS} />
                <Tooltip formatter={(value) => formatTooltipNumber(value, compactFormatter.format)} />
                <Bar dataKey="avgOutcome" fill={CHART_FILL_SOFT} radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="two-column-grid">
        <Panel title="Timeline" eyebrow={timelineMetric ? `Metric: ${titleCase(timelineMetric)}` : 'No timeline metric'}>
          {timelineData.length ? (
            <div className="chart-wrap chart-wrap--medium">
              <ResponsiveContainer>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                  <XAxis dataKey="month" stroke={CHART_AXIS} />
                  <YAxis stroke={CHART_AXIS} />
                  <Tooltip formatter={(value) => formatTooltipNumber(value, compactFormatter.format)} />
                  <Line type="monotone" dataKey="value" stroke={CHART_FILL} strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No timeline data available" body="The selected result payload does not expose a timeline metric yet." />
          )}
        </Panel>

        <Panel title="Narrative" eyebrow="Readable explanation">
          {results.narrative ? (
            <div className="prose-stack">
              <p>{results.narrative.executiveSummary}</p>
              <p>{results.narrative.outcomeAnalysis}</p>
              <p>{results.narrative.behavioralDrivers}</p>
              <p>{results.narrative.recommendation}</p>
            </div>
          ) : (
            <EmptyState title="Narrative not generated" body="The API can return raw distributions even when the narrative generator is skipped." />
          )}
        </Panel>
      </div>

      <div className="two-column-grid">
        <Panel title="Decision intelligence" eyebrow="Uncertainty and experiments">
          {results.decisionIntelligence ? (
            <div className="stack">
              <div className="pill-list">
                {results.decisionIntelligence.dominantUncertainties.map((uncertainty) => (
                  <span key={uncertainty} className="inline-pill">
                    {uncertainty}
                  </span>
                ))}
              </div>
              {results.decisionIntelligence.recommendedExperiments.map((experiment, index) => (
                <article key={`${experiment.focusMetric}-${index}`} className="flag-card">
                  <div className="flag-card__header">
                    <strong>{experiment.recommendedExperiment}</strong>
                    <StatusPill value={experiment.priority} />
                  </div>
                  <p>{experiment.whyItMatters}</p>
                  <span>Success: {experiment.successSignal}</span>
                  <span>Stop: {experiment.stopSignal}</span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No decision intelligence" body="This run has no experiment recommendations yet." />
          )}
        </Panel>

        <Panel title="Runtime telemetry" eyebrow="Throughput and batching">
          {telemetry ? (
            <div className="stack">
              <div className="metrics-grid metrics-grid--compact">
                <MetricCard label="Decision concurrency" value={telemetry.decisionConcurrency} />
                <MetricCard label="Peak frontier" value={telemetry.peakActiveFrontier} />
                <MetricCard label="Peak waiting decisions" value={telemetry.peakWaitingDecisions} />
                <MetricCard label="Batch size" value={telemetry.decisionBatchSize} />
              </div>
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Decisions</th>
                      <th>Batch calls</th>
                      <th>Max batch</th>
                      <th>Total duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {telemetry.llm.nodeStats.slice(0, 6).map((node) => (
                      <tr key={node.nodeId}>
                        <td>{node.nodeId}</td>
                        <td>{node.cloneDecisions}</td>
                        <td>{node.batchCalls}</td>
                        <td>{node.maxBatchSize}</td>
                        <td>{formatDurationMs(node.totalDurationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState title="No runtime telemetry" body="Completed simulations should expose runtime telemetry once the engine persists it." />
          )}
        </Panel>
      </div>

      {results.rerunComparison ? (
        <Panel title="Rerun comparison" eyebrow="Evidence-adjusted delta">
          <div className="metrics-grid metrics-grid--compact">
            <MetricCard label="Thesis confidence delta" value={results.rerunComparison.beliefDelta.thesisConfidence.toFixed(2)} />
            <MetricCard label="Uncertainty delta" value={results.rerunComparison.beliefDelta.uncertaintyLevel.toFixed(2)} />
            <MetricCard label="Downside delta" value={results.rerunComparison.beliefDelta.downsideSalience.toFixed(2)} />
          </div>
          <p className="prose-block">{results.rerunComparison.summary}</p>
        </Panel>
      ) : null}
    </div>
  );
}
