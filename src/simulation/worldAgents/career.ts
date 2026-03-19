// Career World Agent - Job market, salary growth, burnout models
// Based on US Bureau of Labor Statistics and industry research

import { BaseWorldAgent } from './base.js';
import { CloneExecutionContext, WorldEvent, OutcomeEffect } from '../types.js';
import { getBaseRate } from '../baseRateRegistry.js';

const ANNUAL_SALARY_GROWTH =
  getBaseRate('career_change', 'salary_growth_annual', ['us_workers', 'private_industry'])?.rate ?? 0.035;
const MONTHLY_LAYOFF_RATE =
  getBaseRate('career_change', 'layoff_rate_monthly', ['us_workers', 'all_industries', 'monthly'])?.rate ?? 0.011;
const MONTHLY_VOLUNTARY_QUIT_RATE =
  getBaseRate('career_change', 'voluntary_quit_rate_monthly', ['us_workers', 'all_industries', 'monthly'])?.rate ?? 0.024;
const JOB_SEARCH_DURATION_MONTHS =
  getBaseRate('career_change', 'job_search_duration_months', ['us_workers'])?.rate ?? 5.8;

interface CareerState {
  currentSalary: number;
  jobStability: number; // 0-1
  yearsInRole: number;
  promotionReadiness: number;
  skillRelevance: number; // 0-1 how current skills are
  networkStrength: number;
  burnoutLevel: number;
  jobSearchStatus: 'employed' | 'searching' | 'unemployed';
  monthsUnemployed: number;
}

interface JobOffer {
  salary: number;
  stability: number;
  growthPotential: number;
  cultureFit: number;
}

export class CareerWorldAgent extends BaseWorldAgent {
  type = 'career';
  
  private state: CareerState = {
    currentSalary: 0,
    jobStability: 0.8,
    yearsInRole: 0,
    promotionReadiness: 0.5,
    skillRelevance: 0.7,
    networkStrength: 0.4,
    burnoutLevel: 0.2,
    jobSearchStatus: 'employed',
    monthsUnemployed: 0,
  };

  // Initialize with starting conditions
  initialize(
    startingSalary: number,
    industryStability: number = 0.7,
    skillLevel: number = 0.5
  ): void {
    this.state.currentSalary = startingSalary;
    this.state.jobStability = industryStability;
    this.state.skillRelevance = skillLevel;
    this.state.yearsInRole = 0;
    this.state.promotionReadiness = 0.3;
    this.state.networkStrength = 0.4;
    this.state.burnoutLevel = 0.2;
    this.state.jobSearchStatus = 'employed';
    this.state.monthsUnemployed = 0;
  }

  // Advance simulation by months
  advanceTime(months: number): void {
    for (let i = 0; i < months; i++) {
      this.simulateMonth();
    }
  }

  // Simulate one month of career dynamics
  private simulateMonth(): void {
    // Update job tenure
    if (this.state.jobSearchStatus === 'employed') {
      this.state.yearsInRole += 1/12;
    }
    
    // Salary growth (annual raise, prorated monthly)
    const monthlyGrowth = Math.pow(1 + ANNUAL_SALARY_GROWTH, 1 / 12) - 1;
    this.state.currentSalary *= (1 + monthlyGrowth);
    
    // Promotion readiness increases with tenure
    this.state.promotionReadiness = Math.min(1, 
      this.state.promotionReadiness + (0.05 / 12)
    );
    
    // Skill relevance slowly decays
    this.state.skillRelevance = Math.max(0.3, 
      this.state.skillRelevance - (0.02 / 12)
    );
    
    // Burnout dynamics
    if (this.state.yearsInRole > 2) {
      this.state.burnoutLevel = Math.min(1, 
        this.state.burnoutLevel + (0.03 / 12)
      );
    }
    
    // If unemployed, track duration
    if (this.state.jobSearchStatus === 'unemployed') {
      this.state.monthsUnemployed++;
    }
  }

  // Evaluate context and return career world event
  evaluate(context: CloneExecutionContext): WorldEvent | null {
    const { state, parameters } = context;
    const events: WorldEvent[] = [];
    
    // Job loss event (layoff)
    const layoffProbability = this.applyBehavioralModifiers(
      MONTHLY_LAYOFF_RATE,
      context,
      [
        { trait: 'emotionalVolatility', threshold: 0.8, factor: 1.3 }, // Emotional issues may affect performance
        { trait: 'socialDependency', threshold: 0.7, factor: 0.9 }, // Good relationships provide protection
      ]
    );
    
    if (this.state.jobSearchStatus === 'employed' && this.roll(layoffProbability)) {
      const severance = this.state.currentSalary * (0.1 + Math.random() * 0.2); // 1-3 months
      events.push(this.createEvent(
        'job_loss',
        `Unexpected layoff. Severance: $${severance.toFixed(0)}`,
        [
          { target: 'capital', delta: severance, type: 'absolute' },
          { target: 'happiness', delta: -0.25, type: 'absolute' },
          { target: 'health', delta: -0.1, type: 'absolute' },
          { target: 'metrics.stressLevel', delta: 0.4, type: 'absolute' },
        ],
        layoffProbability
      ));
      this.state.jobSearchStatus = 'unemployed';
      this.state.monthsUnemployed = 0;
    }
    
    // Voluntary quit (if conditions met)
    const quitProbability = this.applyBehavioralModifiers(
      MONTHLY_VOLUNTARY_QUIT_RATE,
      context,
      [
        { trait: 'riskTolerance', threshold: 0.7, factor: 1.5 },
        { trait: 'decisionSpeed', threshold: 0.8, factor: 1.3 },
      ]
    );
    
    if (this.state.jobSearchStatus === 'employed' && 
        this.state.burnoutLevel > 0.6 && 
        this.roll(quitProbability)) {
      events.push(this.createEvent(
        'voluntary_resignation',
        'Resigned due to burnout seeking better opportunity',
        [
          { target: 'happiness', delta: 0.1, type: 'absolute' }, // Relief initially
          { target: 'metrics.stressLevel', delta: 0.3, type: 'absolute' }, // Financial stress
          { target: 'health', delta: 0.1, type: 'absolute' },
        ],
        quitProbability
      ));
      this.state.jobSearchStatus = 'unemployed';
      this.state.monthsUnemployed = 0;
    }
    
    // Promotion opportunity
    if (this.state.jobSearchStatus === 'employed' && this.state.promotionReadiness > 0.7) {
      const promotionProbability = 0.08; // ~1 promotion per year max
      if (this.roll(promotionProbability)) {
        const raise = this.randomRange(0.08, 0.25);
        const newSalary = this.state.currentSalary * (1 + raise);
        events.push(this.createEvent(
          'promotion',
          `Promoted! Salary increased by ${(raise * 100).toFixed(1)}%`,
          [
            { target: 'metrics.currentSalary', delta: newSalary - this.state.currentSalary, type: 'absolute' },
            { target: 'happiness', delta: 0.2, type: 'absolute' },
            { target: 'metrics.confidenceLevel', delta: 0.15, type: 'absolute' },
          ],
          promotionProbability
        ));
        this.state.currentSalary = newSalary;
        this.state.promotionReadiness = 0.2;
        this.state.yearsInRole = 0;
      }
    }
    
    // Job offer while searching
    if (this.state.jobSearchStatus === 'unemployed' || 
        (this.state.jobSearchStatus === 'employed' && this.state.burnoutLevel > 0.5)) {
      const offerProbability = this.applyBehavioralModifiers(
        0.15, // ~15% chance per month of getting offer when searching
        context,
        [
          { trait: 'socialDependency', threshold: 0.6, factor: 1.4 }, // Network helps
          { trait: 'learningStyle', threshold: 0.7, factor: 1.2 }, // Continuous learners get offers
        ]
      );
      
      if (this.roll(offerProbability)) {
        const offer = this.generateJobOffer();
        const salaryDelta = offer.salary - this.state.currentSalary;
        
        events.push(this.createEvent(
          'job_offer',
          `Job offer received: $${offer.salary.toFixed(0)}/year`,
          [
            { target: 'metrics.newSalary', delta: salaryDelta, type: 'absolute' },
            { target: 'happiness', delta: 0.25, type: 'absolute' },
            { target: 'metrics.stressLevel', delta: -0.2, type: 'absolute' },
          ],
          offerProbability
        ));
        
        this.state.jobSearchStatus = 'employed';
        this.state.monthsUnemployed = 0;
        this.state.currentSalary = offer.salary;
        this.state.burnoutLevel = 0.1;
        this.state.yearsInRole = 0;
      }
    }
    
    // Burnout warning
    if (this.state.burnoutLevel > 0.7 && this.roll(0.3)) {
      events.push(this.createEvent(
        'burnout_warning',
        'Burnout affecting performance and health',
        [
          { target: 'health', delta: -0.15, type: 'absolute' },
          { target: 'happiness', delta: -0.2, type: 'absolute' },
          { target: 'metrics.promotionReadiness', delta: -0.1, type: 'absolute' },
        ],
        0.3
      ));
    }
    
    // Extended unemployment hardship
    if (this.state.jobSearchStatus === 'unemployed' && this.state.monthsUnemployed > Math.ceil(JOB_SEARCH_DURATION_MONTHS)) {
      const hardshipProbability = Math.min(0.5, this.state.monthsUnemployed / 12);
      if (this.roll(hardshipProbability)) {
        events.push(this.createEvent(
          'unemployment_hardship',
          `Extended unemployment: ${this.state.monthsUnemployed} months`,
          [
            { target: 'capital', delta: -3000, type: 'absolute' },
            { target: 'health', delta: -0.1, type: 'absolute' },
            { target: 'metrics.confidenceLevel', delta: -0.2, type: 'absolute' },
          ],
          hardshipProbability
        ));
      }
    }
    
    // Return most significant event or null
    if (events.length === 0) return null;
    
    return events.sort((a, b) => {
      const impactA = Math.abs(a.impact.reduce((sum, e) => sum + e.delta, 0));
      const impactB = Math.abs(b.impact.reduce((sum, e) => sum + e.delta, 0));
      return impactB - impactA;
    })[0];
  }

  // Generate a job offer based on market conditions and skills
  private generateJobOffer(): JobOffer {
    const baseSalary = this.state.currentSalary * this.randomRange(0.9, 1.3);
    const skillPremium = this.state.skillRelevance * 0.2;
    const networkBonus = this.state.networkStrength * 0.1;
    
    return {
      salary: baseSalary * (1 + skillPremium + networkBonus),
      stability: this.randomRange(0.5, 0.9),
      growthPotential: this.randomRange(0.3, 0.8),
      cultureFit: this.randomRange(0.4, 0.9),
    };
  }

  // Get current career snapshot
  getSnapshot(): {
    currentSalary: number;
    jobStability: number;
    yearsInRole: number;
    burnoutLevel: number;
    jobSearchStatus: string;
    monthsUnemployed: number;
  } {
    return { ...this.state };
  }

  // Override reset
  reset(): void {
    super.reset();
    this.state = {
      currentSalary: 0,
      jobStability: 0.8,
      yearsInRole: 0,
      promotionReadiness: 0.5,
      skillRelevance: 0.7,
      networkStrength: 0.4,
      burnoutLevel: 0.2,
      jobSearchStatus: 'employed',
      monthsUnemployed: 0,
    };
  }
}

// Export factory function
export function createCareerAgent(
  startingSalary: number,
  industryStability?: number,
  skillLevel?: number
): CareerWorldAgent {
  const agent = new CareerWorldAgent();
  agent.initialize(startingSalary, industryStability, skillLevel);
  return agent;
}
