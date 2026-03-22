import { MasterPersona, DimensionScore } from './personaCompressor.js';
import { v4 as uuidv4 } from 'uuid';
import { SignalContradiction } from '../ingestion/types.js';
import { PsychologicalProfile } from './psychologyLayer.js';

export interface Clone {
  id: string;
  personaId: string;
  parameters: CloneParameters;
  stratification: {
    percentile: number; // 0-100, which percentile this represents
    category: 'edge' | 'central' | 'typical';
  };
}

export interface CloneParameters {
  riskTolerance: number;
  timePreference: number;
  socialDependency: number;
  learningStyle: number;
  decisionSpeed: number;
  emotionalVolatility: number;
  executionGap: number;
  informationSeeking: number;
  stressResponse: number;
  // Derived from master persona but with variance
  confidenceScores?: Record<string, number>;
  /** Psychology-derived modifiers applied to this clone variant */
  psychologyModifiers?: {
    /** Multiplier on discounting rate under stress events (1.0 = no modification) */
    stressDiscountingAmplifier?: number;
    /** How much social context shifts this clone's fork choices vs average (1.0 = baseline) */
    socialPressureSensitivity?: number;
    /** Adversity level at which this clone capitulates (0=exits immediately, 1=holds through anything) */
    capitulationThreshold?: number;
  };
}

export class CloneGenerator {
  private masterPersona: MasterPersona;
  private personaId: string;
  private baseFingerprint: Record<string, number>;
  private dimensionScores: Record<string, DimensionScore>;
  private contradictions: SignalContradiction[];
  private psychProfile: PsychologicalProfile | null;

  constructor(
    masterPersona: MasterPersona,
    personaId: string,
    contradictions?: SignalContradiction[],
    psychProfile?: PsychologicalProfile
  ) {
    this.masterPersona = masterPersona;
    this.personaId = personaId;
    this.baseFingerprint = masterPersona.behavioralFingerprint;
    this.dimensionScores = masterPersona.dimensionScores || {};
    this.contradictions = contradictions ?? [];
    this.psychProfile = psychProfile ?? masterPersona.psychologicalProfile ?? null;
  }

  generateClones(count: number = 1000): Clone[] {
    const clones: Clone[] = [];
    
    // Stratified sampling strategy:
    // - 10% edge cases (5th and 95th percentiles)
    // - 20% outliers (10th and 90th percentiles)  
    // - 70% typical distribution (20th-80th percentiles)
    
    const edgeCount = Math.floor(count * 0.1);    // 100 clones
    const outlierCount = Math.floor(count * 0.2); // 200 clones
    const typicalCount = count - edgeCount - outlierCount; // 700 clones
    
    // Generate edge cases
    for (let i = 0; i < edgeCount / 2; i++) {
      clones.push(this.createClone(5, 'edge'));   // 5th percentile
    }
    for (let i = 0; i < edgeCount / 2; i++) {
      clones.push(this.createClone(95, 'edge'));  // 95th percentile
    }
    
    // Generate outliers
    for (let i = 0; i < outlierCount / 2; i++) {
      clones.push(this.createClone(10, 'central'));  // 10th percentile
    }
    for (let i = 0; i < outlierCount / 2; i++) {
      clones.push(this.createClone(90, 'central'));  // 90th percentile
    }
    
    // Generate typical distribution
    for (let i = 0; i < typicalCount; i++) {
      // Random percentile between 20-80
      const percentile = 20 + Math.random() * 60;
      clones.push(this.createClone(percentile, 'typical'));
    }
    
    // Shuffle to avoid bias in simulation order
    const shuffled = this.shuffleArray(clones);

    // Apply psychology-aware modifiers BEFORE returning
    if (this.psychProfile) {
      this.applyPsychologyModifiers(shuffled, this.psychProfile);
    }

    return shuffled;
  }

  private createClone(percentile: number, category: Clone['stratification']['category']): Clone {
    // Convert percentile to z-score approximation
    // 50th = 0, 5th = -1.645, 95th = 1.645
    const zScore = this.percentileToZScore(percentile / 100);
    
    // Apply variance to each dimension based on master persona's DimensionScore
    const parameters: CloneParameters = {
      riskTolerance: this.sampleDimension('riskTolerance', zScore),
      timePreference: this.sampleDimension('timePreference', zScore),
      socialDependency: this.sampleDimension('socialDependency', zScore),
      learningStyle: this.sampleDimension('learningStyle', zScore),
      decisionSpeed: this.sampleDimension('decisionSpeed', zScore),
      emotionalVolatility: this.sampleDimension('emotionalVolatility', zScore),
      executionGap: this.sampleDimension('executionGap', zScore),
      informationSeeking: this.sampleDimension('informationSeeking', zScore),
      stressResponse: this.sampleDimension('stressResponse', zScore),
      confidenceScores: Object.fromEntries(
        Object.entries(this.dimensionScores).map(([k, v]) => [k, v.confidence])
      )
    };
    
    // Apply internal consistency checks
    this.enforceConsistency(parameters);
    
    return {
      id: uuidv4(),
      personaId: this.personaId,
      parameters,
      stratification: {
        percentile: Math.round(percentile),
        category,
      },
    };
  }

  private sampleDimension(
    dimension: keyof CloneParameters,
    zScore: number
  ): number {
    const baseValue = this.baseFingerprint[dimension] ?? 0.5;
    const score = this.dimensionScores[dimension as string];
    
    let variance = 0.15;
    if (score) {
      if (score.isEstimated) {
        variance = 0.30;
      } else {
        variance = 0.15 * (1 - score.confidence + 0.5);
      }
    }
    
    // Lock variance if this dimension is part of a permanent trait contradiction
    const isPermanent = this.contradictions.some(c => c.isPermanentTrait && c.affectedDimensions.includes(dimension));
    if (isPermanent) {
      return baseValue;
    }

    // Increase variance if there's a negative convergenceRate (gap shrinking or user specified)
    const hasNegativeConvergence = this.contradictions.some(c => (c.convergenceRate ?? 0) < 0 && c.affectedDimensions.includes(dimension));
    const adjustedVariance = hasNegativeConvergence ? variance * 1.5 : variance;

    // Apply z-score scaled by variance
    // Ensure we don't go outside 0-1 bounds
    const adjusted = baseValue + (zScore * adjustedVariance);
    return Math.max(0, Math.min(1, adjusted));
  }

  private enforceConsistency(params: CloneParameters): void {
    // If risk tolerance is very high, emotional volatility can't be very low
    // (risk-takers tend to be more emotionally driven)
    if (params.riskTolerance > 0.8 && params.emotionalVolatility < 0.3) {
      params.emotionalVolatility = 0.3 + (Math.random() * 0.3);
    }
    
    // If decision speed is very fast, can't also be very patient
    if (params.decisionSpeed > 0.8 && params.timePreference < 0.2) {
      params.timePreference = 0.2 + (Math.random() * 0.3);
    }
    
    // High social dependency usually means lower independent decision speed
    if (params.socialDependency > 0.8 && params.decisionSpeed > 0.7) {
      params.decisionSpeed = 0.5 + (Math.random() * 0.3);
    }
  }

  private percentileToZScore(p: number): number {
    // Approximation of inverse normal CDF
    // p should be 0-1
    if (p <= 0) return -3;
    if (p >= 1) return 3;
    
    // Simple approximation
    // 0.5 -> 0, 0.05 -> -1.645, 0.95 -> 1.645
    const q = p - 0.5;
    const sign = q < 0 ? -1 : 1;
    const r = Math.abs(q);
    
    // Rough approximation for middle range
    if (r < 0.42) {
      return q * 2.5;
    }
    
    // Tail approximation
    return sign * (1.5 + r * 2);
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Applies psychology-derived modifiers across targeted clone subsets.
   * - execution_overconfidence flag → 20% of clones get amplified executionGap
   * - hyperbolic_severe discounting → 20% of clones get stressDiscountingAmplifier=1.4
   * - anxious attachment → 30% of clones get socialDependency += 0.15 + sensitivity boost
   */
  private applyPsychologyModifiers(clones: Clone[], psych: PsychologicalProfile): void {
    const { riskFlags, attachment, temporalDiscounting } = psych;

    const hasOverconfidence = riskFlags.some(f => f.flag === 'execution_overconfidence');
    const hasHyperbolicSevere = temporalDiscounting.discountingRate === 'hyperbolic_severe';
    const hasAnxiousAttachment = attachment.style === 'anxious';

    const pool20 = Math.floor(clones.length * 0.20);
    const pool30 = Math.floor(clones.length * 0.30);

    let overconfidenceApplied = 0;
    let stressApplied = 0;
    let anxiousApplied = 0;

    for (const clone of clones) {
      // Initialise modifiers object with baseline values
      clone.parameters.psychologyModifiers = {
        stressDiscountingAmplifier: 1.0,
        socialPressureSensitivity: 1.0,
        capitulationThreshold: 0.5,
      };

      if (hasOverconfidence && overconfidenceApplied < pool20) {
        clone.parameters.executionGap = Math.min(1, clone.parameters.executionGap + 0.2);
        overconfidenceApplied++;
      }

      if (hasHyperbolicSevere && stressApplied < pool20) {
        clone.parameters.psychologyModifiers.stressDiscountingAmplifier = 1.4;
        clone.parameters.psychologyModifiers.capitulationThreshold = 0.35;
        stressApplied++;
      }

      if (hasAnxiousAttachment && anxiousApplied < pool30) {
        clone.parameters.socialDependency = Math.min(1, clone.parameters.socialDependency + 0.15);
        clone.parameters.psychologyModifiers.socialPressureSensitivity = 1.25;
        anxiousApplied++;
      }
    }
  }
}
