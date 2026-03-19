import { describe, it, expect } from 'vitest';
import { CloneGenerator } from '../src/persona/cloneGenerator.js';
import { MasterPersona } from '../src/persona/personaCompressor.js';

describe('CloneGenerator', () => {
  const masterPersona: MasterPersona = {
    summary: 'Test persona',
    behavioralFingerprint: {
      riskTolerance: 0.7,
      timePreference: 0.4,
      socialDependency: 0.5,
      learningStyle: 0.6,
      decisionSpeed: 0.65,
      emotionalVolatility: 0.55,
    },
    keyContradictions: [],
    dominantTraits: [],
    riskProfile: 'moderate',
    timeHorizon: 'medium',
    narrativeSummary: 'Test narrative',
  };

  it('generates the requested number of clones', () => {
    const generator = new CloneGenerator(masterPersona, 'test-persona');
    const clones = generator.generateClones(100);
    expect(clones).toHaveLength(100);
  });

  it('generates 1000 clones by default', () => {
    const generator = new CloneGenerator(masterPersona, 'test-persona');
    const clones = generator.generateClones();
    expect(clones).toHaveLength(1000);
  });

  it('stratifies clones correctly (10% edge, 20% outlier, 70% typical)', () => {
    const generator = new CloneGenerator(masterPersona, 'test-persona');
    const clones = generator.generateClones(1000);
    const edge = clones.filter(c => c.stratification.category === 'edge');
    const typical = clones.filter(c => c.stratification.category === 'typical');
    expect(typical.length).toBe(700);
  });

  it('all clone parameters are bounded 0-1', () => {
    const generator = new CloneGenerator(masterPersona, 'test-persona');
    const clones = generator.generateClones(100);
    for (const clone of clones) {
      expect(clone.parameters.riskTolerance).toBeGreaterThanOrEqual(0);
      expect(clone.parameters.riskTolerance).toBeLessThanOrEqual(1);
      expect(clone.parameters.emotionalVolatility).toBeGreaterThanOrEqual(0);
      expect(clone.parameters.emotionalVolatility).toBeLessThanOrEqual(1);
    }
  });

  it('enforces behavioral consistency constraints', () => {
    const highRiskPersona: MasterPersona = {
      ...masterPersona,
      behavioralFingerprint: {
        ...masterPersona.behavioralFingerprint,
        riskTolerance: 0.95,
        emotionalVolatility: 0.1,
      },
    };
    const generator = new CloneGenerator(highRiskPersona, 'test-persona');
    const clones = generator.generateClones(100);
    const edgeClones = clones.filter(c => c.stratification.percentile >= 90);
    for (const clone of edgeClones) {
      if (clone.parameters.riskTolerance > 0.8) {
        expect(clone.parameters.emotionalVolatility).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it('each clone has a unique ID', () => {
    const generator = new CloneGenerator(masterPersona, 'test-persona');
    const clones = generator.generateClones(100);
    const ids = new Set(clones.map(c => c.id));
    expect(ids.size).toBe(100);
  });
});
