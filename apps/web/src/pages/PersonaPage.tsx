import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDate, formatPercentFromRatio, titleCase } from '../lib/formatters';
import type { PersonaTrait, PsychologicalProfile } from '../lib/types';
import { EmptyState, ErrorPanel, KeyValueGrid, LoadingPanel, MiniBar, Panel, StatusPill } from '../components/Ui';

const DIMENSION_ORDER = [
  'riskTolerance',
  'timePreference',
  'socialDependency',
  'learningStyle',
  'decisionSpeed',
  'emotionalVolatility',
  'executionGap',
  'informationSeeking',
  'stressResponse',
];

export function PersonaPage() {
  const personaQuery = useQuery({ queryKey: ['persona'], queryFn: api.getPersona });
  const traitsQuery = useQuery({ queryKey: ['persona-traits'], queryFn: api.getPersonaTraits });
  const psychologyQuery = useQuery({ queryKey: ['psychology'], queryFn: api.getPsychology });
  const historyQuery = useQuery({ queryKey: ['persona-history'], queryFn: api.getPersonaHistory });

  if (personaQuery.isLoading || traitsQuery.isLoading || psychologyQuery.isLoading || historyQuery.isLoading) {
    return <LoadingPanel label="Loading persona dimensions and psychology..." />;
  }

  if (personaQuery.error || traitsQuery.error || psychologyQuery.error || historyQuery.error) {
    return (
      <ErrorPanel
        message={
          (personaQuery.error as Error | undefined)?.message ??
          (traitsQuery.error as Error | undefined)?.message ??
          (psychologyQuery.error as Error | undefined)?.message ??
          (historyQuery.error as Error | undefined)?.message ??
          'Unknown error'
        }
      />
    );
  }

  const persona = personaQuery.data;
  if (persona && 'status' in persona && persona.status === 'none') {
    return <EmptyState title="No persona built yet" body={persona.message} />;
  }

  const dimensions = normalizeDimensions(traitsQuery.data ?? []);
  const psychologyData = psychologyQuery.data;
  const psychology = psychologyData && 'status' in psychologyData ? null : (psychologyData as PsychologicalProfile | null);
  const bigFive: Array<[string, number]> = psychology
    ? [
        ['Openness', psychology.bigFive.openness],
        ['Conscientiousness', psychology.bigFive.conscientiousness],
        ['Extraversion', psychology.bigFive.extraversion],
        ['Agreeableness', psychology.bigFive.agreeableness],
        ['Neuroticism', psychology.bigFive.neuroticism],
      ]
    : [];

  return (
    <div className="page-grid">
      <Panel className="hero-panel" eyebrow="Persona readout" title="Behavioral fingerprint, decision mechanics, and the readable psychology layer.">
        <div className="hero-panel__content">
          <div className="hero-panel__copy">
            <p className="hero-panel__lede">
              {psychology?.narrativeSummary ??
                'Rebuild the persona after ingestion to populate the derived psychology layer and the scenario-sensitive reading.'}
            </p>
            <div className="hero-panel__chips">
              <StatusPill value={persona && 'buildStatus' in persona ? persona.buildStatus : 'unknown'} />
              <StatusPill value={`${dimensions.length} dimensions`} />
              <StatusPill value={`${persona && 'memoryCount' in persona ? persona.memoryCount : 0} memories`} />
            </div>
          </div>
          <div className="hero-panel__brief">
            <div className="hero-panel__brief-item">
              <span>Attachment style</span>
              <strong>{psychology ? titleCase(psychology.attachment.style) : 'Unavailable'}</strong>
            </div>
            <div className="hero-panel__brief-item">
              <span>Locus of control</span>
              <strong>{psychology ? titleCase(psychology.locusOfControl.type) : 'Unavailable'}</strong>
            </div>
            <div className="hero-panel__brief-item">
              <span>Profile version</span>
              <strong>{persona && 'version' in persona ? persona.version : 'n/a'}</strong>
            </div>
          </div>
        </div>
      </Panel>

      <div className="three-column-grid">
        <Panel title="Persona state" eyebrow="Snapshot">
          <KeyValueGrid
            items={[
              { label: 'Version', value: persona && 'version' in persona ? persona.version : 'n/a' },
              {
                label: 'Build status',
                value: persona && 'buildStatus' in persona ? <StatusPill value={persona.buildStatus} /> : 'n/a',
              },
              { label: 'Traits', value: persona && 'traitCount' in persona ? persona.traitCount : 'n/a' },
              { label: 'Memories', value: persona && 'memoryCount' in persona ? persona.memoryCount : 'n/a' },
            ]}
          />
        </Panel>

        <Panel title="Attachment" eyebrow="Derived pattern">
          {psychology ? (
            <KeyValueGrid
              items={[
                { label: 'Style', value: titleCase(psychology.attachment.style) },
                { label: 'Confidence', value: formatPercentFromRatio(psychology.attachment.confidence) },
                { label: 'Anxiety axis', value: formatPercentFromRatio(psychology.attachment.anxietyAxis) },
                { label: 'Avoidance axis', value: formatPercentFromRatio(psychology.attachment.avoidanceAxis) },
              ]}
            />
          ) : (
            <EmptyState title="Psychology unavailable" body="Rebuild the persona to populate the derived psychology layer." />
          )}
        </Panel>

        <Panel title="Temporal bias" eyebrow="Decision mechanics">
          {psychology ? (
            <KeyValueGrid
              items={[
                { label: 'Discounting rate', value: titleCase(psychology.temporalDiscounting.discountingRate) },
                { label: 'Present bias', value: formatPercentFromRatio(psychology.temporalDiscounting.presentBiasStrength) },
                { label: 'Locus', value: titleCase(psychology.locusOfControl.type) },
                { label: 'Locus confidence', value: formatPercentFromRatio(psychology.locusOfControl.confidence) },
              ]}
            />
          ) : (
            <EmptyState title="Awaiting psychology output" body="This card will light up once the profile is ready." />
          )}
        </Panel>
      </div>

      <div className="two-column-grid">
        <Panel title="Nine dimensions" eyebrow="Behavioral fingerprint">
          <div className="stack">
            {dimensions.map((trait) => (
              <MiniBar
                key={trait.name}
                label={titleCase(trait.name)}
                value={trait.value}
                hint={`confidence ${Math.round(trait.confidence * 100)}%`}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Big Five profile" eyebrow="Compressed psychology">
          {psychology ? (
            <div className="stack">
              {bigFive.map(([label, value]) => (
                <MiniBar key={label} label={label} value={value} hint={`${Math.round(value * 100)} percentile-style score`} />
              ))}
              <p className="muted">
                Monte compresses the psychology layer into a readable summary rather than forcing reviewers to decode a radar chart.
              </p>
            </div>
          ) : (
            <EmptyState title="No psychology profile yet" body="Rebuild the persona once data sources are ingested." />
          )}
        </Panel>
      </div>

      <div className="two-column-grid">
        <Panel title="Narrative summary" eyebrow="Readable layer">
          <p className="prose-block">{psychology?.narrativeSummary ?? 'Narrative summary will appear here once the profile is available.'}</p>
          {psychology ? <p className="muted">{psychology.locusOfControl.implication}</p> : null}
        </Panel>

        <Panel title="Risk flags" eyebrow="Scenario sensitivity">
          {psychology?.riskFlags.length ? (
            <div className="flag-list">
              {psychology.riskFlags.map((flag) => (
                <article key={flag.flag} className="flag-card">
                  <div className="flag-card__header">
                    <strong>{flag.flag}</strong>
                    <StatusPill value={flag.severity} />
                  </div>
                  <p>{flag.description}</p>
                  <span>{flag.affectedScenarios.map(titleCase).join(', ')}</span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No risk flags found" body="This profile is not currently surfacing elevated scenario-specific risk flags." />
          )}
        </Panel>
      </div>

      <Panel title="Persona history" eyebrow="Version trail">
        <div className="data-list">
          {historyQuery.data?.map((entry) => (
            <article key={entry.id} className="data-list__item">
              <div>
                <strong>Version {entry.version}</strong>
                <p>{entry.lastError ?? 'No recorded error'}</p>
              </div>
              <div className="data-list__meta">
                <StatusPill value={entry.buildStatus} />
                <span>{formatDate(entry.createdAt)}</span>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function normalizeDimensions(traits: PersonaTrait[]) {
  const byName = new Map(traits.filter((trait) => trait.type === 'dimension').map((trait) => [trait.name, trait]));

  return DIMENSION_ORDER.map((name) => byName.get(name) ?? { id: name, type: 'dimension', name, value: 0.5, confidence: 0 });
}
