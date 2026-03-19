import { MasterPersona } from './personaCompressor.js';
import { v4 as uuidv4 } from 'uuid';

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
  // Derived from master persona but with variance
}

export class CloneGenerator {
  private masterPersona: MasterPersona;
  private personaId: string;
  private baseFingerprint: Record<string, number>;

  constructor(masterPersona: MasterPersona, personaId: string) {
    this.masterPersona = masterPersona;
    this.personaId = personaId;
    this.baseFingerprint = masterPersona.behavioralFingerprint;
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
      clones.push(this.createClone(10, 'edge'));  // 10th percentile
    }
    for (let i = 0; i < outlierCount / 2; i++) {
      clones.push(this.createClone(90, 'edge'));  // 90th percentile
    }
    
    // Generate typical distribution
    for (let i = 0; i < typicalCount; i++) {
      // Random percentile between 20-80
      const percentile = 20 + Math.random() * 60;
      clones.push(this.createClone(percentile, 'typical'));
    }
    
    // Shuffle to avoid bias in simulation order
    return this.shuffleArray(clones);
  }

  private createClone(percentile: number, category: Clone['stratification']['category']): Clone {
    // Convert percentile to z-score approximation
    // 50th = 0, 5th = -1.645, 95th = 1.645
    const zScore = this.percentileToZScore(percentile / 100);
    
    // Apply variance to each dimension based on master persona
    const variance = 0.15; // 15% standard deviation
    
    const parameters: CloneParameters = {
      riskTolerance: this.sampleDimension('riskTolerance', zScore, variance),
      timePreference: this.sampleDimension('timePreference', zScore, variance),
      socialDependency: this.sampleDimension('socialDependency', zScore, variance),
      learningStyle: this.sampleDimension('learningStyle', zScore, variance),
      decisionSpeed: this.sampleDimension('decisionSpeed', zScore, variance),
      emotionalVolatility: this.sampleDimension('emotionalVolatility', zScore, variance),
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
    zScore: number,
    variance: number
  ): number {
    const baseValue = this.baseFingerprint[dimension] ?? 0.5;
    
    // Apply z-score scaled by variance
    // Ensure we don't go outside 0-1 bounds
    const adjusted = baseValue + (zScore * variance);
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
}
