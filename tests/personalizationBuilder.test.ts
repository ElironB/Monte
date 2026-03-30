import { describe, expect, test } from 'vitest';
import {
  buildPersonalizationBootstrapPayload,
  buildPersonalizationContextPayload,
  buildPersonalizationProfilePayload,
  classifyTaskMode,
  classifyRecommendedSurface,
  type PersonalizationSeed,
} from '../src/personalization/builder.js';

function makeSeed(overrides: Partial<PersonalizationSeed> = {}): PersonalizationSeed {
  return {
    personaId: 'persona-123',
    version: 3,
    summary: 'Deliberate, structured, reassurance-seeking.',
    riskProfile: 'conservative',
    timeHorizon: 'medium',
    behavioralFingerprint: {
      riskTolerance: 0.28,
      timePreference: 0.42,
      socialDependency: 0.68,
      learningStyle: 0.73,
      decisionSpeed: 0.34,
      emotionalVolatility: 0.76,
      executionGap: 0.49,
      informationSeeking: 0.82,
      stressResponse: 0.71,
    },
    dimensionScores: {
      riskTolerance: { value: 0.28, confidence: 0.8, signalCount: 6, sourceCount: 3, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.2, 0.35] },
      timePreference: { value: 0.42, confidence: 0.8, signalCount: 6, sourceCount: 3, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.35, 0.5] },
      socialDependency: { value: 0.68, confidence: 0.8, signalCount: 6, sourceCount: 3, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.6, 0.75] },
      learningStyle: { value: 0.73, confidence: 0.8, signalCount: 6, sourceCount: 3, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.65, 0.8] },
      decisionSpeed: { value: 0.34, confidence: 0.8, signalCount: 6, sourceCount: 3, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.25, 0.42] },
      emotionalVolatility: { value: 0.76, confidence: 0.8, signalCount: 6, sourceCount: 3, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.68, 0.84] },
      executionGap: { value: 0.49, confidence: 0.42, signalCount: 2, sourceCount: 1, sourceTypes: ['notes'], isEstimated: true, confidenceInterval: [0.2, 0.8] },
      informationSeeking: { value: 0.82, confidence: 0.81, signalCount: 6, sourceCount: 3, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.75, 0.9] },
      stressResponse: { value: 0.71, confidence: 0.44, signalCount: 2, sourceCount: 1, sourceTypes: ['search_history'], isEstimated: true, confidenceInterval: [0.3, 0.9] },
    },
    dominantTraits: ['informationSeeking', 'emotionalVolatility'],
    keyContradictions: ['High information seeking can slow commitment under stress.'],
    psychologicalProfile: {
      bigFive: {
        openness: 0.75,
        conscientiousness: 0.42,
        extraversion: 0.48,
        agreeableness: 0.61,
        neuroticism: 0.79,
        confidence: 0.73,
        dominantTrait: 'O',
        deficitTrait: 'C',
      },
      attachment: {
        style: 'anxious',
        confidence: 0.72,
        anxietyAxis: 0.74,
        avoidanceAxis: 0.22,
        primarySignals: ['emotionalVolatility', 'socialDependency'],
      },
      locusOfControl: {
        type: 'mixed',
        score: 0.51,
        confidence: 0.69,
        implication: 'Situational locus.',
      },
      temporalDiscounting: {
        discountingRate: 'hyperbolic_moderate',
        score: 0.48,
        confidence: 0.65,
        presentBiasStrength: 0.55,
        mechanismDescription: 'Moderate present bias.',
      },
      riskFlags: [
        {
          flag: 'stress_spiral',
          severity: 'high',
          description: 'Under stress, the user may overweight downside and delay commitment.',
          affectedScenarios: ['general'],
        },
      ],
      narrativeSummary: 'This user seeks reassurance and structure when stakes rise.',
      technicalSummary: 'Anxious attachment with high information seeking.',
    },
    signalCount: 24,
    sourceCount: 3,
    sourceTypes: ['ai_chat', 'notes', 'search_history'],
    signals: [
      { value: 'structured_thinker', type: 'cognitive_trait', confidence: 0.82 },
      { value: 'validation_seeking', type: 'cognitive_trait', confidence: 0.77 },
      { value: 'collaborative_thinker', type: 'cognitive_trait', confidence: 0.74 },
      { value: 'anxiety', type: 'emotional_state', confidence: 0.83 },
      { value: 'learning_focused', type: 'cognitive_trait', confidence: 0.66 },
    ],
    ...overrides,
  };
}

describe('personalization builder', () => {
  test('builds a stable profile payload with supportive, downside-first guidance', () => {
    const payload = buildPersonalizationProfilePayload(makeSeed());

    expect(payload.ok).toBe(true);
    expect(payload.profile.guidance.communication.tone).toBe('supportive');
    expect(payload.profile.guidance.communication.structure).toBe('high');
    expect(payload.profile.guidance.decisioning.riskFrame).toBe('downside-first');
    expect(payload.profile.guidance.collaboration.autonomy).toBe('shared');
    expect(payload.profile.lowConfidenceDimensions).toEqual(['executionGap', 'stressResponse']);
    expect(payload.profile.guidance.watchouts.some((item) => item.includes('executionGap'))).toBe(true);
  });

  test('creates task-aware context payloads with explicit mode overrides', () => {
    const payload = buildPersonalizationContextPayload(makeSeed(), {
      task: 'Draft a short founder update for investors',
      mode: 'writing',
      agentName: 'Hermes',
    });

    expect(payload.mode).toBe('writing');
    expect(payload.taskAdaptation.responseShape).toContain('Draft first');
    expect(payload.instructionBlock).toContain('## Task Adjustments');
    expect(payload.instructionBlock).toContain('You are Hermes');
  });

  test('classifies supported task modes and falls back to general for code tasks', () => {
    expect(classifyTaskMode('Should I accept this offer?')).toBe('decision');
    expect(classifyTaskMode('Write a sharp outbound email')).toBe('writing');
    expect(classifyTaskMode('Plan the rollout for this feature')).toBe('planning');
    expect(classifyTaskMode('Explain how attachment theory works')).toBe('learning');
    expect(classifyTaskMode('Refactor this function and fix the tests')).toBe('general');
  });

  test('prefers personalization unless the task explicitly asks for simulation-style judgment', () => {
    expect(classifyRecommendedSurface('Should I accept this offer?')).toBe('personalize_context');
    expect(classifyRecommendedSurface('Plan the rollout for this feature')).toBe('personalize_context');
    expect(classifyRecommendedSurface('Run a simulation with clone outcomes for this decision')).toBe('monte_decide');
  });

  test('builds bootstrap payloads for ready and not-ready states', () => {
    const ready = buildPersonalizationBootstrapPayload({
      status: 'ready',
      task: 'Help me plan next week',
      nextAction: {
        command: 'monte personalize context "Help me plan next week" --json',
        description: 'Use task-aware personalization.',
      },
      seed: makeSeed(),
    });

    expect(ready.status).toBe('ready');
    expect(ready.recommendedSurface).toBe('personalize_context');
    expect(ready.profile?.summary).toContain('Deliberate');

    const blocked = buildPersonalizationBootstrapPayload({
      status: 'needs_ingestion',
      task: 'Help me plan next week',
      nextAction: {
        command: 'monte ingest <path>',
        description: 'Ingest personal data first.',
      },
      reasonIfNotReady: 'No ingested sources were found yet.',
    });

    expect(blocked.status).toBe('needs_ingestion');
    expect(blocked.profile).toBeUndefined();
    expect(blocked.instructionBlock).toContain('Default to `monte personalize context`');
  });
});
