import { runQuery, runQuerySingle } from '../config/neo4j.js';
import type { DimensionScore } from '../persona/personaCompressor.js';
import type { PsychologicalProfile } from '../persona/psychologyLayer.js';
import type { PersonalizationSeed, PersonalizationSignal } from './builder.js';

interface LatestPersonaRow {
  id: string;
  version: number | { toNumber: () => number };
  buildStatus: string;
  summary: string | null;
  riskProfile: string | null;
  timeHorizon: string | null;
  behavioralFingerprint: string | null;
  dominantTraits: string | null;
  keyContradictions: string | null;
  psychologicalProfile: string | null;
  signalCount: number | { toNumber: () => number } | null;
}

interface TraitRow {
  name: string;
  value: number;
  confidence: number;
  signalCount: number | { toNumber: () => number } | null;
  sourceCount: number | { toNumber: () => number } | null;
  sourceTypes: string[] | string | null;
  isEstimated: boolean | null;
  confidenceInterval: [number, number] | string | null;
}

interface SignalRow {
  value: string;
  type: string;
  confidence: number;
}

interface CoverageRow {
  sourceCount: number | { toNumber: () => number };
  sourceTypes: string[] | null;
  derivedSignalCount: number | { toNumber: () => number };
}

export type LatestPersonalizationLookup =
  | { status: 'none' }
  | { status: 'not_ready'; buildStatus: string; version: number }
  | { status: 'ready'; seed: PersonalizationSeed };

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }

  return Number(value ?? 0);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseStringArray(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  if (typeof value === 'string') {
    return parseJson<string[]>(value, []);
  }

  return [];
}

function parseConfidenceInterval(value: TraitRow['confidenceInterval']): [number, number] {
  if (Array.isArray(value) && value.length === 2) {
    return [Number(value[0]), Number(value[1])];
  }

  if (typeof value === 'string') {
    const parsed = parseJson<[number, number] | number[]>(value, [0, 1]);
    return Array.isArray(parsed) && parsed.length === 2
      ? [Number(parsed[0]), Number(parsed[1])]
      : [0, 1];
  }

  return [0, 1];
}

export async function getLatestPersonalizationSeed(userId: string): Promise<LatestPersonalizationLookup> {
  const latestPersona = await runQuerySingle<LatestPersonaRow>(
    `MATCH (u:User {id: $userId})-[:HAS_PERSONA]->(p:Persona)
     RETURN p.id as id,
            p.version as version,
            p.buildStatus as buildStatus,
            p.summary as summary,
            p.riskProfile as riskProfile,
            p.timeHorizon as timeHorizon,
            p.behavioralFingerprint as behavioralFingerprint,
            p.dominantTraits as dominantTraits,
            p.keyContradictions as keyContradictions,
            p.psychologicalProfile as psychologicalProfile,
            p.signalCount as signalCount
     ORDER BY p.version DESC
     LIMIT 1`,
    { userId },
  );

  if (!latestPersona) {
    return { status: 'none' };
  }

  const version = toNumber(latestPersona.version);
  if (latestPersona.buildStatus !== 'ready') {
    return {
      status: 'not_ready',
      buildStatus: latestPersona.buildStatus,
      version,
    };
  }

  const [traits, signals, coverage] = await Promise.all([
    runQuery<TraitRow>(
      `MATCH (p:Persona {id: $personaId})-[:HAS_TRAIT]->(t:Trait)
       RETURN t.name as name,
              t.value as value,
              t.confidence as confidence,
              t.signalCount as signalCount,
              t.sourceCount as sourceCount,
              t.sourceTypes as sourceTypes,
              t.isEstimated as isEstimated,
              t.confidenceInterval as confidenceInterval
       ORDER BY t.name ASC`,
      { personaId: latestPersona.id },
    ),
    runQuery<SignalRow>(
      `MATCH (p:Persona {id: $personaId})-[:DERIVED_FROM]->(s:Signal)
       RETURN s.value as value, s.type as type, s.confidence as confidence
       ORDER BY s.confidence DESC, s.value ASC
       LIMIT 100`,
      { personaId: latestPersona.id },
    ),
    runQuerySingle<CoverageRow>(
      `MATCH (p:Persona {id: $personaId})-[:DERIVED_FROM]->(s:Signal)
       OPTIONAL MATCH (s)<-[:HAS_SIGNAL]-(d:DataSource)
       RETURN count(DISTINCT d) as sourceCount,
              collect(DISTINCT d.sourceType) as sourceTypes,
              count(DISTINCT s) as derivedSignalCount`,
      { personaId: latestPersona.id },
    ),
  ]);

  const dimensionScores = traits.reduce<Record<string, DimensionScore>>((acc, trait) => {
    acc[trait.name] = {
      value: trait.value,
      confidence: trait.confidence,
      signalCount: toNumber(trait.signalCount),
      sourceCount: toNumber(trait.sourceCount),
      sourceTypes: parseStringArray(trait.sourceTypes),
      isEstimated: Boolean(trait.isEstimated),
      confidenceInterval: parseConfidenceInterval(trait.confidenceInterval),
    };
    return acc;
  }, {});

  const behavioralFingerprint = parseJson<Record<string, number>>(
    latestPersona.behavioralFingerprint,
    Object.fromEntries(traits.map((trait) => [trait.name, trait.value])),
  );

  const parsedSignals = signals.map<PersonalizationSignal>((signal) => ({
    value: signal.value,
    type: signal.type,
    confidence: signal.confidence,
  }));

  return {
    status: 'ready',
    seed: {
      personaId: latestPersona.id,
      version,
      summary: latestPersona.summary ?? 'Behavioral profile available.',
      riskProfile: latestPersona.riskProfile ?? 'unknown',
      timeHorizon: latestPersona.timeHorizon ?? 'unknown',
      behavioralFingerprint,
      dimensionScores,
      dominantTraits: parseJson<string[]>(latestPersona.dominantTraits, []),
      keyContradictions: parseJson<string[]>(latestPersona.keyContradictions, []),
      psychologicalProfile: parseJson<PsychologicalProfile | null>(latestPersona.psychologicalProfile, null),
      signalCount: Math.max(toNumber(latestPersona.signalCount), toNumber(coverage?.derivedSignalCount)),
      sourceCount: toNumber(coverage?.sourceCount),
      sourceTypes: parseStringArray(coverage?.sourceTypes).sort(),
      signals: parsedSignals,
    },
  };
}
