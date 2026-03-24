import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, integerFormatter, titleCase } from '../lib/formatters';
import { EmptyState, ErrorPanel, LoadingPanel, Panel, StatusPill } from '../components/Ui';

export function SimulationsPage() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState({
    name: '',
    scenarioType: 'startup_founding',
    cloneCount: '500',
    capitalAtRisk: '',
    parameters: '{\n  "decision": "should I make this move?"\n}',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const scenariosQuery = useQuery({ queryKey: ['scenarios'], queryFn: api.getScenarios });
  const simulationsQuery = useQuery({
    queryKey: ['simulations', 'manage'],
    queryFn: () => api.getSimulations({ limit: 25 }),
    refetchInterval: 10_000,
  });

  const createSimulationMutation = useMutation({
    mutationFn: api.createSimulation,
    onSuccess: (response) => {
      setFormSuccess(`Queued ${response.name}. Simulation id: ${response.simulationId}`);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['simulations'] });
    },
    onError: (error: Error) => {
      setFormSuccess(null);
      setFormError(error.message);
    },
  });

  if (scenariosQuery.isLoading || simulationsQuery.isLoading) {
    return <LoadingPanel label="Loading scenario catalog and run history..." />;
  }

  if (scenariosQuery.error || simulationsQuery.error) {
    return (
      <ErrorPanel
        message={(scenariosQuery.error as Error | undefined)?.message ?? (simulationsQuery.error as Error | undefined)?.message ?? 'Unknown error'}
      />
    );
  }

  return (
    <div className="page-grid">
      <div className="two-column-grid">
        <Panel title="Launch a simulation" eyebrow="Create run">
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              setFormError(null);
              setFormSuccess(null);

              let parsedParameters: Record<string, unknown> | undefined;

              if (formState.parameters.trim()) {
                try {
                  parsedParameters = JSON.parse(formState.parameters) as Record<string, unknown>;
                } catch {
                  setFormError('Parameters must be valid JSON.');
                  return;
                }
              }

              createSimulationMutation.mutate({
                name: formState.name.trim() || `Monte UI ${new Date().toLocaleTimeString()}`,
                scenarioType: formState.scenarioType,
                cloneCount: Number(formState.cloneCount),
                capitalAtRisk: formState.capitalAtRisk ? Number(formState.capitalAtRisk) : undefined,
                parameters: parsedParameters,
              });
            }}
          >
            <label>
              <span>Name</span>
              <input
                value={formState.name}
                onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                placeholder="Join startup while keeping some runway?"
              />
            </label>

            <label>
              <span>Scenario</span>
              <select
                value={formState.scenarioType}
                onChange={(event) => setFormState((current) => ({ ...current, scenarioType: event.target.value }))}
              >
                {scenariosQuery.data?.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-grid form-grid--split">
              <label>
                <span>Clone count</span>
                <input
                  type="number"
                  min={10}
                  max={10000}
                  value={formState.cloneCount}
                  onChange={(event) => setFormState((current) => ({ ...current, cloneCount: event.target.value }))}
                />
              </label>

              <label>
                <span>Capital at risk</span>
                <input
                  type="number"
                  min={1}
                  value={formState.capitalAtRisk}
                  onChange={(event) => setFormState((current) => ({ ...current, capitalAtRisk: event.target.value }))}
                  placeholder="25000"
                />
              </label>
            </div>

            <label>
              <span>Parameters JSON</span>
              <textarea
                rows={8}
                value={formState.parameters}
                onChange={(event) => setFormState((current) => ({ ...current, parameters: event.target.value }))}
              />
            </label>

            {formError ? <p className="form-message form-message--error">{formError}</p> : null}
            {formSuccess ? <p className="form-message form-message--success">{formSuccess}</p> : null}

            <button className="ghost-button ghost-button--filled" type="submit" disabled={createSimulationMutation.isPending}>
              {createSimulationMutation.isPending ? 'Queueing...' : 'Queue simulation'}
            </button>
          </form>
        </Panel>

        <Panel title="Scenario presets" eyebrow="Catalog">
          <div className="scenario-grid">
            {scenariosQuery.data?.map((scenario) => (
              <article key={scenario.id} className="scenario-card">
                <div className="scenario-card__top">
                  <strong>{scenario.name}</strong>
                  <span>{scenario.timeframe}</span>
                </div>
                <p>{scenario.description}</p>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Simulation history" eyebrow="Recent runs">
        {simulationsQuery.data?.data.length ? (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Scenario</th>
                  <th>Status</th>
                  <th>Clones</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {simulationsQuery.data.data.map((simulation) => (
                  <tr key={simulation.id}>
                    <td>
                      <strong>{simulation.name}</strong>
                    </td>
                    <td>{titleCase(simulation.scenarioType)}</td>
                    <td>
                      <div className="table-status">
                        <StatusPill value={simulation.status} />
                        <span>{Math.round(simulation.progress)}%</span>
                      </div>
                    </td>
                    <td>{integerFormatter.format(simulation.cloneCount)}</td>
                    <td>{formatDate(simulation.createdAt)}</td>
                    <td>
                      <div className="table-actions">
                        <Link to={`/live?simulationId=${simulation.id}`}>Live</Link>
                        <Link to={`/results?simulationId=${simulation.id}`}>Results</Link>
                        <Link to={`/evidence?simulationId=${simulation.id}`}>Evidence</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No runs yet" body="Use the form above to queue Monte's first demo-ready simulation." />
        )}
      </Panel>
    </div>
  );
}
