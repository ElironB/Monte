import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { compactFormatter, formatDate, formatPercentFromRatio, formatTooltipNumber, integerFormatter, titleCase } from '../lib/formatters';
import type { AggregatedResults } from '../lib/types';
import { EmptyState, ErrorPanel, LoadingPanel, MetricCard, Panel, StatusPill } from '../components/Ui';

const CHART_GRID = 'rgba(27, 24, 20, 0.08)';
const CHART_AXIS = '#7a7268';
const CHART_FILL = '#7a5d2d';

export function OverviewPage() {
  const userQuery = useQuery({ queryKey: ['user'], queryFn: api.getUser });
  const personaQuery = useQuery({ queryKey: ['persona'], queryFn: api.getPersona });
  const simulationsQuery = useQuery({
    queryKey: ['simulations', 'overview'],
    queryFn: () => api.getSimulations({ limit: 8 }),
    refetchInterval: 10_000,
  });
  const sourcesQuery = useQuery({
    queryKey: ['sources', 'overview'],
    queryFn: () => api.getSources({ limit: 8 }),
  });
  const scenariosQuery = useQuery({ queryKey: ['scenarios'], queryFn: api.getScenarios });

  const completedSimulation = simulationsQuery.data?.data.find((simulation) => simulation.status === 'completed');
  const latestResultsQuery = useQuery({
    queryKey: ['simulation-results', completedSimulation?.id, 'overview'],
    queryFn: () => api.getSimulationResults(completedSimulation!.id, true),
    enabled: Boolean(completedSimulation?.id),
  });

  if (userQuery.isLoading || personaQuery.isLoading || simulationsQuery.isLoading || sourcesQuery.isLoading || scenariosQuery.isLoading) {
    return <LoadingPanel label="Loading the Monte control surface..." />;
  }

  if (userQuery.error || personaQuery.error || simulationsQuery.error || sourcesQuery.error || scenariosQuery.error) {
    return (
      <ErrorPanel
        message={
          (userQuery.error as Error | undefined)?.message ??
          (personaQuery.error as Error | undefined)?.message ??
          (simulationsQuery.error as Error | undefined)?.message ??
          (sourcesQuery.error as Error | undefined)?.message ??
          (scenariosQuery.error as Error | undefined)?.message ??
          'Unknown error'
        }
      />
    );
  }

  const latestResults = latestResultsQuery.data?.distributions ?? null;
  const latestRunningSimulation = simulationsQuery.data?.data.find((simulation) => simulation.status === 'pending' || simulation.status === 'running');
  const totalSignals = (sourcesQuery.data?.data ?? []).reduce((sum, source) => sum + source.signalCount, 0);
  const scenarioCoverage = scenariosQuery.data?.length ?? 0;

  return (
    <div className="page-grid">
      <Panel className="hero-panel" eyebrow="Demo surface" title="Show Monte as a working decision desk instead of asking people to watch terminal output.">
        <div className="hero-panel__content">
          <div className="hero-panel__copy">
            <p className="hero-panel__lede">
              Live persona status, scenario coverage, runtime telemetry, evidence loops, and narrative output all pulled from the existing Fastify API.
            </p>
            <div className="hero-panel__chips">
              <StatusPill value={userQuery.data?.personaStatus ?? 'unknown'} />
              <StatusPill value={`${scenarioCoverage} scenarios`} />
              <StatusPill value={`${compactFormatter.format(totalSignals)} signals`} />
            </div>
            <div className="hero-panel__actions">
              <Link className="ghost-button ghost-button--filled" to="/simulations">
                Launch a scenario
              </Link>
              <Link className="ghost-button" to="/results">
                Inspect telemetry
              </Link>
            </div>
          </div>
          <div className="hero-panel__brief">
            <div className="hero-panel__brief-item">
              <span>Active run</span>
              <strong>{latestRunningSimulation?.name ?? 'No simulation in flight'}</strong>
            </div>
            <div className="hero-panel__brief-item">
              <span>Source inventory</span>
              <strong>{sourcesQuery.data?.pagination.total ?? 0} registered inputs</strong>
            </div>
            <div className="hero-panel__brief-item">
              <span>Operator</span>
              <strong>{userQuery.data?.email ?? 'local-user@monte.local'}</strong>
            </div>
          </div>
        </div>
      </Panel>

      <div className="metrics-grid">
        <MetricCard label="Persona status" value={titleCase(userQuery.data?.personaStatus ?? 'none')} tone="accent" detail={userQuery.data?.email} />
        <MetricCard
          label="Latest success rate"
          value={latestResults ? formatPercentFromRatio(latestResults.outcomeDistribution.success) : 'n/a'}
          tone="success"
          detail={completedSimulation ? completedSimulation.name : 'Run a simulation to populate'}
        />
        <MetricCard
          label="Signals observed"
          value={integerFormatter.format(totalSignals)}
          tone="warm"
          detail={`${sourcesQuery.data?.pagination.total ?? 0} sources registered`}
        />
        <MetricCard
          label="Recent simulations"
          value={integerFormatter.format(simulationsQuery.data?.pagination.total ?? 0)}
          detail={latestRunningSimulation ? `Active: ${latestRunningSimulation.name}` : 'No active runs'}
        />
      </div>

      <div className="two-column-grid">
        <Panel title="Recent simulations" eyebrow="Timeline">
          {simulationsQuery.data?.data.length ? (
            <div className="data-list">
              {simulationsQuery.data.data.map((simulation) => (
                <article key={simulation.id} className="data-list__item">
                  <div>
                    <strong>{simulation.name}</strong>
                    <p>{titleCase(simulation.scenarioType)}</p>
                  </div>
                  <div className="data-list__meta">
                    <StatusPill value={simulation.status} />
                    <span>{formatDate(simulation.createdAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No simulations yet" body="Open the simulations tab to kick off the first scenario run." />
          )}
        </Panel>

        <Panel title="Scenario catalog" eyebrow="Coverage">
          <div className="scenario-grid">
            {scenariosQuery.data?.map((scenario) => (
              <article key={scenario.id} className="scenario-card">
                <strong>{scenario.name}</strong>
                <span>{scenario.timeframe}</span>
                <p>{scenario.description}</p>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <div className="two-column-grid">
        <Panel title="Latest distribution" eyebrow="Results snapshot">
          {latestResults ? <OutcomeDistributionPreview results={latestResults} /> : <EmptyState title="No completed runs yet" body="Once a simulation completes, the overview will surface outcome distribution here." />}
        </Panel>

        <Panel title="Source intake" eyebrow="Observation layer">
          {sourcesQuery.data?.data.length ? (
            <div className="source-list">
              {sourcesQuery.data.data.map((source) => (
                <article key={source.id} className="source-list__item">
                  <div>
                    <strong>{source.name}</strong>
                    <p>{titleCase(source.sourceType)}</p>
                  </div>
                  <div className="source-list__meta">
                    <StatusPill value={source.status} />
                    <span>{integerFormatter.format(source.signalCount)} signals</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No sources yet" body="The sources panel will light up as soon as ingestion data lands." />
          )}
        </Panel>
      </div>
    </div>
  );
}

function OutcomeDistributionPreview({ results }: { results: AggregatedResults }) {
  const chartData = [
    { label: 'Success', value: results.outcomeDistribution.success },
    { label: 'Neutral', value: results.outcomeDistribution.neutral },
    { label: 'Failure', value: results.outcomeDistribution.failure },
  ];

  return (
    <div className="chart-panel">
      <div className="chart-panel__summary">
        <div>
          <span className="chart-panel__label">Median capital</span>
          <strong>{compactFormatter.format(results.statistics.medianCapital)}</strong>
        </div>
        <div>
          <span className="chart-panel__label">Mean happiness</span>
          <strong>{formatPercentFromRatio(results.statistics.meanHappiness)}</strong>
        </div>
      </div>
      <div className="chart-wrap chart-wrap--medium">
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
            <XAxis dataKey="label" stroke={CHART_AXIS} />
            <YAxis tickFormatter={(value) => `${Math.round(value * 100)}%`} stroke={CHART_AXIS} />
            <Tooltip formatter={(value) => formatTooltipNumber(value, formatPercentFromRatio)} />
            <Bar dataKey="value" fill={CHART_FILL} radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
