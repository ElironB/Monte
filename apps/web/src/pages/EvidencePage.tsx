import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDate, titleCase } from '../lib/formatters';
import { EmptyState, ErrorPanel, LoadingPanel, Panel, StatusPill } from '../components/Ui';

export function EvidencePage() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState({
    recommendationIndex: '1',
    result: 'positive',
    confidence: '0.75',
    observedSignal: '',
    notes: '',
  });
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  const simulationsQuery = useQuery({
    queryKey: ['simulations', 'evidence'],
    queryFn: () => api.getSimulations({ limit: 30 }),
  });

  const searchParams = new URLSearchParams(window.location.search);
  const requestedSimulationId = searchParams.get('simulationId');
  const selectedSimulation = requestedSimulationId
    ? simulationsQuery.data?.data.find((simulation) => simulation.id === requestedSimulationId)
    : simulationsQuery.data?.data.find((simulation) => simulation.status === 'completed');

  const resultsQuery = useQuery({
    queryKey: ['simulation-results', selectedSimulation?.id, 'evidence'],
    queryFn: () => api.getSimulationResults(selectedSimulation!.id, true),
    enabled: Boolean(selectedSimulation?.id),
  });

  const addEvidenceMutation = useMutation({
    mutationFn: (payload: Parameters<typeof api.addEvidence>[1]) => api.addEvidence(selectedSimulation!.id, payload),
    onSuccess: () => {
      setFeedback({ tone: 'success', message: 'Evidence recorded successfully.' });
      queryClient.invalidateQueries({ queryKey: ['simulation-results', selectedSimulation?.id] });
    },
    onError: (error: Error) => {
      setFeedback({ tone: 'error', message: error.message });
    },
  });

  const rerunMutation = useMutation({
    mutationFn: () => api.createRerun(selectedSimulation!.id, {}),
    onSuccess: (response: { rerunSimulationId?: string } | null) => {
      setFeedback({
        tone: 'success',
        message: `Rerun queued${response?.rerunSimulationId ? `: ${response.rerunSimulationId}` : '.'}`,
      });
      queryClient.invalidateQueries({ queryKey: ['simulations'] });
    },
    onError: (error: Error) => {
      setFeedback({ tone: 'error', message: error.message });
    },
  });

  if (simulationsQuery.isLoading || resultsQuery.isLoading) {
    return <LoadingPanel label="Loading experiment recommendations..." />;
  }

  if (simulationsQuery.error || resultsQuery.error) {
    return <ErrorPanel message={(simulationsQuery.error as Error | undefined)?.message ?? (resultsQuery.error as Error | undefined)?.message ?? 'Unknown error'} />;
  }

  if (!selectedSimulation || !resultsQuery.data?.distributions) {
    return <EmptyState title="No completed simulation available" body="Complete a run first, then record evidence and rerun from this page." />;
  }

  const results = resultsQuery.data.distributions;
  const experiments = results.decisionIntelligence?.recommendedExperiments ?? [];

  return (
    <div className="page-grid">
      <div className="two-column-grid">
        <Panel title="Recommended experiments" eyebrow="Decision intelligence">
          {experiments.length ? (
            <div className="stack">
              {experiments.map((experiment, index) => (
                <article key={`${experiment.focusMetric}-${index}`} className="flag-card">
                  <div className="flag-card__header">
                    <strong>
                      {index + 1}. {experiment.recommendedExperiment}
                    </strong>
                    <StatusPill value={experiment.priority} />
                  </div>
                  <p>{experiment.whyItMatters}</p>
                  <span>Focus metric: {experiment.focusMetric}</span>
                  <span>Uncertainty: {experiment.uncertainty}</span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No experiments recommended" body="This run did not produce decision-intelligence experiments yet." />
          )}
        </Panel>

        <Panel title="Record evidence" eyebrow="Submit observed signal">
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              setFeedback(null);

              addEvidenceMutation.mutate({
                recommendationIndex: formState.recommendationIndex ? Number(formState.recommendationIndex) : undefined,
                result: formState.result as 'positive' | 'negative' | 'mixed' | 'inconclusive',
                confidence: Number(formState.confidence),
                observedSignal: formState.observedSignal,
                notes: formState.notes || undefined,
              });
            }}
          >
            <label>
              <span>Recommendation index</span>
              <input
                type="number"
                min={1}
                value={formState.recommendationIndex}
                onChange={(event) => setFormState((current) => ({ ...current, recommendationIndex: event.target.value }))}
              />
            </label>

            <div className="form-grid form-grid--split">
              <label>
                <span>Result</span>
                <select
                  value={formState.result}
                  onChange={(event) => setFormState((current) => ({ ...current, result: event.target.value }))}
                >
                  <option value="positive">Positive</option>
                  <option value="negative">Negative</option>
                  <option value="mixed">Mixed</option>
                  <option value="inconclusive">Inconclusive</option>
                </select>
              </label>

              <label>
                <span>Confidence</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.05"
                  value={formState.confidence}
                  onChange={(event) => setFormState((current) => ({ ...current, confidence: event.target.value }))}
                />
              </label>
            </div>

            <label>
              <span>Observed signal</span>
              <textarea
                rows={4}
                value={formState.observedSignal}
                onChange={(event) => setFormState((current) => ({ ...current, observedSignal: event.target.value }))}
                placeholder="Observed a strong signal from three user interviews within one week."
              />
            </label>

            <label>
              <span>Notes</span>
              <textarea
                rows={4}
                value={formState.notes}
                onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Optional context for the rerun."
              />
            </label>

            {feedback ? <p className={`form-message form-message--${feedback.tone}`}>{feedback.message}</p> : null}

            <div className="button-row">
              <button className="ghost-button ghost-button--filled" type="submit" disabled={addEvidenceMutation.isPending}>
                {addEvidenceMutation.isPending ? 'Saving...' : 'Record evidence'}
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={rerunMutation.isPending}
                onClick={() => {
                  setFeedback(null);
                  rerunMutation.mutate();
                }}
              >
                {rerunMutation.isPending ? 'Queueing rerun...' : 'Create rerun'}
              </button>
            </div>
          </form>
        </Panel>
      </div>

      <Panel title="Applied evidence on this result" eyebrow="Audit trail">
        {results.appliedEvidence?.length ? (
          <div className="data-list">
            {results.appliedEvidence.map((evidence) => (
              <article key={evidence.id} className="data-list__item">
                <div>
                  <strong>{evidence.recommendedExperiment}</strong>
                  <p>{evidence.observedSignal}</p>
                </div>
                <div className="data-list__meta">
                  <StatusPill value={evidence.result} />
                  <span>{formatDate(evidence.createdAt)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No evidence recorded yet" body="Record the first real-world observation to make the evidence loop visible here." />
        )}
      </Panel>

      {results.rerunComparison ? (
        <Panel title="Current rerun comparison" eyebrow="Recommendation shift">
          <div className="prose-stack">
            <p>{results.rerunComparison.summary}</p>
            <p>
              Top uncertainty: {titleCase(results.rerunComparison.recommendationDelta.previousTopUncertainty ?? 'n/a')} to{' '}
              {titleCase(results.rerunComparison.recommendationDelta.newTopUncertainty ?? 'n/a')}
            </p>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
