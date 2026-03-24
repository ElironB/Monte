import { useQuery } from '@tanstack/react-query';
import { Radar, RadarChart, PolarAngleAxis, PolarGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { api } from '../lib/api';
import { formatDate, formatPercentFromRatio, formatTooltipNumber, titleCase } from '../lib/formatters';
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

  return (
    <div className="page-grid">
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

        <Panel title="Big Five radar" eyebrow="Compressed psychology">
          {psychology ? (
            <div className="chart-wrap chart-wrap--medium">
              <ResponsiveContainer>
                <RadarChart
                  data={[
                    { subject: 'Open', value: psychology.bigFive.openness },
                    { subject: 'Conscientious', value: psychology.bigFive.conscientiousness },
                    { subject: 'Extra', value: psychology.bigFive.extraversion },
                    { subject: 'Agree', value: psychology.bigFive.agreeableness },
                    { subject: 'Neuro', value: psychology.bigFive.neuroticism },
                  ]}
                >
                  <PolarGrid stroke="rgba(164, 167, 181, 0.18)" />
                  <PolarAngleAxis dataKey="subject" stroke="#8f94a6" />
                  <Tooltip formatter={(value) => formatTooltipNumber(value, formatPercentFromRatio)} />
                  <Radar dataKey="value" stroke="#7be0aa" fill="#7be0aa" fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No psychology chart yet" body="Rebuild the persona once data sources are ingested." />
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
