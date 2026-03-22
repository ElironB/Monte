// Social World Agent - Network effects, relationship dynamics, relocation social costs
// Models social capital and relationship impacts on decisions

import { BaseWorldAgent } from './base.js';
import { CloneExecutionContext, WorldEvent, OutcomeEffect } from '../types.js';
import type { SimulationPersonaRuntimeProfile } from '../personaRuntime.js';

interface SocialState {
  relationshipSatisfaction: number; // 0-1
  supportNetworkSize: number;
  socialCapital: number; // 0-1 aggregated
  lonelinessLevel: number; // 0-1
  socialDisruption: number; // 0-1 from recent changes
  communityInvolvement: number; // 0-1
  relocationStress: number; // 0-1
  lastMoveMonths: number;
}

interface Relationship {
  type: 'family' | 'friend' | 'colleague' | 'mentor' | 'partner';
  strength: number; // 0-1
  proximity: 'local' | 'regional' | 'distant';
  supportValue: number;
}

export class SocialWorldAgent extends BaseWorldAgent {
  type = 'social';
  private personaProfile?: SimulationPersonaRuntimeProfile;
  
  private state: SocialState = {
    relationshipSatisfaction: 0.6,
    supportNetworkSize: 8,
    socialCapital: 0.5,
    lonelinessLevel: 0.3,
    socialDisruption: 0,
    communityInvolvement: 0.4,
    relocationStress: 0,
    lastMoveMonths: 999,
  };

  private relationships: Relationship[] = [];

  // Initialize with social starting conditions
  initialize(
    networkSize: number = 8,
    satisfaction: number = 0.6,
    hasPartner: boolean = false,
    personaProfile?: SimulationPersonaRuntimeProfile,
  ): void {
    this.personaProfile = personaProfile;
    this.state.relationshipSatisfaction = satisfaction;
    this.state.supportNetworkSize = networkSize;
    this.state.lonelinessLevel = networkSize < 5
      ? 0.5 + ((personaProfile?.attachmentStyle === 'anxious' ? 0.1 : 0))
      : 0.2;
    this.state.socialDisruption = 0;
    this.state.communityInvolvement = personaProfile?.communityInvolvement ?? 0.4;
    this.state.relocationStress = 0;
    this.state.lastMoveMonths = 999;
    
    // Generate initial relationships
    this.relationships = this.generateRelationships(networkSize, hasPartner);
    this.state.socialCapital = this.calculateSocialCapital();
  }

  // Advance simulation by months
  advanceTime(months: number): void {
    for (let i = 0; i < months; i++) {
      this.simulateMonth();
    }
  }

  // Simulate one month of social dynamics
  private simulateMonth(): void {
    const persona = this.personaProfile;
    this.state.lastMoveMonths++;
    
    // Social disruption decays over time
    this.state.socialDisruption = Math.max(0, this.state.socialDisruption - 0.02);
    
    // Relocation stress decays over time (adjustment period)
    if (this.state.lastMoveMonths < 12) {
      this.state.relocationStress = Math.max(0, 
        this.state.relocationStress - (0.05 / 12)
      );
    }
    
    // Loneliness dynamics
    if (this.state.supportNetworkSize < 3) {
      this.state.lonelinessLevel = Math.min(1, this.state.lonelinessLevel + 0.01);
    } else {
      this.state.lonelinessLevel = Math.max(
        0,
        this.state.lonelinessLevel - (0.005 + ((persona?.communityInvolvement ?? 0.4) * 0.004)),
      );
    }
    
    // Relationship satisfaction fluctuates
    this.state.relationshipSatisfaction = Math.max(0.2, Math.min(1,
      this.state.relationshipSatisfaction
        + ((Math.random() - 0.5) * 0.02 * (persona?.socialPressureSensitivity ?? 1))
        + (((persona ? (1 - persona.stressFragility) : 0.5) - 0.5) * 0.02)
    ));
    this.state.communityInvolvement = Math.max(
      0,
      Math.min(1, this.state.communityInvolvement + (((persona?.informationDepth ?? 0.5) - 0.5) * 0.02)),
    );
    
    // Update social capital
    this.state.socialCapital = this.calculateSocialCapital();
  }

  // Evaluate context and return social world event
  evaluate(context: CloneExecutionContext): WorldEvent | null {
    const { state, parameters } = context;
    const events: WorldEvent[] = [];
    const persona = this.personaProfile;
    
    // Relationship strain (especially after relocation)
    let relationshipStrainProbability = 0.15;
    if (this.state.relocationStress > 0.4) {
      relationshipStrainProbability *= persona?.socialPressureSensitivity ?? 1;
      if (persona?.attachmentStyle === 'anxious' || persona?.attachmentStyle === 'disorganized') {
        relationshipStrainProbability *= 1.15;
      }
    }
    if (this.state.relocationStress > 0.4 && this.roll(Math.min(1, relationshipStrainProbability))) {
      events.push(this.createEvent(
        'relationship_strain',
        'Relationships strained by distance/lifestyle changes',
        [
          { target: 'happiness', delta: -0.15, type: 'absolute' },
          { target: 'metrics.socialDisruption', delta: 0.2, type: 'absolute' },
          { target: 'health', delta: -0.05, type: 'absolute' },
        ],
        Math.min(1, relationshipStrainProbability)
      ));
    }
    
    // Loneliness impact (high social dependency + low network)
    if (this.state.lonelinessLevel > 0.6 && parameters.socialDependency > 0.6) {
      const lonelinessImpactProbability = this.applyBehavioralModifiers(
        0.2,
        context,
        [
          { trait: 'socialDependency', threshold: 0.7, factor: 1.5 },
          { trait: 'emotionalVolatility', threshold: 0.6, factor: 1.3 },
        ]
      );
      
      if (this.roll(lonelinessImpactProbability)) {
        events.push(this.createEvent(
          'loneliness_crisis',
          'Isolation affecting mental health and motivation',
          [
            { target: 'health', delta: -0.15, type: 'absolute' },
            { target: 'happiness', delta: -0.25, type: 'absolute' },
            { target: 'metrics.confidenceLevel', delta: -0.15, type: 'absolute' },
            { target: 'metrics.stressLevel', delta: 0.2, type: 'absolute' },
          ],
          lonelinessImpactProbability
        ));
      }
    }
    
    // New connection opportunity
    let connectionProbability = this.applyBehavioralModifiers(
      0.1,
      context,
      [
        { trait: 'socialDependency', threshold: 0.6, factor: 1.6 },
        { trait: 'decisionSpeed', threshold: 0.6, factor: 1.2 }, // Fast decision makers more social
        { trait: 'informationSeeking', threshold: 0.65, factor: 1.2 },
        { trait: 'stressResponse', threshold: 0.4, factor: 1.1, direction: 'below' },
      ]
    );
    connectionProbability = Math.min(1, connectionProbability * (0.8 + (this.state.communityInvolvement * 0.4)));
    
    if (this.roll(connectionProbability)) {
      this.state.supportNetworkSize++;
      events.push(this.createEvent(
        'new_connection',
        'New meaningful relationship formed',
        [
          { target: 'happiness', delta: 0.15, type: 'absolute' },
          { target: 'metrics.networkStrength', delta: 0.1, type: 'absolute' },
          { target: 'metrics.opportunityAccess', delta: 0.08, type: 'absolute' },
        ],
        connectionProbability
      ));
    }
    
    // Support network activation (crisis support)
    if (state.capital < 10000 || state.health < 0.5) {
      const supportProbability = Math.min(
        0.6,
        this.state.socialCapital * 0.6 * (persona?.socialPressureSensitivity ?? 1),
      );
      
      if (this.roll(supportProbability)) {
        events.push(this.createEvent(
          'social_support',
          'Support network provides assistance during difficult time',
          [
            { target: 'happiness', delta: 0.2, type: 'absolute' },
            { target: 'health', delta: 0.08, type: 'absolute' },
            { target: 'capital', delta: 2000, type: 'absolute' }, // Borrow/gift
          ],
          supportProbability
        ));
      }
    }
    
    // Partnership milestone
    if (this.relationships.some(r => r.type === 'partner') && 
        this.state.relationshipSatisfaction > 0.8 && 
        this.roll(Math.min(
          0.08,
          0.03 * (persona?.attachmentStyle === 'secure' ? 1.4 : 1) * (0.8 + ((persona ? (1 - persona.stressFragility) : 0.5) * 0.4)),
        ))) {
      events.push(this.createEvent(
        'relationship_milestone',
        'Relationship deepening - major commitment',
        [
          { target: 'happiness', delta: 0.25, type: 'absolute' },
          { target: 'health', delta: 0.1, type: 'absolute' },
          { target: 'metrics.stressLevel', delta: -0.15, type: 'absolute' },
        ],
        0.03
      ));
    }
    
    // Return most significant event or null
    if (events.length === 0) return null;
    
    return events.sort((a, b) => {
      const impactA = Math.abs(a.impact.reduce((sum, e) => sum + e.delta, 0));
      const impactB = Math.abs(b.impact.reduce((sum, e) => sum + e.delta, 0));
      return impactB - impactA;
    })[0];
  }

  // Trigger relocation effects
  triggerRelocation(distance: 'local' | 'regional' | 'national' | 'international'): void {
    this.state.lastMoveMonths = 0;
    this.state.relocationStress = distance === 'international' ? 0.8 : 
                                   distance === 'national' ? 0.6 : 
                                   distance === 'regional' ? 0.4 : 0.2;
    
    // Reduce local relationships
    const localRelationships = this.relationships.filter(r => r.proximity === 'local');
    const lostConnections = Math.floor(localRelationships.length * 
      (distance === 'international' ? 0.7 : 
       distance === 'national' ? 0.5 : 
       distance === 'regional' ? 0.3 : 0.1));
    
    this.state.supportNetworkSize = Math.max(2, this.state.supportNetworkSize - lostConnections);
    this.state.socialDisruption = Math.min(1, this.state.relocationStress + 0.2);
    
    // Update relationship proximities
    this.relationships = this.relationships.map(r => ({
      ...r,
      proximity: r.proximity === 'local' ? 'distant' : r.proximity
    }));
  }

  // Calculate social capital score
  private calculateSocialCapital(): number {
    const totalSupport = this.relationships.reduce((sum, r) => 
      sum + r.strength * r.supportValue, 0
    );
    return Math.min(1, totalSupport / 10);
  }

  // Generate random relationships
  private generateRelationships(count: number, hasPartner: boolean): Relationship[] {
    const relationships: Relationship[] = [];
    
    if (hasPartner) {
      relationships.push({
        type: 'partner',
        strength: this.randomRange(0.6, 0.95),
        proximity: 'local',
        supportValue: 0.9,
      });
    }
    
    const familyCount = Math.floor(count * 0.3);
    const friendCount = Math.floor(count * 0.5);
    const colleagueCount = Math.floor(count * 0.15);
    const mentorCount = Math.floor(count * 0.05);
    
    for (let i = 0; i < familyCount; i++) {
      relationships.push({
        type: 'family',
        strength: this.randomRange(0.5, 0.9),
        proximity: Math.random() > 0.7 ? 'distant' : 'local',
        supportValue: 0.7,
      });
    }
    
    for (let i = 0; i < friendCount; i++) {
      relationships.push({
        type: 'friend',
        strength: this.randomRange(0.3, 0.8),
        proximity: 'local',
        supportValue: 0.5,
      });
    }
    
    for (let i = 0; i < colleagueCount; i++) {
      relationships.push({
        type: 'colleague',
        strength: this.randomRange(0.3, 0.7),
        proximity: 'local',
        supportValue: 0.4,
      });
    }
    
    for (let i = 0; i < mentorCount; i++) {
      relationships.push({
        type: 'mentor',
        strength: this.randomRange(0.5, 0.9),
        proximity: Math.random() > 0.5 ? 'regional' : 'local',
        supportValue: 0.8,
      });
    }
    
    return relationships;
  }

  // Get current social snapshot
  getSnapshot(): {
    relationshipSatisfaction: number;
    supportNetworkSize: number;
    socialCapital: number;
    socialDisruption: number;
    lonelinessLevel: number;
    relocationStress: number;
    monthsSinceMove: number;
  } {
    return {
      relationshipSatisfaction: this.state.relationshipSatisfaction,
      supportNetworkSize: this.state.supportNetworkSize,
      socialCapital: this.state.socialCapital,
      socialDisruption: this.state.socialDisruption,
      lonelinessLevel: this.state.lonelinessLevel,
      relocationStress: this.state.relocationStress,
      monthsSinceMove: this.state.lastMoveMonths,
    };
  }

  // Override reset
  reset(): void {
    super.reset();
    this.state = {
      relationshipSatisfaction: 0.6,
      supportNetworkSize: 8,
      socialCapital: 0.5,
      lonelinessLevel: 0.3,
      socialDisruption: 0,
      communityInvolvement: 0.4,
      relocationStress: 0,
      lastMoveMonths: 999,
    };
    this.relationships = [];
  }
}

// Export factory function
export function createSocialAgent(
  networkSize?: number,
  satisfaction?: number,
  hasPartner?: boolean
): SocialWorldAgent {
  const agent = new SocialWorldAgent();
  agent.initialize(networkSize, satisfaction, hasPartner);
  return agent;
}

// Relocation helper
export function calculateRelocationImpact(
  distance: 'local' | 'regional' | 'national' | 'international',
  socialDependency: number
): {
  happinessImpact: number;
  networkReduction: number;
  adjustmentPeriod: number; // months
} {
  const distanceMultiplier = {
    local: 0.2,
    regional: 0.5,
    national: 0.8,
    international: 1.0,
  };
  
  const multiplier = distanceMultiplier[distance];
  
  return {
    happinessImpact: -0.2 * multiplier * socialDependency,
    networkReduction: 0.3 * multiplier,
    adjustmentPeriod: Math.round(6 + 12 * multiplier),
  };
}

// Calculate social adjustment after relocation
export function calculateSocialAdjustment(
  monthsSinceMove: number,
  socialDependency: number,
  decisionSpeed: number
): number {
  // Faster adjustment for high decision speed (adaptability)
  const adaptabilityFactor = 0.5 + (decisionSpeed * 0.5);
  
  // Social dependency makes adjustment harder but also drives reconnection
  const baseRate = 0.03 * adaptabilityFactor;
  const progress = Math.min(1, monthsSinceMove * baseRate);
  
  return progress;
}

// Network value calculation
export function calculateNetworkValue(
  networkSize: number,
  averageStrength: number,
  diversity: number // 0-1 variety of relationship types
): number {
  return networkSize * averageStrength * (1 + diversity * 0.3) / 10;
}

// Social isolation risk
export function calculateIsolationRisk(
  networkSize: number,
  socialDependency: number,
  relocationStress: number
): number {
  if (networkSize > 10) return 0;
  
  const baseRisk = Math.max(0, 1 - networkSize / 10);
  const dependencyFactor = socialDependency;
  const stressFactor = relocationStress;
  
  return Math.min(1, baseRisk * dependencyFactor * (1 + stressFactor));
}

// Export type for use in other modules
export type { SocialState, Relationship };
