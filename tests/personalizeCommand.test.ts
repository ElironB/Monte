import { describe, expect, test } from 'vitest';
import { buildPersonalizationBootstrapPayload, buildPersonalizationContextPayload, buildPersonalizationProfilePayload, type PersonalizationSeed } from '../src/personalization/builder.js';
import { renderPersonalizationBootstrap, renderPersonalizationContext, renderPersonalizationProfile } from '../src/cli/commands/personalize.js';

function makeSeed(): PersonalizationSeed {
  return {
    personaId: 'persona-789',
    version: 1,
    summary: 'Direct, structured, and planning-oriented.',
    riskProfile: 'moderate',
    timeHorizon: 'long',
    behavioralFingerprint: {
      riskTolerance: 0.61,
      timePreference: 0.25,
      socialDependency: 0.38,
      learningStyle: 0.71,
      decisionSpeed: 0.62,
      emotionalVolatility: 0.31,
      executionGap: 0.26,
      informationSeeking: 0.69,
      stressResponse: 0.33,
    },
    dimensionScores: {
      riskTolerance: { value: 0.61, confidence: 0.82, signalCount: 5, sourceCount: 2, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.5, 0.7] },
      timePreference: { value: 0.25, confidence: 0.8, signalCount: 5, sourceCount: 2, sourceTypes: ['notes'], isEstimated: false, confidenceInterval: [0.15, 0.35] },
      socialDependency: { value: 0.38, confidence: 0.8, signalCount: 5, sourceCount: 2, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.3, 0.45] },
      learningStyle: { value: 0.71, confidence: 0.81, signalCount: 5, sourceCount: 2, sourceTypes: ['notes'], isEstimated: false, confidenceInterval: [0.62, 0.8] },
      decisionSpeed: { value: 0.62, confidence: 0.8, signalCount: 5, sourceCount: 2, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.55, 0.7] },
      emotionalVolatility: { value: 0.31, confidence: 0.77, signalCount: 5, sourceCount: 2, sourceTypes: ['ai_chat'], isEstimated: false, confidenceInterval: [0.2, 0.4] },
      executionGap: { value: 0.26, confidence: 0.76, signalCount: 5, sourceCount: 2, sourceTypes: ['notes'], isEstimated: false, confidenceInterval: [0.15, 0.35] },
      informationSeeking: { value: 0.69, confidence: 0.8, signalCount: 5, sourceCount: 2, sourceTypes: ['search_history'], isEstimated: false, confidenceInterval: [0.6, 0.76] },
      stressResponse: { value: 0.33, confidence: 0.75, signalCount: 5, sourceCount: 2, sourceTypes: ['search_history'], isEstimated: false, confidenceInterval: [0.24, 0.42] },
    },
    dominantTraits: ['learningStyle', 'timePreference'],
    keyContradictions: [],
    psychologicalProfile: null,
    signalCount: 18,
    sourceCount: 2,
    sourceTypes: ['ai_chat', 'notes'],
    signals: [
      { value: 'structured_thinker', type: 'cognitive_trait', confidence: 0.81 },
      { value: 'systematic_planner', type: 'cognitive_trait', confidence: 0.73 },
    ],
  };
}

describe('personalize command renderers', () => {
  test('renders a human-readable profile report', () => {
    const payload = buildPersonalizationProfilePayload(makeSeed());
    const rendered = renderPersonalizationProfile(payload.profile);

    expect(rendered).toContain('Personalization Profile');
    expect(rendered).toContain('Interaction Style');
    expect(rendered).toContain('Instruction Block');
  });

  test('renders task-aware context details', () => {
    const payload = buildPersonalizationContextPayload(makeSeed(), {
      task: 'Plan the rollout for the new personalization endpoint',
      mode: 'planning',
    });
    const rendered = renderPersonalizationContext(payload);

    expect(rendered).toContain('Task Context');
    expect(rendered).toContain('Task Instruction Block');
    expect(rendered).toContain('planning');
  });

  test('renders agent bootstrap guidance', () => {
    const payload = buildPersonalizationBootstrapPayload({
      status: 'ready',
      task: 'Help me plan the week',
      nextAction: {
        command: 'monte personalize context "Help me plan the week" --json',
        description: 'Use task-aware personalization.',
      },
      seed: makeSeed(),
    });
    const rendered = renderPersonalizationBootstrap(payload);

    expect(rendered).toContain('Agent Bootstrap');
    expect(rendered).toContain('Preferred surface');
    expect(rendered).toContain('Bootstrap Instruction Block');
  });
});
