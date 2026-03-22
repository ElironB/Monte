import { TraitNode, MemoryNode } from './graphBuilder.js';

export interface DimensionScore {
  value: number;
  confidence: number;
  signalCount: number;
  sourceCount: number;
  sourceTypes: string[];
  isEstimated: boolean;
  confidenceInterval: [number, number];
}

export interface MasterPersona {
  summary: string;
  behavioralFingerprint: Record<string, number>;
  dimensionScores: Record<string, DimensionScore>;
  keyContradictions: string[];
  dominantTraits: string[];
  riskProfile: 'conservative' | 'moderate' | 'aggressive' | 'unknown';
  timeHorizon: 'immediate' | 'short' | 'medium' | 'long';
  narrativeSummary: string;
}

export class PersonaCompressor {
  private traits: TraitNode[];
  private memories: MemoryNode[];

  constructor(traits: TraitNode[], memories: MemoryNode[]) {
    this.traits = traits;
    this.memories = memories;
  }

  compress(): MasterPersona {
    const dimensions = this.extractDimensions();
    const dominantTraits = this.identifyDominantTraits();
    const contradictions = this.findInternalContradictions();
    
    return {
      summary: this.generateSummary(dimensions, dominantTraits),
      behavioralFingerprint: dimensions,
      dimensionScores: this.extractDimensionScores(),
      keyContradictions: contradictions,
      dominantTraits: dominantTraits.map(t => t.name),
      riskProfile: this.calculateRiskProfile(dimensions.riskTolerance),
      timeHorizon: this.calculateTimeHorizon(dimensions.timePreference),
      narrativeSummary: this.generateNarrative(dimensions, dominantTraits, contradictions),
    };
  }

  private extractDimensions(): Record<string, number> {
    const dimensions: Record<string, number> = {};
    
    for (const trait of this.traits) {
      if (trait.type === 'dimension') {
        dimensions[trait.name] = trait.value;
      }
    }
    
    // Ensure all 6 dimensions exist
    const requiredDimensions = [
      'riskTolerance', 'timePreference', 'socialDependency',
      'learningStyle', 'decisionSpeed', 'emotionalVolatility'
    ];
    
    for (const dim of requiredDimensions) {
      if (!(dim in dimensions)) {
        dimensions[dim] = 0.5; // Neutral default
      }
    }
    
    return dimensions;
  }

  private extractDimensionScores(): Record<string, DimensionScore> {
    const scores: Record<string, DimensionScore> = {};
    for (const trait of this.traits) {
      if (trait.type === 'dimension') {
        // Will parse from trait or fallback if not available
        scores[trait.name] = {
          value: trait.value,
          confidence: trait.confidence,
          signalCount: trait['signalCount'] as number ?? 1,
          sourceCount: trait['sourceCount'] as number ?? 1,
          sourceTypes: trait['sourceTypes'] as string[] ?? [],
          isEstimated: trait['isEstimated'] as boolean ?? true,
          confidenceInterval: trait['confidenceInterval'] as [number, number] ?? [0, 1]
        };
      }
    }
    return scores;
  }

  private identifyDominantTraits(): TraitNode[] {
    // Traits with extreme values (outside 0.3-0.7 range) and high confidence
    return this.traits
      .filter(t => (t.value < 0.3 || t.value > 0.7) && t.confidence > 0.6)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  private findInternalContradictions(): string[] {
    const contradictions: string[] = [];
    const dims = this.extractDimensions();
    
    // Risk tolerance vs emotional volatility
    if (dims.riskTolerance > 0.7 && dims.emotionalVolatility > 0.7) {
      contradictions.push('High risk tolerance but emotionally volatile - prone to panic decisions');
    }
    
    // Goal-oriented but impulsive
    if (dims.timePreference < 0.3 && dims.decisionSpeed > 0.7) {
      contradictions.push('Claims patience but acts impulsively - execution gap');
    }
    
    // Independent but socially dependent
    if (dims.socialDependency < 0.3 && this.hasSocialMemories()) {
      contradictions.push('Self-identifies as independent but relies heavily on social input');
    }
    
    return contradictions;
  }

  private calculateRiskProfile(riskTolerance: number): MasterPersona['riskProfile'] {
    if (riskTolerance > 0.7) return 'aggressive';
    if (riskTolerance > 0.4) return 'moderate';
    if (riskTolerance > 0) return 'conservative';
    return 'unknown';
  }

  private calculateTimeHorizon(timePreference: number): MasterPersona['timeHorizon'] {
    if (timePreference > 0.7) return 'immediate';
    if (timePreference > 0.5) return 'short';
    if (timePreference > 0.3) return 'medium';
    return 'long';
  }

  private hasSocialMemories(): boolean {
    return this.memories.some(m => 
      m.type === 'social' || 
      m.content.toLowerCase().includes('friend') ||
      m.content.toLowerCase().includes('family')
    );
  }

  private generateSummary(dimensions: Record<string, number>, dominantTraits: TraitNode[]): string {
    const parts: string[] = [];
    
    // Risk profile
    const risk = this.calculateRiskProfile(dimensions.riskTolerance);
    parts.push(`${risk} risk tolerance`);
    
    // Decision style
    if (dimensions.decisionSpeed > 0.6) {
      parts.push('decisive to impulsive');
    } else if (dimensions.decisionSpeed < 0.4) {
      parts.push('deliberative and analytical');
    }
    
    // Social orientation
    if (dimensions.socialDependency > 0.6) {
      parts.push('socially oriented');
    } else if (dimensions.socialDependency < 0.4) {
      parts.push('independent thinker');
    }
    
    return parts.join(', ');
  }

  private generateNarrative(
    dimensions: Record<string, number>, 
    dominantTraits: TraitNode[],
    contradictions: string[]
  ): string {
    const lines: string[] = [];
    
    // Opening: Core identity
    const riskDesc = this.calculateRiskProfile(dimensions.riskTolerance);
    const timeDesc = this.calculateTimeHorizon(dimensions.timePreference);
    lines.push(`This persona exhibits ${riskDesc} risk tolerance with a ${timeDesc} time horizon.`);
    
    // Behavioral style
    const decisionDesc = dimensions.decisionSpeed > 0.5 ? 'makes decisions quickly' : 'takes time to analyze before deciding';
    const learningDesc = dimensions.learningStyle > 0.5 ? 'prefers theoretical understanding' : 'learns best through experience';
    lines.push(`They ${decisionDesc} and ${learningDesc}.`);
    
    // Social dynamics
    if (dimensions.socialDependency > 0.6) {
      lines.push('Social validation plays a significant role in their choices.');
    } else if (dimensions.socialDependency < 0.4) {
      lines.push('They tend to make decisions independently of social pressure.');
    }
    
    // Emotional patterns
    if (dimensions.emotionalVolatility > 0.6) {
      lines.push('Emotional reactivity may impact decision quality under stress.');
    }
    
    // Contradictions (the interesting part)
    if (contradictions.length > 0) {
      lines.push('\nKey tension points:');
      for (const contradiction of contradictions.slice(0, 3)) {
        lines.push(`- ${contradiction}`);
      }
    }
    
    // Dominant traits
    if (dominantTraits.length > 0) {
      lines.push(`\nDominant characteristics: ${dominantTraits.map(t => t.name).join(', ')}.`);
    }
    
    return lines.join(' ');
  }
}
