import type { AttachmentStyle } from '../persona/psychologyLayer.js';
import type { MasterPersona } from '../persona/personaCompressor.js';
import type { CloneParameters } from './types.js';

export interface SimulationPersonaRuntimeProfile {
  confidenceMean: number;
  executionReliability: number;
  informationDepth: number;
  stressFragility: number;
  savingsRate: number;
  investmentAggressiveness: number;
  careerStability: number;
  careerSkillLevel: number;
  burnoutBaseline: number;
  supportNetworkSize: number;
  relationshipSatisfaction: number;
  communityInvolvement: number;
  educationPersistence: number;
  socialPressureSensitivity: number;
  stressDiscountingAmplifier: number;
  capitulationThreshold: number;
  hasPartner: boolean;
  attachmentStyle: AttachmentStyle | 'unknown';
  riskFlags: string[];
  llmNarrativeContext?: string;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const meanConfidence = (parameters: CloneParameters): number => {
  const confidenceValues = Object.values(parameters.confidenceScores ?? {});
  if (confidenceValues.length === 0) {
    return 0.65;
  }

  return confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length;
};

const trimNarrativeContext = (text: string | undefined): string | undefined => {
  if (!text) {
    return undefined;
  }

  const normalized = text.trim();
  if (normalized.length <= 1400) {
    return normalized;
  }

  return `${normalized.slice(0, 1397)}...`;
};

export function buildSimulationPersonaRuntimeProfile(
  parameters: CloneParameters,
  masterPersona?: MasterPersona,
): SimulationPersonaRuntimeProfile {
  const confidenceMean = meanConfidence(parameters);
  const attachmentStyle = masterPersona?.psychologicalProfile?.attachment.style ?? 'unknown';
  const stressDiscountingAmplifier = parameters.psychologyModifiers?.stressDiscountingAmplifier ?? 1;
  const socialPressureSensitivity = parameters.psychologyModifiers?.socialPressureSensitivity ?? 1;
  const capitulationThreshold = parameters.psychologyModifiers?.capitulationThreshold ?? 0.5;
  const riskFlags = masterPersona?.psychologicalProfile?.riskFlags.map((flag) => flag.flag) ?? [];

  const executionReliability = clamp(
    0.88
      - parameters.executionGap * 0.55
      - parameters.decisionSpeed * 0.05
      - parameters.stressResponse * 0.08
      + (1 - parameters.timePreference) * 0.08
      + confidenceMean * 0.12,
    0.05,
    0.98,
  );

  const informationDepth = clamp(
    0.18
      + parameters.informationSeeking * 0.62
      + (1 - parameters.decisionSpeed) * 0.12
      + confidenceMean * 0.08,
    0.05,
    0.98,
  );

  const stressFragility = clamp(
    0.08
      + parameters.stressResponse * 0.48
      + parameters.emotionalVolatility * 0.28
      + (stressDiscountingAmplifier - 1) * 0.22,
    0.05,
    0.98,
  );

  const savingsRate = clamp(
    0.03
      + (1 - parameters.timePreference) * 0.07
      + executionReliability * 0.05
      - parameters.emotionalVolatility * 0.02,
    0.01,
    0.22,
  );

  const investmentAggressiveness = clamp(
    parameters.riskTolerance * 0.55
      + (1 - stressFragility) * 0.15
      + executionReliability * 0.1
      + (1 - parameters.timePreference) * 0.1
      + confidenceMean * 0.1,
    0.05,
    0.98,
  );

  const careerStability = clamp(
    0.35
      + (1 - parameters.riskTolerance) * 0.2
      + informationDepth * 0.15
      + executionReliability * 0.15
      - parameters.decisionSpeed * 0.05,
    0.2,
    0.95,
  );

  const careerSkillLevel = clamp(
    0.3
      + parameters.learningStyle * 0.18
      + informationDepth * 0.18
      + executionReliability * 0.14
      + (1 - parameters.stressResponse) * 0.08,
    0.2,
    0.98,
  );

  const burnoutBaseline = clamp(
    0.1
      + parameters.emotionalVolatility * 0.2
      + stressFragility * 0.22
      - executionReliability * 0.08,
    0.05,
    0.85,
  );

  const supportNetworkSize = Math.round(clamp(
    3
      + parameters.socialDependency * 7
      + informationDepth * 2
      + socialPressureSensitivity
      - parameters.decisionSpeed * 1.5,
    2,
    16,
  ));

  const relationshipSatisfaction = clamp(
    0.35
      + parameters.socialDependency * 0.16
      + executionReliability * 0.12
      + (1 - parameters.emotionalVolatility) * 0.14
      - stressFragility * 0.08,
    0.2,
    0.95,
  );

  const communityInvolvement = clamp(
    0.15
      + parameters.socialDependency * 0.3
      + informationDepth * 0.18
      + executionReliability * 0.08,
    0.05,
    0.95,
  );

  const educationPersistence = clamp(
    0.18
      + (1 - parameters.timePreference) * 0.22
      + executionReliability * 0.26
      + informationDepth * 0.14
      + parameters.learningStyle * 0.08
      - stressFragility * 0.12,
    0.05,
    0.98,
  );

  let hasPartner = parameters.socialDependency > 0.58 && relationshipSatisfaction > 0.55;
  if (attachmentStyle === 'secure') {
    hasPartner = hasPartner || supportNetworkSize >= 7;
  } else if (attachmentStyle === 'anxious') {
    hasPartner = parameters.socialDependency > 0.72 || hasPartner;
  } else if (attachmentStyle === 'avoidant' && parameters.socialDependency < 0.7) {
    hasPartner = false;
  }

  return {
    confidenceMean,
    executionReliability,
    informationDepth,
    stressFragility,
    savingsRate,
    investmentAggressiveness,
    careerStability,
    careerSkillLevel,
    burnoutBaseline,
    supportNetworkSize,
    relationshipSatisfaction,
    communityInvolvement,
    educationPersistence,
    socialPressureSensitivity,
    stressDiscountingAmplifier,
    capitulationThreshold,
    hasPartner,
    attachmentStyle,
    riskFlags,
    llmNarrativeContext: trimNarrativeContext(masterPersona?.llmContextSummary),
  };
}
