import { afterEach, describe, expect, it, vi } from 'vitest';
import { getScenario } from '../../src/simulation/decisionGraph.js';
import { SimulationEngine } from '../../src/simulation/engine.js';
import { createForkEvaluator } from '../../src/simulation/forkEvaluator.js';
import { ScenarioType, type CloneParameters, type DecisionNode } from '../../src/simulation/types.js';

const aggressiveParameters: CloneParameters = {
    riskTolerance: 0.9,
    timePreference: 0.72,
    socialDependency: 0.24,
    learningStyle: 0.36,
    decisionSpeed: 0.84,
    emotionalVolatility: 0.7,
    executionGap: 0.24,
    informationSeeking: 0.34,
    stressResponse: 0.26,
};

const cautiousParameters: CloneParameters = {
    riskTolerance: 0.2,
    timePreference: 0.24,
    socialDependency: 0.76,
    learningStyle: 0.84,
    decisionSpeed: 0.24,
    emotionalVolatility: 0.36,
    executionGap: 0.18,
    informationSeeking: 0.9,
    stressResponse: 0.66,
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Monte Simulation Benchmark Suite', () => {
    it('custom hard-decision scenario produces divergent path signatures for opposite personas', async () => {
        const scenario = getScenario(ScenarioType.CUSTOM);
        const engine = new SimulationEngine(scenario, { useLLM: false, useChaos: false });
        vi.spyOn(Math, 'random').mockReturnValue(0.5);

        const aggressive = await engine.executeClone('bench-aggressive', aggressiveParameters, {
            percentile: 95,
            category: 'edge',
        });
        const cautious = await engine.executeClone('bench-cautious', cautiousParameters, {
            percentile: 5,
            category: 'edge',
        });

        expect(aggressive.path).not.toEqual(cautious.path);
    });

    it('fork prompts include the richer persona narrative context when available', () => {
        const scenario = getScenario(ScenarioType.CUSTOM);
        const evaluator = createForkEvaluator({ rateLimiter: null });
        const prompt = (evaluator as any).buildPrompt({
            cloneParams: cautiousParameters,
            decisionNode: scenario.graph[0] as DecisionNode,
            state: scenario.initialState,
            scenario,
            masterPersona: {
                summary: '',
                behavioralFingerprint: {},
                dimensionScores: {},
                keyContradictions: [],
                dominantTraits: [],
                riskProfile: 'unknown',
                timeHorizon: 'medium',
                narrativeSummary: '',
                llmContextSummary: '## Behavioral Psychology Profile\nCareful, evidence-seeking, and highly sensitive to social pressure.',
            },
        });

        expect(prompt).toContain('Richer persona context');
        expect(prompt).toContain('Behavioral Psychology Profile');
    });

    it('deterministic custom runs emit non-trivial tradeoff metrics', async () => {
        const scenario = getScenario(ScenarioType.CUSTOM);
        const engine = new SimulationEngine(scenario, { useLLM: false, useChaos: false });
        vi.spyOn(Math, 'random').mockReturnValue(0.5);

        const result = await engine.executeClone('bench-tradeoffs', cautiousParameters, {
            percentile: 50,
            category: 'typical',
        });

        expect(result.finalState.metrics.evidenceQuality).not.toBe(0.3);
        expect(result.finalState.metrics.burnRate).not.toBe(0.15);
        expect(result.finalState.metrics.optionalityPreserved).not.toBe(1);
        expect(result.finalState.metrics.reversibility).not.toBe(0.8);
    });
});
