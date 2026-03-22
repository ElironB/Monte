import { DIMENSION_KEYS as PERSONA_DIMENSION_KEYS } from '../persona/dimensionMapper.js';

export const DIMENSION_KEYS = [...PERSONA_DIMENSION_KEYS] as readonly string[];

const dimensionDisplay = {
  riskTolerance: 'Risk Tolerance',
  timePreference: 'Time Preference',
  socialDependency: 'Social Dependency',
  learningStyle: 'Learning Style',
  decisionSpeed: 'Decision Speed',
  emotionalVolatility: 'Emotional Volatility',
  executionGap: 'Execution Gap',
  informationSeeking: 'Information Seeking',
  stressResponse: 'Stress Response',
} satisfies Record<(typeof PERSONA_DIMENSION_KEYS)[number], string>;

const dimensionLabels = {
  riskTolerance: { low: 'Low', high: 'High' },
  timePreference: { low: 'Low', high: 'High' },
  socialDependency: { low: 'Low', high: 'High' },
  learningStyle: { low: 'Experiential', high: 'Theoretical' },
  decisionSpeed: { low: 'Deliberate', high: 'Impulsive' },
  emotionalVolatility: { low: 'Stable', high: 'High' },
  executionGap: { low: 'Low Gap', high: 'High Gap' },
  informationSeeking: { low: 'Low', high: 'High' },
  stressResponse: { low: 'Steady', high: 'Reactive' },
} satisfies Record<(typeof PERSONA_DIMENSION_KEYS)[number], { low: string; high: string }>;

export const DIMENSION_DISPLAY: Record<string, string> = dimensionDisplay;
export const DIMENSION_LABELS: Record<string, { low: string; high: string }> = dimensionLabels;
