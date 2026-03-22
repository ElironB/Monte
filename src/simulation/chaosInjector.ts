// Chaos Injector - Black swan events for Monte Carlo simulation
// Medical emergencies, market crashes, job loss, relationship changes, natural disasters
// Low probability, high impact events that stress-test decision robustness

import { 
  ChaosEvent, 
  CloneExecutionContext, 
  CloneParameters 
} from './types.js';
import { logger } from '../utils/logger.js';
import { applyEffectsToState } from './state.js';
import { applyExternalCausalTransition } from './causalModel.js';

// Chaos event definitions with base probabilities
const CHAOS_EVENTS: ChaosEvent[] = [
  {
    id: 'medical_emergency',
    type: 'medical',
    name: 'Medical Emergency',
    description: 'Unexpected health crisis requiring significant time and money',
    baseProbability: 0.008, // ~1% annual chance
    impact: [
      { target: 'health', delta: -0.3, type: 'absolute' },
      { target: 'capital', delta: -15000, type: 'absolute' },
      { target: 'happiness', delta: -0.2, type: 'absolute' },
      { target: 'metrics.stressLevel', delta: 0.4, type: 'absolute' },
    ],
    conditions: ['health > 0.3'], // Only if not already critically ill
  },
  {
    id: 'serious_illness',
    type: 'medical',
    name: 'Serious Illness',
    description: 'Extended illness affecting ability to work/function',
    baseProbability: 0.005,
    impact: [
      { target: 'health', delta: -0.4, type: 'absolute' },
      { target: 'capital', delta: -25000, type: 'absolute' },
      { target: 'happiness', delta: -0.3, type: 'absolute' },
      { target: 'metrics.careerAdvancement', delta: -0.3, type: 'absolute' },
    ],
  },
  {
    id: 'market_crash_personal',
    type: 'market_crash',
    name: 'Market Crash',
    description: 'Major market downturn destroying significant wealth',
    baseProbability: 0.012, // Historical ~12% chance of 20%+ drawdown per year
    impact: [
      { target: 'capital', delta: -0.35, type: 'percentage' },
      { target: 'happiness', delta: -0.25, type: 'absolute' },
      { target: 'metrics.stressLevel', delta: 0.5, type: 'absolute' },
    ],
    conditions: ['capital > 20000'], // Only affects those with investments
  },
  {
    id: 'company_collapse',
    type: 'job_loss',
    name: 'Company Collapse',
    description: 'Employer goes bankrupt, immediate job loss',
    baseProbability: 0.015,
    impact: [
      { target: 'capital', delta: -8000, type: 'absolute' },
      { target: 'happiness', delta: -0.2, type: 'absolute' },
      { target: 'metrics.stressLevel', delta: 0.35, type: 'absolute' },
      { target: 'metrics.confidenceLevel', delta: -0.15, type: 'absolute' },
    ],
  },
  {
    id: 'layoff_economic',
    type: 'job_loss',
    name: 'Economic Layoff',
    description: 'Mass layoffs due to economic downturn',
    baseProbability: 0.02,
    impact: [
      { target: 'capital', delta: -5000, type: 'absolute' },
      { target: 'happiness', delta: -0.15, type: 'absolute' },
      { target: 'metrics.stressLevel', delta: 0.3, type: 'absolute' },
    ],
  },
  {
    id: 'relationship_end',
    type: 'relationship',
    name: 'Relationship End',
    description: 'Divorce or serious breakup with financial and emotional costs',
    baseProbability: 0.015, // ~1.5% annual divorce rate for married
    impact: [
      { target: 'capital', delta: -30000, type: 'absolute' },
      { target: 'happiness', delta: -0.4, type: 'absolute' },
      { target: 'health', delta: -0.15, type: 'absolute' },
      { target: 'metrics.stressLevel', delta: 0.5, type: 'absolute' },
    ],
    conditions: ['metrics.relationshipSatisfaction < 0.7'], // Higher risk if already strained
  },
  {
    id: 'family_crisis',
    type: 'relationship',
    name: 'Family Crisis',
    description: 'Family member needs significant support',
    baseProbability: 0.025,
    impact: [
      { target: 'capital', delta: -10000, type: 'absolute' },
      { target: 'happiness', delta: -0.2, type: 'absolute' },
      { target: 'health', delta: -0.1, type: 'absolute' },
    ],
  },
  {
    id: 'natural_disaster',
    type: 'natural_disaster',
    name: 'Natural Disaster',
    description: 'Fire, flood, earthquake, or other disaster',
    baseProbability: 0.003,
    impact: [
      { target: 'capital', delta: -50000, type: 'absolute' },
      { target: 'health', delta: -0.1, type: 'absolute' },
      { target: 'happiness', delta: -0.3, type: 'absolute' },
      { target: 'metrics.stressLevel', delta: 0.6, type: 'absolute' },
    ],
  },
  {
    id: 'identity_theft',
    type: 'natural_disaster',
    name: 'Identity Theft',
    description: 'Financial fraud requiring recovery',
    baseProbability: 0.006,
    impact: [
      { target: 'capital', delta: -8000, type: 'absolute' },
      { target: 'happiness', delta: -0.15, type: 'absolute' },
      { target: 'metrics.stressLevel', delta: 0.3, type: 'absolute' },
    ],
  },
  {
    id: 'legal_trouble',
    type: 'natural_disaster',
    name: 'Legal Trouble',
    description: 'Unexpected lawsuit or legal issue',
    baseProbability: 0.004,
    impact: [
      { target: 'capital', delta: -20000, type: 'absolute' },
      { target: 'happiness', delta: -0.25, type: 'absolute' },
      { target: 'metrics.stressLevel', delta: 0.4, type: 'absolute' },
    ],
  },
];

interface ChaosResult {
  event: ChaosEvent | null;
  occurred: boolean;
  modifiedProbability: number;
}

export class ChaosInjector {
  private enabled: boolean = true;
  private maxEventsPerSimulation: number = 2;
  private eventHistory: Set<string> = new Set();

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  // Check for chaos events given current context
  inject(context: CloneExecutionContext): ChaosResult {
    if (!this.enabled) {
      return { event: null, occurred: false, modifiedProbability: 0 };
    }

    // Check if we've hit the max events already
    if (this.eventHistory.size >= this.maxEventsPerSimulation) {
      return { event: null, occurred: false, modifiedProbability: 0 };
    }

    const { state, parameters, path } = context;

    // Get eligible events
    const eligibleEvents = this.getEligibleEvents(state, parameters, path);
    
    if (eligibleEvents.length === 0) {
      return { event: null, occurred: false, modifiedProbability: 0 };
    }

    // Check each event
    for (const event of eligibleEvents) {
      // Skip if already occurred this simulation
      if (this.eventHistory.has(event.id)) {
        continue;
      }

      const modifiedProb = this.calculateModifiedProbability(event, parameters, state);
      
      if (Math.random() < modifiedProb) {
        this.eventHistory.add(event.id);
        
        logger.debug({
          eventId: event.id,
          probability: modifiedProb,
          cloneId: context.cloneId,
        }, 'Chaos event injected');

        return {
          event,
          occurred: true,
          modifiedProbability: modifiedProb,
        };
      }
    }

    return { event: null, occurred: false, modifiedProbability: 0 };
  }

  // Get events eligible for this context
  private getEligibleEvents(
    state: CloneExecutionContext['state'],
    parameters: CloneParameters,
    path: string[]
  ): ChaosEvent[] {
    return CHAOS_EVENTS.filter(event => {
      // Check conditions if they exist
      if (event.conditions) {
        for (const condition of event.conditions) {
          if (!this.evaluateCondition(condition, state, parameters)) {
            return false;
          }
        }
      }
      return true;
    });
  }

  // Evaluate simple condition strings
  private evaluateCondition(
    condition: string,
    state: CloneExecutionContext['state'],
    parameters: CloneParameters
  ): boolean {
    // Parse simple conditions like "health > 0.3", "capital > 20000"
    const match = condition.match(/(\w+)\s*([><=!]+)\s*([\d.]+)/);
    if (!match) return true; // Unknown condition format, allow

    const [, key, operator, valueStr] = match;
    const value = parseFloat(valueStr);

    let actualValue: number;
    
    // Check if it's a parameter or state metric
    if (key in parameters) {
      actualValue = parameters[key as keyof CloneParameters] as number;
    } else if (key === 'health' || key === 'happiness' || key === 'capital') {
      actualValue = state[key as keyof typeof state] as number;
    } else if (key.startsWith('metrics.')) {
      const metricKey = key.replace('metrics.', '');
      const metricValue = state.metrics[metricKey];
      actualValue = typeof metricValue === 'number' ? metricValue : 0;
    } else {
      return true; // Unknown key, allow
    }

    switch (operator) {
      case '>': return actualValue > value;
      case '>=': return actualValue >= value;
      case '<': return actualValue < value;
      case '<=': return actualValue <= value;
      case '=':
      case '==': return actualValue === value;
      default: return true;
    }
  }

  // Calculate modified probability based on clone traits
  private calculateModifiedProbability(
    event: ChaosEvent,
    parameters: CloneParameters,
    state: CloneExecutionContext['state']
  ): number {
    let probability = event.baseProbability;

    // Adjust based on event type and clone traits
    switch (event.type) {
      case 'medical':
        // Emotional volatility increases health event impact/noticeability
        if (parameters.emotionalVolatility > 0.7) {
          probability *= 1.1;
        }
        // Low health increases future medical event probability
        if (state.health < 0.5) {
          probability *= 1.5;
        }
        break;

      case 'market_crash':
        // Risk tolerance affects exposure to market crashes
        if (parameters.riskTolerance > 0.8) {
          probability *= 1.3; // Higher risk = more exposure
        } else if (parameters.riskTolerance < 0.3) {
          probability *= 0.5; // Conservative = more protected
        }
        break;

      case 'job_loss':
        // Decision speed affects job stability (impulsive = higher risk)
        if (parameters.decisionSpeed > 0.8) {
          probability *= 1.2;
        }
        // Social dependency = better network = job loss protection
        if (parameters.socialDependency > 0.7) {
          probability *= 0.8;
        }
        break;

      case 'relationship':
        // Emotional volatility affects relationship stability
        if (parameters.emotionalVolatility > 0.7) {
          probability *= 1.4;
        }
        // Social dependency affects relationship value
        if (parameters.socialDependency > 0.8) {
          probability *= 1.2; // More invested = more at stake
        }
        break;

      case 'natural_disaster':
        // Mostly random, slight adjustments
        if (parameters.riskTolerance < 0.3) {
          probability *= 0.9; // Risk-averse may have better insurance/planning
        }
        break;
    }

    // General modifiers
    // High stress increases probability of bad events
    const stressLevel = state.metrics.stressLevel;
    if (typeof stressLevel === 'number' && stressLevel > 0.7) {
      probability *= 1.2;
    }

    // Low happiness increases vulnerability
    if (state.happiness < 0.3) {
      probability *= 1.15;
    }

    return Math.min(0.5, probability); // Cap at 50% per check
  }

  // Apply chaos event effects to state
  applyEvent(state: CloneExecutionContext['state'], event: ChaosEvent): CloneExecutionContext['state'] {
    applyExternalCausalTransition(state, event.id);
    return applyEffectsToState(state, event.impact);
  }

  // Get all available chaos events
  getAvailableEvents(): ChaosEvent[] {
    return [...CHAOS_EVENTS];
  }

  // Get event history
  getEventHistory(): string[] {
    return Array.from(this.eventHistory);
  }

  // Reset for new simulation
  reset(): void {
    this.eventHistory.clear();
  }

  // Enable/disable
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  // Set max events
  setMaxEvents(max: number): void {
    this.maxEventsPerSimulation = max;
  }

  // Get statistics about chaos injection
  getStats(): {
    totalEvents: number;
    byType: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    
    for (const event of CHAOS_EVENTS) {
      byType[event.type] = (byType[event.type] || 0) + 1;
    }

    return {
      totalEvents: CHAOS_EVENTS.length,
      byType,
    };
  }
}

// Singleton instance
export const chaosInjector = new ChaosInjector();

// Factory function
export function createChaosInjector(enabled: boolean = true): ChaosInjector {
  return new ChaosInjector(enabled);
}

// Quick check function
export function checkForChaos(
  context: CloneExecutionContext,
  enabled: boolean = true
): ChaosResult {
  const injector = enabled ? chaosInjector : new ChaosInjector(false);
  return injector.inject(context);
}

// Get chaos event by ID
export function getChaosEvent(id: string): ChaosEvent | undefined {
  return CHAOS_EVENTS.find(e => e.id === id);
}

// Calculate aggregate chaos probability for a clone
export function calculateChaosExposure(
  parameters: CloneParameters,
  capital: number
): {
  overallRisk: number;
  riskiestCategory: string;
  protectiveFactors: string[];
} {
  const protectiveFactors: string[] = [];
  let riskMultiplier = 1.0;

  // Protective factors
  if (parameters.riskTolerance < 0.3) {
    protectiveFactors.push('conservative_approach');
    riskMultiplier *= 0.85;
  }
  if (parameters.emotionalVolatility < 0.3) {
    protectiveFactors.push('emotional_stability');
    riskMultiplier *= 0.9;
  }
  if (parameters.socialDependency > 0.7) {
    protectiveFactors.push('strong_support_network');
    riskMultiplier *= 0.9;
  }
  if (capital > 100000) {
    protectiveFactors.push('financial_buffer');
    riskMultiplier *= 0.85;
  }

  // Risk factors
  let riskiestCategory = 'general';
  let maxRisk = 0;

  const medicalRisk = parameters.emotionalVolatility * 0.5;
  if (medicalRisk > maxRisk) {
    maxRisk = medicalRisk;
    riskiestCategory = 'medical';
  }

  const marketRisk = parameters.riskTolerance * 0.4;
  if (marketRisk > maxRisk) {
    maxRisk = marketRisk;
    riskiestCategory = 'market_crash';
  }

  const jobRisk = (parameters.decisionSpeed - 0.5) * 0.3;
  if (jobRisk > maxRisk) {
    maxRisk = jobRisk;
    riskiestCategory = 'job_loss';
  }

  const relationshipRisk = parameters.emotionalVolatility * 0.6;
  if (relationshipRisk > maxRisk) {
    maxRisk = relationshipRisk;
    riskiestCategory = 'relationship';
  }

  // Calculate overall annual risk
  const baseAnnualRisk = CHAOS_EVENTS.reduce((sum, e) => sum + e.baseProbability, 0);
  const overallRisk = Math.min(0.5, baseAnnualRisk * riskMultiplier);

  return {
    overallRisk,
    riskiestCategory,
    protectiveFactors,
  };
}

// Export chaos events for use in other modules
export { CHAOS_EVENTS, ChaosResult };
