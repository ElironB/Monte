// Education World Agent - Completion rates, skill acquisition, degree ROI models
// Based on NCES data and education research

import { BaseWorldAgent } from './base.js';
import { CloneExecutionContext, WorldEvent, OutcomeEffect } from '../types.js';
import { getBaseRate } from '../baseRateRegistry.js';
import type { SimulationPersonaRuntimeProfile } from '../personaRuntime.js';

const BACHELORS_COMPLETION_RATE =
  getBaseRate('advanced_degree', 'completion_rate_bachelors', ['4yr_institution', 'first_time_students'])?.rate ?? 0.62;
const MASTERS_COMPLETION_RATE =
  getBaseRate('advanced_degree', 'completion_rate_masters', ['graduate_program'])?.rate ?? 0.78;
const MBA_COMPLETION_RATE =
  getBaseRate('advanced_degree', 'completion_rate_mba', ['accredited_program'])?.rate ?? 0.95;
const BOOTCAMP_COMPLETION_RATE =
  getBaseRate('career_change', 'completion_rate_bootcamp', ['coding_bootcamp'])?.rate ?? 0.71;

interface EducationState {
  programType: 'bachelors' | 'masters' | 'mba' | 'bootcamp' | 'certificate';
  enrollmentDate: Date;
  expectedDuration: number; // months
  completionProgress: number; // 0-1
  skillAcquisition: number; // 0-1
  networkingValue: number; // 0-1
  tuitionCost: number;
  remainingCost: number;
  dropoutRisk: number;
  isCompleted: boolean;
  isDropped: boolean;
}

export class EducationWorldAgent extends BaseWorldAgent {
  type = 'education';
  private personaProfile?: SimulationPersonaRuntimeProfile;
  
  private state: EducationState = {
    programType: 'bachelors',
    enrollmentDate: new Date(),
    expectedDuration: 48,
    completionProgress: 0,
    skillAcquisition: 0,
    networkingValue: 0,
    tuitionCost: 50000,
    remainingCost: 50000,
    dropoutRisk: 0.2,
    isCompleted: false,
    isDropped: false,
  };

  // Program configurations
  private static PROGRAM_CONFIGS: Record<EducationState['programType'], {
    duration: number;
    baseTuition: number;
    completionRate: number;
    skillValue: number;
    salaryBoost: number;
  }> = {
    bachelors: {
      duration: 48,
      baseTuition: 40000,
      completionRate: BACHELORS_COMPLETION_RATE,
      skillValue: 0.7,
      salaryBoost: 0.65, // 65% salary increase vs high school
    },
    masters: {
      duration: 24,
      baseTuition: 30000,
      completionRate: MASTERS_COMPLETION_RATE,
      skillValue: 0.85,
      salaryBoost: 0.85,
    },
    mba: {
      duration: 24,
      baseTuition: 60000,
      completionRate: MBA_COMPLETION_RATE,
      skillValue: 0.9,
      salaryBoost: 1.2, // 120% salary increase
    },
    bootcamp: {
      duration: 4,
      baseTuition: 15000,
      completionRate: BOOTCAMP_COMPLETION_RATE,
      skillValue: 0.75,
      salaryBoost: 0.45,
    },
    certificate: {
      duration: 6,
      baseTuition: 5000,
      completionRate: 0.55,
      skillValue: 0.5,
      salaryBoost: 0.25,
    },
  };

  // Initialize with program type
  initialize(
    programType: EducationState['programType'],
    personaProfile?: SimulationPersonaRuntimeProfile,
  ): void {
    const config = EducationWorldAgent.PROGRAM_CONFIGS[programType];
    this.personaProfile = personaProfile;
    
    this.state.programType = programType;
    this.state.enrollmentDate = new Date();
    this.state.expectedDuration = config.duration;
    this.state.completionProgress = 0;
    this.state.skillAcquisition = 0;
    this.state.networkingValue = 0;
    this.state.tuitionCost = config.baseTuition;
    this.state.remainingCost = config.baseTuition;
    this.state.dropoutRisk = Math.max(
      0.05,
      Math.min(
        0.9,
        (1 - config.completionRate)
          * (1.05 + ((personaProfile ? (1 - personaProfile.educationPersistence) : 0.5) * 0.6))
          * (1 + ((personaProfile?.stressFragility ?? 0.5) * 0.2)),
      ),
    );
    this.state.isCompleted = false;
    this.state.isDropped = false;
  }

  // Advance simulation by months
  advanceTime(months: number): void {
    for (let i = 0; i < months; i++) {
      this.simulateMonth();
    }
  }

  // Simulate one month of education
  private simulateMonth(): void {
    if (this.state.isCompleted || this.state.isDropped) return;
    
    const persona = this.personaProfile;
    const config = EducationWorldAgent.PROGRAM_CONFIGS[this.state.programType];
    const totalMonths = config.duration;
    
    // Progress increases each month
    const progressRate = (1 / totalMonths) * (0.75 + ((persona?.educationPersistence ?? 0.5) * 0.5));
    this.state.completionProgress = Math.min(1, 
      this.state.completionProgress + progressRate
    );
    
    // Skill acquisition follows learning curve (diminishing returns)
    const skillRate = progressRate * config.skillValue * 
      (1 + 0.5 * (1 - this.state.completionProgress)) *
      (0.85 + ((persona?.informationDepth ?? 0.5) * 0.3)); // Faster at start
    this.state.skillAcquisition = Math.min(1, 
      this.state.skillAcquisition + skillRate
    );
    
    // Networking builds over time, accelerates in later stages
    const networkRate = progressRate
      * (0.5 + 0.5 * this.state.completionProgress)
      * (0.8 + ((persona?.socialPressureSensitivity ?? 1) * 0.1));
    this.state.networkingValue = Math.min(1, 
      this.state.networkingValue + networkRate
    );
    
    // Tuition payment (assume monthly payments)
    const monthlyPayment = this.state.tuitionCost / totalMonths;
    this.state.remainingCost = Math.max(0, 
      this.state.remainingCost - monthlyPayment
    );
    
    // Check for completion
    if (this.state.completionProgress >= 1) {
      this.state.isCompleted = true;
      this.state.completionProgress = 1;
    }
  }

  // Evaluate context and return education world event
  evaluate(context: CloneExecutionContext): WorldEvent | null {
    const { state } = context;
    const events: WorldEvent[] = [];
    const config = EducationWorldAgent.PROGRAM_CONFIGS[this.state.programType];
    const persona = this.personaProfile;
    
    // Dropout risk check
    if (!this.state.isCompleted && !this.state.isDropped) {
      let dropoutProbability = this.applyBehavioralModifiers(
        this.state.dropoutRisk / this.state.expectedDuration, // Monthly risk
        context,
        [
          { trait: 'emotionalVolatility', threshold: 0.7, factor: 1.5 },
          { trait: 'timePreference', threshold: 0.7, factor: 1.3 }, // Impatient = higher dropout
          { trait: 'learningStyle', threshold: 0.8, factor: 0.8 }, // Good learners persist
          { trait: 'executionGap', threshold: 0.65, factor: 1.25 },
          { trait: 'stressResponse', threshold: 0.65, factor: 1.2 },
          { trait: 'informationSeeking', threshold: 0.35, factor: 1.15, direction: 'below' },
        ]
      );
      if (persona?.riskFlags.includes('planning_paralysis')) {
        dropoutProbability *= 1.05;
      }
      dropoutProbability = Math.min(1, dropoutProbability);
      
      if (this.roll(dropoutProbability)) {
        const debtAccumulated = this.state.tuitionCost - this.state.remainingCost;
        events.push(this.createEvent(
          'dropout',
          `Dropped out of ${this.state.programType}. Debt: $${debtAccumulated.toFixed(0)}`,
          [
            { target: 'capital', delta: -debtAccumulated, type: 'absolute' },
            { target: 'happiness', delta: -0.2, type: 'absolute' },
            { target: 'metrics.confidenceLevel', delta: -0.15, type: 'absolute' },
            { target: 'metrics.completionProgress', delta: -0.5, type: 'absolute' },
          ],
          dropoutProbability
        ));
        this.state.isDropped = true;
        return events[0];
      }
    }
    
    // Milestone: 50% completion
    if (this.state.completionProgress >= 0.5 && 
        this.state.completionProgress < 0.55 && 
        this.roll(0.5)) {
      events.push(this.createEvent(
        'education_milestone',
        `Halfway through ${this.state.programType} program`,
        [
          { target: 'metrics.skillAcquisition', delta: 0.1, type: 'absolute' },
          { target: 'metrics.confidenceLevel', delta: 0.1, type: 'absolute' },
        ],
        0.5
      ));
    }
    
    // Program completion
    if (this.state.isCompleted && this.roll(0.8)) {
      const salaryBoost = config.salaryBoost;
      const newSalary = (state.metrics.currentSalary || 50000) * (1 + salaryBoost);
      
      events.push(this.createEvent(
        'degree_completion',
        `Completed ${this.state.programType}! Salary potential: +${(salaryBoost * 100).toFixed(0)}%`,
        [
          { target: 'metrics.newSalary', delta: newSalary, type: 'absolute' },
          { target: 'happiness', delta: 0.3, type: 'absolute' },
          { target: 'metrics.careerAdvancement', delta: 0.4, type: 'absolute' },
          { target: 'metrics.networkingValue', delta: 0.3, type: 'absolute' },
        ],
        0.8
      ));
    }
    
    // Financial strain from education costs
    if (this.state.remainingCost > 0 && state.capital < 10000) {
      let strainProbability = this.applyBehavioralModifiers(
        0.15,
        context,
        [
          { trait: 'emotionalVolatility', threshold: 0.6, factor: 1.4 },
          { trait: 'timePreference', threshold: 0.7, factor: 1.2 },
          { trait: 'executionGap', threshold: 0.65, factor: 1.15 },
        ]
      );
      if (persona?.riskFlags.includes('stress_capitulation')) {
        strainProbability *= 1.1;
      }
      strainProbability = Math.min(1, strainProbability);
      
      if (this.roll(strainProbability)) {
        events.push(this.createEvent(
          'education_financial_strain',
          `Financial stress from education costs. Remaining: $${this.state.remainingCost.toFixed(0)}`,
          [
            { target: 'health', delta: -0.1, type: 'absolute' },
            { target: 'happiness', delta: -0.15, type: 'absolute' },
            { target: 'metrics.stressLevel', delta: 0.25, type: 'absolute' },
          ],
          strainProbability
        ));
      }
    }
    
    // Networking opportunity
    let networkingProbability = 0.1;
    if (this.state.networkingValue > 0.3) {
      networkingProbability = this.applyBehavioralModifiers(
        networkingProbability,
        context,
        [
          { trait: 'socialDependency', threshold: 0.6, factor: 1.2 },
          { trait: 'informationSeeking', threshold: 0.65, factor: 1.25 },
        ]
      );
    }
    if (this.state.networkingValue > 0.3 && this.roll(networkingProbability)) {
      events.push(this.createEvent(
        'networking_opportunity',
        'Valuable connection made through educational program',
        [
          { target: 'metrics.networkStrength', delta: 0.15, type: 'absolute' },
          { target: 'metrics.opportunityAccess', delta: 0.1, type: 'absolute' },
        ],
        networkingProbability
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

  // Calculate ROI projection
  calculateROI(currentSalary: number): {
    breakEvenYears: number;
    tenYearROI: number;
    probabilityPositive: number;
  } {
    const config = EducationWorldAgent.PROGRAM_CONFIGS[this.state.programType];
    const cost = this.state.tuitionCost;
    const annualBoost = currentSalary * config.salaryBoost;
    
    // Simple payback period
    const breakEvenYears = cost / annualBoost;
    
    // 10-year ROI
    const tenYearGain = annualBoost * 10;
    const tenYearROI = (tenYearGain - cost) / cost;
    
    // Probability of positive ROI based on completion rate
    const probabilityPositive = this.state.isCompleted ? 0.95 : config.completionRate;
    
    return {
      breakEvenYears,
      tenYearROI,
      probabilityPositive,
    };
  }

  // Get current education snapshot
  getSnapshot(): {
    programType: string;
    completionProgress: number;
    skillAcquisition: number;
    remainingCost: number;
    isCompleted: boolean;
    isDropped: boolean;
    monthsRemaining: number;
  } {
    const config = EducationWorldAgent.PROGRAM_CONFIGS[this.state.programType];
    const monthsRemaining = this.state.isCompleted ? 0 : 
      Math.max(0, config.duration * (1 - this.state.completionProgress));
    
    return {
      programType: this.state.programType,
      completionProgress: this.state.completionProgress,
      skillAcquisition: this.state.skillAcquisition,
      remainingCost: this.state.remainingCost,
      isCompleted: this.state.isCompleted,
      isDropped: this.state.isDropped,
      monthsRemaining,
    };
  }

  // Override reset
  reset(): void {
    super.reset();
    this.state = {
      programType: 'bachelors',
      enrollmentDate: new Date(),
      expectedDuration: 48,
      completionProgress: 0,
      skillAcquisition: 0,
      networkingValue: 0,
      tuitionCost: 50000,
      remainingCost: 50000,
      dropoutRisk: 0.2,
      isCompleted: false,
      isDropped: false,
    };
  }
}

// Export factory function
export function createEducationAgent(
  programType: 'bachelors' | 'masters' | 'mba' | 'bootcamp' | 'certificate'
): EducationWorldAgent {
  const agent = new EducationWorldAgent();
  agent.initialize(programType);
  return agent;
}
