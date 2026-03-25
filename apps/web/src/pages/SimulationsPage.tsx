import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, integerFormatter, titleCase } from '../lib/formatters';
import { EmptyState, ErrorPanel, LoadingPanel, Panel, StatusPill } from '../components/Ui';

const SCENARIO_PARAMETER_PRESETS: Record<string, Record<string, unknown>> = {
  day_trading: {
    title: 'Leave work to day trade full-time',
    currentEmployment: true,
    savingsAmount: 50000,
    timeframe: 18,
    fallbackPlan: 'return to stable income if drawdown breaks discipline',
    keyUnknowns: [
      'Is the trading edge real enough to survive a bad regime?',
      'How much drawdown changes behavior before the strategy breaks?',
    ],
  },
  startup_founding: {
    title: 'Start a company while preserving runway',
    currentEmployment: true,
    runwayMonths: 18,
    timeframe: 36,
    fallbackPlan: 'keep consulting or stay employed while validating demand',
    keyUnknowns: [
      'Is there real demand strong enough to support the bet?',
      'How much runway exists before the thesis has to prove itself?',
    ],
  },
  career_change: {
    title: 'Switch careers without blowing up financial stability',
    currentEmployment: true,
    timeframe: 18,
    fallbackPlan: 'keep the current role while testing the new path',
    keyUnknowns: [
      'Can the skill gap close fast enough to stay competitive?',
      'Will the market pay for the new identity soon enough?',
    ],
  },
  advanced_degree: {
    title: 'Take an advanced degree for better long-term upside',
    tuitionCost: 50000,
    timeframe: 24,
    fallbackPlan: 'stay on the current path and re-evaluate after cheaper experiments',
    keyUnknowns: [
      'Will the degree materially open better opportunities?',
      'How long is the payback period if the best case never lands?',
    ],
  },
  geographic_relocation: {
    title: 'Move cities for a better opportunity set',
    movingCost: 15000,
    timeframe: 18,
    fallbackPlan: 'delay the move and keep scouting remotely',
    keyUnknowns: [
      'Does the move materially improve access to better opportunities?',
      'How reversible is the relocation if the city underdelivers?',
    ],
  },
  real_estate_purchase: {
    title: 'Buy a home without killing optionality',
    downPayment: 60000,
    timeframe: 84,
    fallbackPlan: 'keep renting while rates or inventory improve',
    keyUnknowns: [
      'How much optionality disappears once the purchase is locked in?',
      'Can the monthly carrying cost survive a bad regime?',
    ],
  },
  health_fitness_goal: {
    title: 'Commit to a health reset that actually sticks',
    timeframe: 12,
    fallbackPlan: 'fall back to a smaller routine that still compounds',
    keyUnknowns: [
      'Which failure mode usually breaks consistency first?',
      'What minimum viable routine still works when life gets noisy?',
    ],
  },
  custom: {
    title: 'Hard decision with incomplete information',
    primaryQuestion: 'Should I take a job offer for 120K a year or keep looking?',
    timeframe: 18,
    fallbackPlan: 'preserve runway and keep a reversible backup path alive',
    keyUnknowns: [
      'Is the upside signal real enough to justify deeper commitment?',
      'What is the cheapest experiment that meaningfully de-risks the thesis?',
    ],
  },
};

const DEFAULT_PARAMETER_DRAFTS = Object.fromEntries(
  Object.entries(SCENARIO_PARAMETER_PRESETS).map(([scenarioType, parameters]) => [
    scenarioType,
    JSON.stringify(parameters, null, 2),
  ]),
) as Record<string, string>;

function normalizeParameters(
  scenarioType: string,
  parameters: Record<string, unknown> | undefined,
  fallbackName: string,
) {
  if (!parameters) {
    return undefined;
  }

  const normalized = { ...parameters };

  if (scenarioType === 'custom') {
    const legacyDecision =
      typeof normalized.decision === 'string' && normalized.decision.trim().length > 0
        ? normalized.decision.trim()
        : undefined;
    const primaryQuestion =
      typeof normalized.primaryQuestion === 'string' && normalized.primaryQuestion.trim().length > 0
        ? normalized.primaryQuestion.trim()
        : legacyDecision;

    if (primaryQuestion) {
      normalized.primaryQuestion = primaryQuestion;
    }

    delete normalized.decision;

    if (
      (typeof normalized.title !== 'string' || normalized.title.trim().length === 0)
      && fallbackName.trim().length > 0
    ) {
      normalized.title = fallbackName.trim();
    }
  }

  return normalized;
}

export function SimulationsPage() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState({
    name: '',
    scenarioType: 'startup_founding',
    cloneCount: '500',
    capitalAtRisk: '',
  });
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>(() => ({
    ...DEFAULT_PARAMETER_DRAFTS,
  }));
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

  const activeScenario = scenariosQuery.data?.find((scenario) => scenario.id === formState.scenarioType);
  const activeParametersDraft = parameterDrafts[formState.scenarioType] ?? DEFAULT_PARAMETER_DRAFTS[formState.scenarioType] ?? '{}';
  const isCustomScenario = formState.scenarioType === 'custom';

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

              if (activeParametersDraft.trim()) {
                try {
                  parsedParameters = JSON.parse(activeParametersDraft) as Record<string, unknown>;
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
                parameters: normalizeParameters(formState.scenarioType, parsedParameters, formState.name),
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
                onChange={(event) => {
                  const nextScenarioType = event.target.value;
                  setFormState((current) => ({ ...current, scenarioType: nextScenarioType }));
                  setFormError(null);
                  setFormSuccess(null);
                  setParameterDrafts((current) => {
                    if (current[nextScenarioType]) {
                      return current;
                    }

                    return {
                      ...current,
                      [nextScenarioType]: DEFAULT_PARAMETER_DRAFTS[nextScenarioType] ?? '{}',
                    };
                  });
                }}
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

            {isCustomScenario ? (
              <label>
                <span>Custom scenario JSON</span>
                <p className="form-helper">
                  Use <code>primaryQuestion</code> for the actual decision prompt. Optional keys like <code>title</code>, <code>timeframe</code>, <code>fallbackPlan</code>, and <code>keyUnknowns</code> let you steer the run more precisely.
                </p>
                <textarea
                  rows={10}
                  value={activeParametersDraft}
                  onChange={(event) => setParameterDrafts((current) => ({
                    ...current,
                    [formState.scenarioType]: event.target.value,
                  }))}
                />
              </label>
            ) : (
              <div className="preset-note">
                <p className="panel__eyebrow">Preset context</p>
                <strong>{activeScenario?.name ?? 'Scenario preset'} is applying structured defaults behind the scenes.</strong>
                <p>
                  Monte is auto-filling the hidden parameter payload for this preset, including things like timeframe, fallback plan, and the main unknowns. Switch to <code>Custom Scenario</code> to edit raw JSON directly.
                </p>
              </div>
            )}

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
                      <strong>{simulation.title ?? simulation.name}</strong>
                      {simulation.primaryQuestion && simulation.primaryQuestion !== (simulation.title ?? simulation.name) ? (
                        <p className="table-subcopy">{simulation.primaryQuestion}</p>
                      ) : null}
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
