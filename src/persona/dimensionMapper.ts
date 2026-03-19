import { BehavioralSignal } from '../ingestion/types.js';

// 6 core behavioral dimensions for persona modeling
export interface BehavioralDimensions {
  riskTolerance: number;        // 0-1 (conservative to risk-seeking)
  timePreference: number;       // 0-1 (immediate to delayed gratification)
  socialDependency: number;     // 0-1 (independent to group-oriented)
  learningStyle: number;        // 0-1 (experiential to theoretical)
  decisionSpeed: number;        // 0-1 (deliberative to impulsive)
  emotionalVolatility: number;  // 0-1 (stable to reactive)
}

// Dimension weights for scoring
const DIMENSION_SCORING: Record<keyof BehavioralDimensions, { signals: string[]; weights: number[] }> = {
  riskTolerance: {
    signals: ['high_risk_tolerance', 'impulse_spending', 'financial_trading', 'yolo'],
    weights: [1.0, 0.6, 0.7, 0.8],
  },
  timePreference: {
    signals: ['goal_oriented', 'patient', 'urgent', 'impulse_spending'],
    weights: [0.8, -0.7, 0.8, 0.7], // negative = delayed gratification
  },
  socialDependency: {
    signals: ['high_social_engagement', 'social_pattern', 'independent'],
    weights: [0.8, 0.6, -0.9],
  },
  learningStyle: {
    signals: ['educational_content', 'learning_focused', 'experiential', 'deep_self_reflection'],
    weights: [0.7, 0.8, -0.6, 0.5],
  },
  decisionSpeed: {
    signals: ['decision_paralysis', 'impulse_spending', 'goal_oriented', 'patient'],
    weights: [-0.9, 0.9, 0.4, -0.6],
  },
  emotionalVolatility: {
    signals: ['anxiety', 'emotional_state', 'stable', 'high_risk_tolerance'],
    weights: [0.9, 0.7, -0.8, 0.4],
  },
};

export class DimensionMapper {
  private signals: BehavioralSignal[];

  constructor(signals: BehavioralSignal[]) {
    this.signals = signals;
  }

  mapToDimensions(): BehavioralDimensions {
    return {
      riskTolerance: this.calculateDimension('riskTolerance'),
      timePreference: this.calculateDimension('timePreference'),
      socialDependency: this.calculateDimension('socialDependency'),
      learningStyle: this.calculateDimension('learningStyle'),
      decisionSpeed: this.calculateDimension('decisionSpeed'),
      emotionalVolatility: this.calculateDimension('emotionalVolatility'),
    };
  }

  private calculateDimension(dimension: keyof BehavioralDimensions): number {
    const config = DIMENSION_SCORING[dimension];
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < config.signals.length; i++) {
      const signalPattern = config.signals[i];
      const weight = config.weights[i];

      // Find matching signals
      const matchingSignals = this.signals.filter(s => 
        s.value.toLowerCase().includes(signalPattern.toLowerCase()) ||
        s.type.toLowerCase().includes(signalPattern.toLowerCase())
      );

      for (const signal of matchingSignals) {
        const strength = this.getSignalStrength(signal);
        const recencyBoost = this.getRecencyBoost(signal.timestamp);
        weightedSum += strength * weight * recencyBoost;
        totalWeight += Math.abs(weight) * recencyBoost;
      }
    }

    // Normalize to 0-1 range with sigmoid-like curve
    if (totalWeight === 0) return 0.5; // Neutral if no data
    
    const rawScore = weightedSum / totalWeight;
    return this.sigmoidNormalize(rawScore);
  }

  private getSignalStrength(signal: BehavioralSignal): number {
    const base = signal.confidence;
    const frequencyBoost = (signal.dimensions.frequency || 0) * 0.3;
    const recurrenceBoost = (signal.dimensions.recurrence || 0) * 0.2;
    const trendBoost = signal.dimensions.intensityTrend === 'increasing' ? 0.1 :
                       signal.dimensions.intensityTrend === 'decreasing' ? -0.1 : 0;
    return Math.min(1, base + frequencyBoost + recurrenceBoost + trendBoost);
  }

  private getRecencyBoost(timestamp: string): number {
    const signalDate = new Date(timestamp);
    const now = new Date();
    const daysDiff = (now.getTime() - signalDate.getTime()) / (1000 * 60 * 60 * 24);
    
    // Exponential decay: 1.0 for today, 0.5 after 90 days
    return Math.max(0.3, Math.exp(-daysDiff / 60));
  }

  private sigmoidNormalize(x: number): number {
    // Map -1 to 1 range to 0 to 1 with curve
    const scaled = (x + 1) / 2; // -1..1 -> 0..1
    return Math.max(0, Math.min(1, scaled));
  }
}
