// Decision graph builder for all 8 scenarios
// Phase 4: Simulation Engine

import { 
  Scenario, 
  GraphNode, 
  DecisionNode, 
  EventNode, 
  OutcomeNode,
  OutcomeEffect,
  SimulationState,
  ScenarioType
} from './types.js';
import { applyEffectsToState } from './state.js';

// Build decision graph for any scenario type
export function buildDecisionGraph(scenarioType: string): GraphNode[] {
  switch (scenarioType) {
    case ScenarioType.DAY_TRADING:
      return buildDayTradingGraph();
    case ScenarioType.STARTUP_FOUNDING:
      return buildStartupFoundingGraph();
    case ScenarioType.CAREER_CHANGE:
      return buildCareerChangeGraph();
    case ScenarioType.ADVANCED_DEGREE:
      return buildAdvancedDegreeGraph();
    case ScenarioType.GEOGRAPHIC_RELOCATION:
      return buildGeographicRelocationGraph();
    case ScenarioType.REAL_ESTATE_PURCHASE:
      return buildRealEstatePurchaseGraph();
    case ScenarioType.HEALTH_FITNESS_GOAL:
      return buildHealthFitnessGraph();
    case ScenarioType.CUSTOM:
      return buildCustomGraph();
    default:
      throw new Error(`Unknown scenario type: ${scenarioType}`);
  }
}

// Get initial state for a scenario
export function getInitialState(scenarioType: string): SimulationState {
  const baseState: SimulationState = {
    capital: 0,
    health: 1.0,
    happiness: 0.7,
    timeElapsed: 0,
    decisions: [],
    events: [],
    metrics: {},
  };

  switch (scenarioType) {
    case ScenarioType.DAY_TRADING:
      return {
        ...baseState,
        capital: 50000, // $50k starting capital
        metrics: {
          portfolioValue: 50000,
          tradesMade: 0,
          winRate: 0,
          avgTradeSize: 0,
          maxDrawdown: 0,
          stressLevel: 0.3,
        },
      };
    
    case ScenarioType.STARTUP_FOUNDING:
      return {
        ...baseState,
        capital: 100000, // Personal savings + seed
        metrics: {
          runway: 18, // months
          revenue: 0,
          teamSize: 1,
          productMaturity: 0,
          investorInterest: 0,
          burnoutRisk: 0.2,
        },
      };
    
    case ScenarioType.CAREER_CHANGE:
      return {
        ...baseState,
        capital: 30000, // Emergency fund
        metrics: {
          currentSalary: 75000,
          skillGap: 0.5,
          networkStrength: 0.4,
          marketDemand: 0.7,
          transitionProgress: 0,
          confidenceLevel: 0.6,
        },
      };
    
    case ScenarioType.ADVANCED_DEGREE:
      return {
        ...baseState,
        capital: -50000, // Student loan debt
        metrics: {
          tuitionCost: 50000,
          lostIncome: 0,
          completionProgress: 0,
          skillAcquisition: 0,
          careerAdvancement: 0,
          networkingValue: 0,
        },
      };
    
    case ScenarioType.GEOGRAPHIC_RELOCATION:
      return {
        ...baseState,
        capital: 20000, // Moving costs buffer
        metrics: {
          movingCost: 8000,
          housingCostDelta: 0,
          salaryDelta: 0,
          socialDisruption: 0,
          adaptationProgress: 0,
          opportunityAccess: 0,
        },
      };
    
    case ScenarioType.REAL_ESTATE_PURCHASE:
      return {
        ...baseState,
        capital: 100000, // Down payment savings
        metrics: {
          downPayment: 60000,
          propertyValue: 300000,
          mortgageRate: 0.065,
          monthlyPayment: 0,
          appreciationRate: 0.03,
          maintenanceCost: 0,
        },
      };
    
    case ScenarioType.HEALTH_FITNESS_GOAL:
      return {
        ...baseState,
        capital: 2000, // Gym, nutrition, equipment
        metrics: {
          weightGoal: -20, // lbs to lose
          fitnessLevel: 0.3,
          consistency: 0,
          injuryRisk: 0.1,
          motivationLevel: 0.7,
          supportSystem: 0.5,
        },
      };

    case ScenarioType.CUSTOM:
      return {
        ...baseState,
        capital: 25000,
        metrics: {
          commitmentLevel: 0.4,
          progressRate: 0,
          setbackCount: 0,
          adaptationScore: 0.2,
          optionalityPreserved: 1.0,
          evidenceQuality: 0.3,
          executionQuality: 0.5,
          burnRate: 0.15,
          socialPressure: 0.25,
          convictionStability: 0.5,
          reversibility: 0.8,
          runwayMonths: 12,
          learningVelocity: 0.3,
          opportunityAccess: 0.4,
        },
      };
    
    default:
      return baseState;
  }
}

// Day Trading Scenario Graph
function buildDayTradingGraph(): GraphNode[] {
  const nodes: GraphNode[] = [
    // Entry decision
    {
      id: 'start',
      type: 'decision',
      prompt: 'You have $50,000 to start day trading. How do you approach the first month?',
      options: [
        { id: 'cautious', label: 'Paper trade for 2 weeks, then start with $5k positions', value: 'cautious', nextNodeId: 'month1_education' },
        { id: 'moderate', label: 'Start immediately with $10k positions, strict stop losses', value: 'moderate', nextNodeId: 'month1_active' },
        { id: 'aggressive', label: 'Go all-in with $25k positions, high conviction trades', value: 'aggressive', nextNodeId: 'month1_high_risk', requiresEvaluation: true },
      ],
    } as DecisionNode,

    // Education path
    {
      id: 'month1_education',
      type: 'event',
      name: 'Learning Phase',
      description: 'Two weeks of paper trading and strategy development',
      probability: 1.0,
      outcomes: [
        { 
          id: 'learned_well', 
          label: 'Developed solid strategy foundation',
          effects: [
            { target: 'metrics.stressLevel', delta: -0.1, type: 'absolute' },
            { target: 'metrics.winRate', delta: 0.1, type: 'absolute' },
          ],
          nextNodeId: 'month3_check',
        },
        { 
          id: 'learned_basic', 
          label: 'Basic understanding, ready to start',
          effects: [],
          nextNodeId: 'month3_check',
        },
      ],
    } as EventNode,

    // Active trading path
    {
      id: 'month1_active',
      type: 'event',
      name: 'Early Trading Results',
      description: 'First month of live trading with moderate positions',
      probability: 1.0,
      probabilityModifiers: [
        { condition: 'riskTolerance > 0.7', factor: 1.2 },
        { condition: 'decisionSpeed > 0.8', factor: 1.1 },
      ],
      outcomes: [
        { 
          id: 'profitable', 
          label: 'Profitable first month',
          effects: [
            { target: 'capital', delta: 3000, type: 'absolute' },
            { target: 'happiness', delta: 0.15, type: 'absolute' },
            { target: 'metrics.tradesMade', delta: 45, type: 'absolute' },
          ],
          nextNodeId: 'month3_check',
        },
        { 
          id: 'breakeven', 
          label: 'Breakeven with lessons learned',
          effects: [
            { target: 'capital', delta: -500, type: 'absolute' },
            { target: 'metrics.tradesMade', delta: 40, type: 'absolute' },
          ],
          nextNodeId: 'month3_check',
        },
        { 
          id: 'losing', 
          label: 'Lost money on emotional trades',
          effects: [
            { target: 'capital', delta: -4000, type: 'absolute' },
            { target: 'happiness', delta: -0.2, type: 'absolute' },
            { target: 'health', delta: -0.1, type: 'absolute' },
            { target: 'metrics.tradesMade', delta: 55, type: 'absolute' },
            { target: 'metrics.stressLevel', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'month3_check',
        },
      ],
    } as EventNode,

    // High risk path
    {
      id: 'month1_high_risk',
      type: 'event',
      name: 'High Stakes Trading',
      description: 'Large position sizes from the start',
      probability: 1.0,
      outcomes: [
        { 
          id: 'big_win', 
          label: 'Caught a momentum move, big profit',
          effects: [
            { target: 'capital', delta: 12000, type: 'absolute' },
            { target: 'happiness', delta: 0.25, type: 'absolute' },
            { target: 'metrics.tradesMade', delta: 20, type: 'absolute' },
            { target: 'metrics.winRate', delta: 0.15, type: 'absolute' },
          ],
          nextNodeId: 'month3_check',
        },
        { 
          id: 'big_loss', 
          label: 'Stop loss hit on oversized position',
          effects: [
            { target: 'capital', delta: -12000, type: 'absolute' },
            { target: 'happiness', delta: -0.3, type: 'absolute' },
            { target: 'health', delta: -0.15, type: 'absolute' },
            { target: 'metrics.tradesMade', delta: 15, type: 'absolute' },
            { target: 'metrics.stressLevel', delta: 0.35, type: 'absolute' },
            { target: 'metrics.maxDrawdown', delta: 0.24, type: 'absolute' },
          ],
          nextNodeId: 'reassess_or_quit',
        },
        { 
          id: 'mixed', 
          label: 'Volatile results, high stress',
          effects: [
            { target: 'capital', delta: 2000, type: 'absolute' },
            { target: 'metrics.tradesMade', delta: 30, type: 'absolute' },
            { target: 'metrics.stressLevel', delta: 0.25, type: 'absolute' },
          ],
          nextNodeId: 'month3_check',
        },
      ],
    } as EventNode,

    // Reassessment decision
    {
      id: 'reassess_or_quit',
      type: 'decision',
      prompt: 'You took a significant loss. What do you do?',
      options: [
        { id: 'stop', label: 'Stop trading, preserve remaining capital', value: 'stop', nextNodeId: 'outcome_quit' },
        { id: 'reassess', label: 'Reassess strategy, reduce position size', value: 'reassess', nextNodeId: 'month3_check' },
        { id: 'double_down', label: 'Increase size to make it back', value: 'double_down', nextNodeId: 'outcome_bust', requiresEvaluation: true },
      ],
    } as DecisionNode,

    // 3-month check
    {
      id: 'month3_check',
      type: 'decision',
      prompt: 'Three months in. Your capital is ${capital}. What is your plan?',
      options: [
        { id: 'continue_cautious', label: 'Continue with current strategy', value: 'continue_cautious', nextNodeId: 'month6_market_event' },
        { id: 'increase_size', label: 'Increase position sizes (feeling confident)', value: 'increase_size', nextNodeId: 'month6_market_event', requiresEvaluation: true },
        { id: 'change_strategy', label: 'Pivot to different trading style', value: 'change_strategy', nextNodeId: 'month6_market_event' },
        { id: 'quit_profitable', label: 'Quit while ahead', value: 'quit_profitable', nextNodeId: 'outcome_moderate_success' },
      ],
    } as DecisionNode,

    // Market event at 6 months
    {
      id: 'month6_market_event',
      type: 'event',
      name: 'Market Volatility Event',
      description: 'Significant market movement tests your strategy',
      probability: 0.7,
      outcomes: [
        { 
          id: 'navigated_well', 
          label: 'Navigated volatility successfully',
          effects: [
            { target: 'capital', delta: 5000, type: 'absolute' },
            { target: 'happiness', delta: 0.1, type: 'absolute' },
          ],
          nextNodeId: 'month12_final',
        },
        { 
          id: 'whipsawed', 
          label: 'Got stopped out multiple times',
          effects: [
            { target: 'capital', delta: -3000, type: 'absolute' },
            { target: 'metrics.stressLevel', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'month12_final',
        },
      ],
    } as EventNode,

    // Final assessment at 12 months
    {
      id: 'month12_final',
      type: 'decision',
      prompt: 'One year later. Capital: ${capital}. Stress level: high. What is your decision?',
      options: [
        { id: 'continue_career', label: 'Continue as primary income source', value: 'continue_career', nextNodeId: 'outcome_career_trader', requiresEvaluation: true },
        { id: 'side_income', label: 'Continue part-time alongside job', value: 'side_income', nextNodeId: 'outcome_side_success' },
        { id: 'quit_done', label: 'Quit trading, return to regular employment', value: 'quit_done', nextNodeId: 'outcome_return_to_work' },
      ],
    } as DecisionNode,

    // Outcome nodes
    {
      id: 'outcome_quit',
      type: 'outcome',
      results: {
        finalCapital: 38000,
        outcome: 'early_exit',
        reason: 'preserved_capital',
        healthImpact: -0.05,
        happinessImpact: 0.0,
      },
    } as OutcomeNode,

    {
      id: 'outcome_bust',
      type: 'outcome',
      results: {
        finalCapital: 15000,
        outcome: 'significant_loss',
        reason: 'revenge_trading',
        healthImpact: -0.25,
        happinessImpact: -0.4,
      },
    } as OutcomeNode,

    {
      id: 'outcome_moderate_success',
      type: 'outcome',
      results: {
        outcome: 'moderate_success',
        reason: 'quit_while_ahead',
        healthImpact: 0.05,
        happinessImpact: 0.15,
      },
    } as OutcomeNode,

    {
      id: 'outcome_career_trader',
      type: 'outcome',
      results: {
        outcome: 'career_trader',
        reason: 'sustained_profitability',
        healthImpact: -0.15,
        happinessImpact: 0.2,
      },
    } as OutcomeNode,

    {
      id: 'outcome_side_success',
      type: 'outcome',
      results: {
        outcome: 'side_income_success',
        reason: 'balanced_approach',
        healthImpact: 0.0,
        happinessImpact: 0.25,
      },
    } as OutcomeNode,

    {
      id: 'outcome_return_to_work',
      type: 'outcome',
      results: {
        outcome: 'returned_to_employment',
        reason: 'realistic_assessment',
        healthImpact: 0.1,
        happinessImpact: 0.05,
      },
    } as OutcomeNode,
  ];

  return nodes;
}

// Startup Founding Scenario Graph
function buildStartupFoundingGraph(): GraphNode[] {
  return [
    {
      id: 'start',
      type: 'decision',
      prompt: 'You have an idea and $100k savings. What do you do?',
      options: [
        { id: 'bootstrap', label: 'Bootstrap - use savings, retain full ownership', value: 'bootstrap', nextNodeId: 'month3_mvp' },
        { id: 'seed_raise', label: 'Seek seed funding immediately', value: 'seed_raise', nextNodeId: 'month3_fundraising' },
        { id: 'validate_first', label: 'Validate idea before quitting job', value: 'validate_first', nextNodeId: 'month3_validation' },
      ],
    } as DecisionNode,

    {
      id: 'month3_mvp',
      type: 'event',
      name: 'MVP Development',
      description: 'Building first product version',
      probability: 1.0,
      outcomes: [
        { 
          id: 'mvp_done', 
          label: 'MVP completed',
          effects: [
            { target: 'metrics.productMaturity', delta: 0.3, type: 'absolute' },
            { target: 'capital', delta: -25000, type: 'absolute' },
            { target: 'metrics.runway', delta: -3, type: 'absolute' },
          ],
          nextNodeId: 'month6_traction',
        },
      ],
    } as EventNode,

    {
      id: 'month3_validation',
      type: 'event',
      name: 'Idea Validation',
      description: 'Testing market demand while employed',
      probability: 1.0,
      outcomes: [
        { 
          id: 'strong_validation', 
          label: 'Strong market validation',
          effects: [
            { target: 'metrics.productMaturity', delta: 0.2, type: 'absolute' },
            { target: 'capital', delta: -5000, type: 'absolute' },
            { target: 'confidenceLevel', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'month6_quit_decision',
        },
        { 
          id: 'weak_validation', 
          label: 'Weak market interest',
          effects: [
            { target: 'capital', delta: -3000, type: 'absolute' },
            { target: 'happiness', delta: -0.1, type: 'absolute' },
          ],
          nextNodeId: 'outcome_pivot_or_quit',
        },
      ],
    } as EventNode,

    {
      id: 'month6_quit_decision',
      type: 'decision',
      prompt: 'Validation looks good. Do you quit your job?',
      options: [
        { id: 'quit_now', label: 'Quit and go full-time', value: 'quit_now', nextNodeId: 'month6_traction' },
        { id: 'stay_part_time', label: 'Continue part-time development', value: 'stay_part_time', nextNodeId: 'month12_slow_build' },
      ],
    } as DecisionNode,

    {
      id: 'month6_traction',
      type: 'event',
      name: 'Early Traction',
      description: 'First customers and revenue',
      probability: 1.0,
      outcomes: [
        { 
          id: 'traction_good', 
          label: 'Growing user base',
          effects: [
            { target: 'metrics.revenue', delta: 5000, type: 'absolute' },
            { target: 'happiness', delta: 0.2, type: 'absolute' },
            { target: 'metrics.investorInterest', delta: 0.3, type: 'absolute' },
          ],
          nextNodeId: 'month12_funding_decision',
        },
        { 
          id: 'traction_slow', 
          label: 'Slow growth, burning cash',
          effects: [
            { target: 'metrics.revenue', delta: 1000, type: 'absolute' },
            { target: 'capital', delta: -40000, type: 'absolute' },
            { target: 'metrics.burnoutRisk', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'month12_funding_decision',
        },
      ],
    } as EventNode,

    {
      id: 'month12_funding_decision',
      type: 'decision',
      prompt: '12 months in. Runway: {metrics.runway} months. Revenue: ${metrics.revenue}/mo. Next move?',
      options: [
        { id: 'raise_series_a', label: 'Raise Series A', value: 'raise_series_a', nextNodeId: 'month18_funding_result', requiresEvaluation: true },
        { id: 'profitable_bootstrap', label: 'Focus on profitability', value: 'profitable_bootstrap', nextNodeId: 'outcome_lifestyle_business' },
        { id: 'shut_down', label: 'Shut down, cut losses', value: 'shut_down', nextNodeId: 'outcome_shutdown' },
      ],
    } as DecisionNode,

    {
      id: 'month18_funding_result',
      type: 'event',
      name: 'Fundraising Outcome',
      description: 'Series A fundraising results',
      probability: 0.4,
      outcomes: [
        { 
          id: 'funding_raised', 
          label: 'Raised $2M Series A',
          effects: [
            { target: 'capital', delta: 2000000, type: 'absolute' },
            { target: 'metrics.teamSize', delta: 5, type: 'absolute' },
            { target: 'happiness', delta: 0.3, type: 'absolute' },
          ],
          nextNodeId: 'outcome_venture_backed',
        },
        { 
          id: 'funding_failed', 
          label: 'Could not close round',
          effects: [
            { target: 'metrics.burnoutRisk', delta: 0.3, type: 'absolute' },
            { target: 'happiness', delta: -0.2, type: 'absolute' },
          ],
          nextNodeId: 'outcome_acqui_hire_or_shutdown',
        },
      ],
    } as EventNode,

    // Outcomes
    {
      id: 'outcome_pivot_or_quit',
      type: 'outcome',
      results: {
        outcome: 'pivot_or_quit',
        finalCapital: 95000,
        reason: 'weak_validation',
      },
    } as OutcomeNode,

    {
      id: 'outcome_lifestyle_business',
      type: 'outcome',
      results: {
        outcome: 'lifestyle_business',
        finalCapital: 45000,
        monthlyRevenue: 8000,
        reason: 'sustainable_growth',
      },
    } as OutcomeNode,

    {
      id: 'outcome_shutdown',
      type: 'outcome',
      results: {
        outcome: 'shutdown',
        finalCapital: 20000,
        reason: 'market_rejection',
        experienceGained: 'high',
      },
    } as OutcomeNode,

    {
      id: 'outcome_venture_backed',
      type: 'outcome',
      results: {
        outcome: 'venture_backed_startup',
        valuation: 10000000,
        reason: 'product_market_fit',
        nextMilestone: 'series_b_or_exit',
      },
    } as OutcomeNode,

    {
      id: 'outcome_acqui_hire_or_shutdown',
      type: 'outcome',
      results: {
        outcome: 'acqui_hire_or_shutdown',
        finalCapital: 15000,
        reason: 'funding_failure',
      },
    } as OutcomeNode,

    {
      id: 'month12_slow_build',
      type: 'outcome',
      results: {
        outcome: 'slow_build_continue',
        finalCapital: 85000,
        reason: 'caution_pays',
      },
    } as OutcomeNode,
  ];
}

// Career Change Scenario Graph
function buildCareerChangeGraph(): GraphNode[] {
  return [
    {
      id: 'start',
      type: 'decision',
      prompt: 'You want to switch careers. Your current salary is $75k. How do you start?',
      options: [
        { id: 'quit_learn', label: 'Quit job, full-time bootcamp/self-study', value: 'quit_learn', nextNodeId: 'month1_learning' },
        { id: 'side_learn', label: 'Keep job, study nights/weekends', value: 'side_learn', nextNodeId: 'month6_skills' },
        { id: 'network_first', label: 'Focus on networking before skills', value: 'network_first', nextNodeId: 'month3_network' },
      ],
    } as DecisionNode,

    {
      id: 'month1_learning',
      type: 'event',
      name: 'Intensive Learning',
      description: 'Full-time skill acquisition',
      probability: 1.0,
      outcomes: [
        { 
          id: 'learned_fast', 
          label: 'Rapid skill development',
          effects: [
            { target: 'metrics.skillGap', delta: -0.4, type: 'absolute' },
            { target: 'capital', delta: -8000, type: 'absolute' },
            { target: 'metrics.stressLevel', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'month3_job_search',
        },
        { 
          id: 'struggled', 
          label: 'Learning difficulties, anxiety',
          effects: [
            { target: 'metrics.skillGap', delta: -0.2, type: 'absolute' },
            { target: 'capital', delta: -8000, type: 'absolute' },
            { target: 'health', delta: -0.1, type: 'absolute' },
            { target: 'happiness', delta: -0.15, type: 'absolute' },
          ],
          nextNodeId: 'month3_reconsider',
        },
      ],
    } as EventNode,

    {
      id: 'month3_network',
      type: 'event',
      name: 'Networking Progress',
      description: 'Building industry connections',
      probability: 1.0,
      outcomes: [
        { 
          id: 'strong_network', 
          label: 'Built valuable connections',
          effects: [
            { target: 'metrics.networkStrength', delta: 0.4, type: 'absolute' },
            { target: 'capital', delta: -1000, type: 'absolute' },
          ],
          nextNodeId: 'month6_skills',
        },
        { 
          id: 'weak_network', 
          label: 'Limited progress networking',
          effects: [
            { target: 'metrics.networkStrength', delta: 0.1, type: 'absolute' },
          ],
          nextNodeId: 'month6_skills',
        },
      ],
    } as EventNode,

    {
      id: 'month6_skills',
      type: 'event',
      name: 'Skill Assessment',
      description: '6 months of skill building',
      probability: 1.0,
      outcomes: [
        { 
          id: 'job_ready', 
          label: 'Skills sufficient for entry role',
          effects: [
            { target: 'metrics.skillGap', delta: -0.3, type: 'absolute' },
            { target: 'metrics.confidenceLevel', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'month9_job_search',
        },
        { 
          id: 'more_needed', 
          label: 'Still need more development',
          effects: [
            { target: 'metrics.skillGap', delta: -0.15, type: 'absolute' },
          ],
          nextNodeId: 'month9_continue_learning',
        },
      ],
    } as EventNode,

    {
      id: 'month9_job_search',
      type: 'event',
      name: 'Job Search Results',
      description: '3 months of applications and interviews',
      probability: 1.0,
      outcomes: [
        { 
          id: 'got_offer', 
          label: 'Received job offer',
          effects: [
            { target: 'metrics.newSalary', delta: 55000, type: 'absolute' },
            { target: 'happiness', delta: 0.3, type: 'absolute' },
          ],
          nextNodeId: 'outcome_successful_transition',
        },
        { 
          id: 'no_offer', 
          label: 'No offers yet',
          effects: [
            { target: 'happiness', delta: -0.2, type: 'absolute' },
          ],
          nextNodeId: 'month12_persevere',
        },
      ],
    } as EventNode,

    {
      id: 'month12_persevere',
      type: 'decision',
      prompt: '12 months in. Still searching. What do you do?',
      options: [
        { id: 'keep_trying', label: 'Keep applying, lower expectations', value: 'keep_trying', nextNodeId: 'outcome_eventual_success' },
        { id: 'return_old', label: 'Return to previous career', value: 'return_old', nextNodeId: 'outcome_return' },
        { id: 'freelance', label: 'Start freelancing in new field', value: 'freelance', nextNodeId: 'outcome_freelance_path' },
      ],
    } as DecisionNode,

    // Outcomes
    {
      id: 'outcome_successful_transition',
      type: 'outcome',
      results: {
        outcome: 'successful_transition',
        finalSalary: 55000,
        salaryDelta: -20000,
        satisfaction: 'high',
        timeToTransition: 9,
      },
    } as OutcomeNode,

    {
      id: 'outcome_eventual_success',
      type: 'outcome',
      results: {
        outcome: 'eventual_success',
        finalSalary: 50000,
        timeToTransition: 15,
        lessons: 'persistence_matters',
      },
    } as OutcomeNode,

    {
      id: 'outcome_return',
      type: 'outcome',
      results: {
        outcome: 'returned_to_previous',
        finalSalary: 75000,
        experienceGained: 'exploration',
        regret: 'low',
      },
    } as OutcomeNode,

    {
      id: 'outcome_freelance_path',
      type: 'outcome',
      results: {
        outcome: 'freelance_career',
        incomeVariability: 'high',
        autonomy: 'high',
      },
    } as OutcomeNode,

    {
      id: 'month3_reconsider',
      type: 'outcome',
      results: {
        outcome: 'reconsidering_path',
        finalCapital: 22000,
        status: 'evaluating_options',
      },
    } as OutcomeNode,

    {
      id: 'month9_continue_learning',
      type: 'outcome',
      results: {
        outcome: 'continuing_education',
        status: 'skills_in_progress',
      },
    } as OutcomeNode,
  ];
}

// Advanced Degree Scenario Graph
function buildAdvancedDegreeGraph(): GraphNode[] {
  return [
    {
      id: 'start',
      type: 'decision',
      prompt: 'Considering an MBA/MS. Current income: $75k. What is your approach?',
      options: [
        { id: 'full_time', label: 'Full-time program, no income for 2 years', value: 'full_time', nextNodeId: 'year1_academics' },
        { id: 'part_time', label: 'Part-time while working', value: 'part_time', nextNodeId: 'year1_balanced' },
        { id: 'online', label: 'Online program, keep working', value: 'online', nextNodeId: 'year1_flexible' },
      ],
    } as DecisionNode,

    {
      id: 'year1_academics',
      type: 'event',
      name: 'First Year Academics',
      description: 'Intensive full-time study',
      probability: 1.0,
      outcomes: [
        { 
          id: 'excelled', 
          label: 'Top of class performance',
          effects: [
            { target: 'metrics.completionProgress', delta: 0.5, type: 'absolute' },
            { target: 'metrics.skillAcquisition', delta: 0.4, type: 'absolute' },
            { target: 'metrics.networkingValue', delta: 0.3, type: 'absolute' },
            { target: 'capital', delta: -50000, type: 'absolute' },
          ],
          nextNodeId: 'year2_internship',
        },
        { 
          id: 'average', 
          label: 'Solid middle performance',
          effects: [
            { target: 'metrics.completionProgress', delta: 0.5, type: 'absolute' },
            { target: 'metrics.skillAcquisition', delta: 0.25, type: 'absolute' },
            { target: 'capital', delta: -50000, type: 'absolute' },
          ],
          nextNodeId: 'year2_internship',
        },
        { 
          id: 'struggled_degree', 
          label: 'Academic difficulties',
          effects: [
            { target: 'metrics.completionProgress', delta: 0.3, type: 'absolute' },
            { target: 'health', delta: -0.1, type: 'absolute' },
            { target: 'happiness', delta: -0.1, type: 'absolute' },
          ],
          nextNodeId: 'year2_risk_dropout',
        },
      ],
    } as EventNode,

    {
      id: 'year2_internship',
      type: 'event',
      name: 'Summer Internship',
      description: 'Internship placement results',
      probability: 1.0,
      outcomes: [
        { 
          id: 'top_tier', 
          label: 'Prestigious company internship',
          effects: [
            { target: 'metrics.careerAdvancement', delta: 0.5, type: 'absolute' },
            { target: 'capital', delta: 25000, type: 'absolute' },
            { target: 'happiness', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'year2_finish',
        },
        { 
          id: 'average_internship', 
          label: 'Decent internship experience',
          effects: [
            { target: 'metrics.careerAdvancement', delta: 0.2, type: 'absolute' },
            { target: 'capital', delta: 15000, type: 'absolute' },
          ],
          nextNodeId: 'year2_finish',
        },
      ],
    } as EventNode,

    {
      id: 'year2_finish',
      type: 'event',
      name: 'Graduation and Job Market',
      description: 'Job search upon graduation',
      probability: 1.0,
      outcomes: [
        { 
          id: 'great_offer', 
          label: 'High-paying job offer',
          effects: [
            { target: 'metrics.newSalary', delta: 120000, type: 'absolute' },
            { target: 'metrics.careerAdvancement', delta: 0.3, type: 'absolute' },
            { target: 'happiness', delta: 0.3, type: 'absolute' },
          ],
          nextNodeId: 'outcome_degree_success',
        },
        { 
          id: 'modest_offer', 
          label: 'Moderate improvement',
          effects: [
            { target: 'metrics.newSalary', delta: 90000, type: 'absolute' },
          ],
          nextNodeId: 'outcome_degree_moderate',
        },
        { 
          id: 'no_immediate_offer', 
          label: 'Struggling to find role',
          effects: [
            { target: 'happiness', delta: -0.2, type: 'absolute' },
          ],
          nextNodeId: 'outcome_degree_delayed',
        },
      ],
    } as EventNode,

    // Outcomes
    {
      id: 'outcome_degree_success',
      type: 'outcome',
      results: {
        outcome: 'degree_roi_positive',
        finalSalary: 120000,
        salaryIncrease: 45000,
        debtRemaining: 35000,
        paybackPeriod: 18,
      },
    } as OutcomeNode,

    {
      id: 'outcome_degree_moderate',
      type: 'outcome',
      results: {
        outcome: 'degree_roi_break_even',
        finalSalary: 90000,
        salaryIncrease: 15000,
        debtRemaining: 35000,
        paybackPeriod: 48,
      },
    } as OutcomeNode,

    {
      id: 'outcome_degree_delayed',
      type: 'outcome',
      results: {
        outcome: 'degree_roi_delayed',
        jobSearchDuration: 6,
        finalSalary: 0,
        debtRemaining: 50000,
        stressLevel: 'high',
      },
    } as OutcomeNode,

    {
      id: 'year2_risk_dropout',
      type: 'outcome',
      results: {
        outcome: 'at_risk_dropout',
        debtAccumulated: 25000,
        noDegree: true,
      },
    } as OutcomeNode,

    {
      id: 'year1_balanced',
      type: 'outcome',
      results: {
        outcome: 'part_time_progress',
        progressRate: 'slow',
        workLifeBalance: 'challenging',
      },
    } as OutcomeNode,

    {
      id: 'year1_flexible',
      type: 'outcome',
      results: {
        outcome: 'online_progress',
        flexibility: 'high',
        networking: 'limited',
      },
    } as OutcomeNode,
  ];
}

// Geographic Relocation Scenario Graph
function buildGeographicRelocationGraph(): GraphNode[] {
  return [
    {
      id: 'start',
      type: 'decision',
      prompt: 'Considering moving to a new city. What is your primary motivation?',
      options: [
        { id: 'job_opportunity', label: 'Better job opportunities', value: 'job_opportunity', nextNodeId: 'month1_job_search' },
        { id: 'lifestyle', label: 'Lifestyle / climate / culture', value: 'lifestyle', nextNodeId: 'month1_explore' },
        { id: 'cost_of_living', label: 'Lower cost of living', value: 'cost_of_living', nextNodeId: 'month1_financial_plan' },
      ],
    } as DecisionNode,

    {
      id: 'month1_job_search',
      type: 'event',
      name: 'Remote Job Search',
      description: 'Searching for jobs in new city before moving',
      probability: 1.0,
      outcomes: [
        { 
          id: 'job_lined_up', 
          label: 'Secured job before moving',
          effects: [
            { target: 'metrics.salaryDelta', delta: 15000, type: 'absolute' },
            { target: 'metrics.opportunityAccess', delta: 0.4, type: 'absolute' },
          ],
          nextNodeId: 'month3_move',
        },
        { 
          id: 'no_job_yet', 
          label: 'No job secured, moving anyway',
          effects: [
            { target: 'metrics.stressLevel', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'month3_move',
        },
      ],
    } as EventNode,

    {
      id: 'month3_move',
      type: 'event',
      name: 'The Move',
      description: 'Actual relocation and settling in',
      probability: 1.0,
      outcomes: [
        { 
          id: 'smooth_move', 
          label: 'Smooth transition',
          effects: [
            { target: 'capital', delta: -8000, type: 'absolute' },
            { target: 'metrics.adaptationProgress', delta: 0.3, type: 'absolute' },
          ],
          nextNodeId: 'month6_settlement',
        },
        { 
          id: 'difficult_move', 
          label: 'Unexpected costs and stress',
          effects: [
            { target: 'capital', delta: -12000, type: 'absolute' },
            { target: 'health', delta: -0.1, type: 'absolute' },
            { target: 'metrics.socialDisruption', delta: 0.3, type: 'absolute' },
          ],
          nextNodeId: 'month6_settlement',
        },
      ],
    } as EventNode,

    {
      id: 'month6_settlement',
      type: 'event',
      name: '6 Month Check-in',
      description: 'Settling into new environment',
      probability: 1.0,
      outcomes: [
        { 
          id: 'thriving', 
          label: 'Thriving in new city',
          effects: [
            { target: 'happiness', delta: 0.2, type: 'absolute' },
            { target: 'metrics.adaptationProgress', delta: 0.4, type: 'absolute' },
            { target: 'metrics.socialDisruption', delta: -0.2, type: 'absolute' },
          ],
          nextNodeId: 'outcome_relocation_success',
        },
        { 
          id: 'adjusting', 
          label: 'Still adjusting',
          effects: [
            { target: 'metrics.adaptationProgress', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'month12_long_term',
        },
        { 
          id: 'struggling_reloc', 
          label: 'Regretting the move',
          effects: [
            { target: 'happiness', delta: -0.15, type: 'absolute' },
            { target: 'metrics.adaptationProgress', delta: 0.1, type: 'absolute' },
          ],
          nextNodeId: 'month12_move_back',
        },
      ],
    } as EventNode,

    {
      id: 'month12_move_back',
      type: 'decision',
      prompt: 'One year in. Missing home. What do you do?',
      options: [
        { id: 'move_back_home', label: 'Move back to original city', value: 'move_back_home', nextNodeId: 'outcome_return_home' },
        { id: 'stick_it_out', label: 'Give it more time', value: 'stick_it_out', nextNodeId: 'outcome_eventual_adjustment' },
        { id: 'try_third_city', label: 'Try a different city', value: 'try_third_city', nextNodeId: 'outcome_city_hopping' },
      ],
    } as DecisionNode,

    // Outcomes
    {
      id: 'outcome_relocation_success',
      type: 'outcome',
      results: {
        outcome: 'relocation_success',
        satisfaction: 'high',
        financialImpact: 'positive',
        socialNetwork: 'established',
      },
    } as OutcomeNode,

    {
      id: 'outcome_return_home',
      type: 'outcome',
      results: {
        outcome: 'returned_home',
        movingCosts: 20000,
        lesson: 'home_is_where_happiness_is',
      },
    } as OutcomeNode,

    {
      id: 'outcome_eventual_adjustment',
      type: 'outcome',
      results: {
        outcome: 'eventual_adjustment',
        adjustmentPeriod: 18,
        finalSatisfaction: 'moderate',
      },
    } as OutcomeNode,

    {
      id: 'outcome_city_hopping',
      type: 'outcome',
      results: {
        outcome: 'city_hopping',
        totalMovingCosts: 35000,
        searchContinues: true,
      },
    } as OutcomeNode,

    {
      id: 'month1_explore',
      type: 'outcome',
      results: {
        outcome: 'exploration_phase',
        status: 'visiting_exploring',
      },
    } as OutcomeNode,

    {
      id: 'month1_financial_plan',
      type: 'outcome',
      results: {
        outcome: 'financial_planning',
        savingsTarget: 30000,
      },
    } as OutcomeNode,

    {
      id: 'month12_long_term',
      type: 'outcome',
      results: {
        outcome: 'long_term_settling',
        status: 'building_roots',
      },
    } as OutcomeNode,
  ];
}

// Real Estate Purchase Scenario Graph
function buildRealEstatePurchaseGraph(): GraphNode[] {
  return [
    {
      id: 'start',
      type: 'decision',
      prompt: 'You have $100k saved for a home purchase. What do you do?',
      options: [
        { id: 'buy_now', label: 'Buy now with 20% down', value: 'buy_now', nextNodeId: 'month1_search' },
        { id: 'save_more', label: 'Save 1 more year for larger down payment', value: 'save_more', nextNodeId: 'year1_wait' },
        { id: 'rent_invest', label: 'Continue renting, invest the down payment', value: 'rent_invest', nextNodeId: 'year1_invest' },
      ],
    } as DecisionNode,

    {
      id: 'month1_search',
      type: 'event',
      name: 'House Hunting',
      description: 'Searching for the right property',
      probability: 1.0,
      outcomes: [
        { 
          id: 'found_quick', 
          label: 'Found ideal home quickly',
          effects: [
            { target: 'capital', delta: -60000, type: 'absolute' },
            { target: 'metrics.propertyValue', delta: 300000, type: 'absolute' },
          ],
          nextNodeId: 'month3_closing',
        },
        { 
          id: 'long_search', 
          label: 'Extended search, competitive market',
          effects: [
            { target: 'happiness', delta: -0.1, type: 'absolute' },
          ],
          nextNodeId: 'month3_closing',
        },
      ],
    } as EventNode,

    {
      id: 'month3_closing',
      type: 'event',
      name: 'Closing and Move-in',
      description: 'Finalizing purchase and moving',
      probability: 1.0,
      outcomes: [
        { 
          id: 'smooth_close', 
          label: 'Smooth closing process',
          effects: [
            { target: 'capital', delta: -5000, type: 'absolute' }, // closing costs
            { target: 'metrics.monthlyPayment', delta: 1800, type: 'absolute' },
            { target: 'happiness', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'year1_homeownership',
        },
        { 
          id: 'issues_found', 
          label: 'Inspection issues discovered',
          effects: [
            { target: 'capital', delta: -8000, type: 'absolute' },
            { target: 'metrics.maintenanceCost', delta: 3000, type: 'absolute' },
            { target: 'happiness', delta: -0.1, type: 'absolute' },
          ],
          nextNodeId: 'year1_homeownership',
        },
      ],
    } as EventNode,

    {
      id: 'year1_homeownership',
      type: 'event',
      name: 'First Year as Homeowner',
      description: 'Adjusting to ownership responsibilities',
      probability: 1.0,
      outcomes: [
        { 
          id: 'happy_owner', 
          label: 'Love owning, building equity',
          effects: [
            { target: 'metrics.propertyValue', delta: 9000, type: 'absolute' }, // 3% appreciation
            { target: 'happiness', delta: 0.15, type: 'absolute' },
          ],
          nextNodeId: 'year3_appreciation',
        },
        { 
          id: 'stressed_owner', 
          label: 'Maintenance costs higher than expected',
          effects: [
            { target: 'metrics.maintenanceCost', delta: 5000, type: 'absolute' },
            { target: 'capital', delta: -5000, type: 'absolute' },
            { target: 'happiness', delta: -0.1, type: 'absolute' },
          ],
          nextNodeId: 'year3_appreciation',
        },
      ],
    } as EventNode,

    {
      id: 'year3_appreciation',
      type: 'event',
      name: '3-Year Market Performance',
      description: 'Property value changes over 3 years',
      probability: 1.0,
      outcomes: [
        { 
          id: 'good_appreciation', 
          label: 'Strong market, home value up',
          effects: [
            { target: 'metrics.propertyValue', delta: 30000, type: 'absolute' },
          ],
          nextNodeId: 'year5_decision',
        },
        { 
          id: 'flat_market', 
          label: 'Flat market, minimal appreciation',
          effects: [
            { target: 'metrics.propertyValue', delta: 5000, type: 'absolute' },
          ],
          nextNodeId: 'year5_decision',
        },
      ],
    } as EventNode,

    {
      id: 'year5_decision',
      type: 'decision',
      prompt: '5 years of ownership. Home value: ${metrics.propertyValue}. What is next?',
      options: [
        { id: 'stay_long_term', label: 'Continue owning, pay off mortgage', value: 'stay_long_term', nextNodeId: 'outcome_long_term_owner' },
        { id: 'upgrade_home', label: 'Sell and upgrade to larger home', value: 'upgrade_home', nextNodeId: 'outcome_upgraded' },
        { id: 'downsize', label: 'Sell and downsize / relocate', value: 'downsize', nextNodeId: 'outcome_downsized' },
      ],
    } as DecisionNode,

    // Outcomes
    {
      id: 'outcome_long_term_owner',
      type: 'outcome',
      results: {
        outcome: 'long_term_homeowner',
        equityBuilt: 120000,
        netWorthIncrease: 80000,
        satisfaction: 'high',
      },
    } as OutcomeNode,

    {
      id: 'outcome_upgraded',
      type: 'outcome',
      results: {
        outcome: 'upgraded_property',
        saleProceeds: 45000,
        newMortgage: 450000,
        lifestyle: 'upgraded',
      },
    } as OutcomeNode,

    {
      id: 'outcome_downsized',
      type: 'outcome',
      results: {
        outcome: 'downsized_freed_capital',
        saleProceeds: 50000,
        cashFreed: 80000,
        flexibility: 'high',
      },
    } as OutcomeNode,

    {
      id: 'year1_wait',
      type: 'outcome',
      results: {
        outcome: 'saving_for_down_payment',
        additionalSavings: 25000,
        marketChange: 'appreciated_5%',
      },
    } as OutcomeNode,

    {
      id: 'year1_invest',
      type: 'outcome',
      results: {
        outcome: 'renting_investing',
        investmentReturns: 8000,
        flexibility: 'high',
        equity: 0,
      },
    } as OutcomeNode,
  ];
}

// Health & Fitness Goal Scenario Graph
function buildHealthFitnessGraph(): GraphNode[] {
  return [
    {
      id: 'start',
      type: 'decision',
      prompt: 'You want to improve your health/fitness. What is your approach?',
      options: [
        { id: 'gym_membership', label: 'Join gym, structured workout plan', value: 'gym_membership', nextNodeId: 'month1_gym_start' },
        { id: 'home_workouts', label: 'Home workouts, no gym needed', value: 'home_workouts', nextNodeId: 'month1_home_start' },
        { id: 'diet_focus', label: 'Focus primarily on nutrition', value: 'diet_focus', nextNodeId: 'month1_nutrition' },
      ],
    } as DecisionNode,

    {
      id: 'month1_gym_start',
      type: 'event',
      name: 'Gym Routine Establishment',
      description: 'First month of gym consistency',
      probability: 1.0,
      outcomes: [
        { 
          id: 'consistent_gym', 
          label: 'Established 4x/week routine',
          effects: [
            { target: 'metrics.fitnessLevel', delta: 0.15, type: 'absolute' },
            { target: 'metrics.consistency', delta: 0.4, type: 'absolute' },
            { target: 'capital', delta: -150, type: 'absolute' },
            { target: 'health', delta: 0.05, type: 'absolute' },
          ],
          nextNodeId: 'month3_gym_progress',
        },
        { 
          id: 'inconsistent', 
          label: 'Struggled with consistency',
          effects: [
            { target: 'metrics.fitnessLevel', delta: 0.05, type: 'absolute' },
            { target: 'metrics.consistency', delta: 0.15, type: 'absolute' },
            { target: 'capital', delta: -150, type: 'absolute' },
            { target: 'happiness', delta: -0.1, type: 'absolute' },
          ],
          nextNodeId: 'month3_motivation_check',
        },
      ],
    } as EventNode,

    {
      id: 'month3_gym_progress',
      type: 'event',
      name: '3 Month Progress',
      description: 'Strength and endurance improvements',
      probability: 1.0,
      outcomes: [
        { 
          id: 'good_progress', 
          label: 'Visible fitness improvements',
          effects: [
            { target: 'metrics.fitnessLevel', delta: 0.25, type: 'absolute' },
            { target: 'health', delta: 0.1, type: 'absolute' },
            { target: 'metrics.motivationLevel', delta: 0.15, type: 'absolute' },
            { target: 'happiness', delta: 0.15, type: 'absolute' },
          ],
          nextNodeId: 'month6_setback_check',
        },
        { 
          id: 'plateau', 
          label: 'Hit early plateau',
          effects: [
            { target: 'metrics.fitnessLevel', delta: 0.15, type: 'absolute' },
            { target: 'metrics.motivationLevel', delta: -0.1, type: 'absolute' },
          ],
          nextNodeId: 'month6_setback_check',
        },
      ],
    } as EventNode,

    {
      id: 'month6_setback_check',
      type: 'event',
      name: 'Setback Risk',
      description: 'Potential injury or motivation drop',
      probability: 0.3,
      outcomes: [
        { 
          id: 'minor_injury', 
          label: 'Minor injury, 2 week recovery',
          effects: [
            { target: 'metrics.injuryRisk', delta: 0.2, type: 'absolute' },
            { target: 'health', delta: -0.05, type: 'absolute' },
            { target: 'metrics.consistency', delta: -0.15, type: 'absolute' },
          ],
          nextNodeId: 'month9_recovery',
        },
        { 
          id: 'no_setback', 
          label: 'No issues, continuing strong',
          effects: [
            { target: 'metrics.fitnessLevel', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'month12_results',
        },
      ],
    } as EventNode,

    {
      id: 'month12_results',
      type: 'decision',
      prompt: 'One year of consistent effort. Significant improvements. What next?',
      options: [
        { id: 'maintain', label: 'Maintain current level', value: 'maintain', nextNodeId: 'outcome_maintenance' },
        { id: 'push_further', label: 'Set new ambitious goals', value: 'push_further', nextNodeId: 'outcome_continued_growth' },
        { id: 'compete', label: 'Train for competition/event', value: 'compete', nextNodeId: 'outcome_competitor' },
      ],
    } as DecisionNode,

    {
      id: 'month3_motivation_check',
      type: 'decision',
      prompt: '3 months in, inconsistent results. What do you do?',
      options: [
        { id: 'hire_trainer', label: 'Hire personal trainer for accountability', value: 'hire_trainer', nextNodeId: 'month6_with_trainer' },
        { id: 'find_partner', label: 'Find workout partner for motivation', value: 'find_partner', nextNodeId: 'month6_with_partner' },
        { id: 'quit_gym', label: 'Cancel gym, try different approach', value: 'quit_gym', nextNodeId: 'outcome_pivot_fitness' },
      ],
    } as DecisionNode,

    // Outcomes
    {
      id: 'outcome_maintenance',
      type: 'outcome',
      results: {
        outcome: 'healthy_maintenance',
        weightLost: 15,
        fitnessLevel: 0.7,
        healthScore: 0.85,
        sustainability: 'high',
      },
    } as OutcomeNode,

    {
      id: 'outcome_continued_growth',
      type: 'outcome',
      results: {
        outcome: 'continued_improvement',
        weightLost: 25,
        fitnessLevel: 0.85,
        healthScore: 0.9,
        newGoals: 'set',
      },
    } as OutcomeNode,

    {
      id: 'outcome_competitor',
      type: 'outcome',
      results: {
        outcome: 'competitive_athlete',
        event: 'marathon_triathlon',
        fitnessLevel: 0.95,
        dedication: 'elite',
      },
    } as OutcomeNode,

    {
      id: 'outcome_pivot_fitness',
      type: 'outcome',
      results: {
        outcome: 'pivoted_approach',
        newMethod: 'varies',
        lessons: 'accountability_matters',
      },
    } as OutcomeNode,

    {
      id: 'month1_home_start',
      type: 'outcome',
      results: {
        outcome: 'home_workout_started',
        equipmentCost: 500,
        flexibility: 'high',
      },
    } as OutcomeNode,

    {
      id: 'month1_nutrition',
      type: 'outcome',
      results: {
        outcome: 'nutrition_focus',
        dietApproach: 'varies',
        groceryCostDelta: 200,
      },
    } as OutcomeNode,

    {
      id: 'month6_with_trainer',
      type: 'outcome',
      results: {
        outcome: 'trainer_accountability',
        cost: 3000,
        results: 'improved',
      },
    } as OutcomeNode,

    {
      id: 'month6_with_partner',
      type: 'outcome',
      results: {
        outcome: 'partner_motivation',
        consistency: 'improved',
        socialBenefit: 'high',
      },
    } as OutcomeNode,

    {
      id: 'month9_recovery',
      type: 'outcome',
      results: {
        outcome: 'post_injury_recovery',
        downtime: 2,
        resumed: true,
      },
    } as OutcomeNode,
  ];
}

// Custom Scenario (general-purpose template)
function buildCustomGraph(): GraphNode[] {
  return [
    {
      id: 'start',
      type: 'decision',
      prompt: 'You are facing a genuinely hard decision with upside, downside, and incomplete information. How do you structure the initial bet?',
      options: [
        { id: 'full_commit', label: 'Aggressive all-in bet — commit most resources and close backup paths', value: 'full_commit', nextNodeId: 'setup_full_commit' },
        { id: 'barbell_commit', label: 'Cautious barbell strategy — commit meaningfully while preserving a reversible backup plan', value: 'barbell_commit', nextNodeId: 'setup_barbell_commit', requiresEvaluation: true },
        { id: 'test_commit', label: 'Research-first experiment — test the path cheaply before making a hard commitment', value: 'test_commit', nextNodeId: 'setup_test_commit', requiresEvaluation: true },
      ],
    } as DecisionNode,
    {
      id: 'setup_full_commit',
      type: 'event',
      name: 'Concentrated Commitment',
      description: 'You commit heavily up front, increasing speed but burning optionality.',
      probability: 1.0,
      outcomes: [
        {
          id: 'full_commitment_locked',
          label: 'Resources and identity are now tightly tied to this path',
          effects: [
            { target: 'capital', delta: -0.18, type: 'percentage' },
            { target: 'metrics.commitmentLevel', delta: 0.35, type: 'absolute' },
            { target: 'metrics.progressRate', delta: 0.18, type: 'absolute' },
            { target: 'metrics.optionalityPreserved', delta: -0.35, type: 'absolute' },
            { target: 'metrics.burnRate', delta: 0.2, type: 'absolute' },
            { target: 'metrics.reversibility', delta: -0.25, type: 'absolute' },
          ],
          nextNodeId: 'evidence_strategy',
        },
      ],
    } as EventNode,
    {
      id: 'setup_barbell_commit',
      type: 'event',
      name: 'Barbell Commitment',
      description: 'You commit, but keep a fallback path alive in case reality goes against you.',
      probability: 1.0,
      outcomes: [
        {
          id: 'barbell_commitment',
          label: 'Progress starts while key escape hatches remain open',
          effects: [
            { target: 'capital', delta: -0.1, type: 'percentage' },
            { target: 'metrics.commitmentLevel', delta: 0.2, type: 'absolute' },
            { target: 'metrics.progressRate', delta: 0.12, type: 'absolute' },
            { target: 'metrics.optionalityPreserved', delta: -0.1, type: 'absolute' },
            { target: 'metrics.reversibility', delta: 0.1, type: 'absolute' },
          ],
          nextNodeId: 'evidence_strategy',
        },
      ],
    } as EventNode,
    {
      id: 'setup_test_commit',
      type: 'event',
      name: 'Experimental Entry',
      description: 'You keep costs low and use reversible experiments to gather signal.',
      probability: 1.0,
      outcomes: [
        {
          id: 'test_commitment',
          label: 'You trade speed for lower downside and cleaner evidence',
          effects: [
            { target: 'capital', delta: -0.04, type: 'percentage' },
            { target: 'metrics.commitmentLevel', delta: -0.05, type: 'absolute' },
            { target: 'metrics.evidenceQuality', delta: 0.15, type: 'absolute' },
            { target: 'metrics.optionalityPreserved', delta: 0.1, type: 'absolute' },
            { target: 'metrics.reversibility', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'evidence_strategy',
        },
      ],
    } as EventNode,
    {
      id: 'evidence_strategy',
      type: 'decision',
      prompt: 'What do you optimize for while evidence is still noisy?',
      options: [
        { id: 'ship_fast', label: 'Ship fast and learn in public', value: 'ship_fast', nextNodeId: 'market_feedback', requiresEvaluation: true },
        { id: 'run_experiment', label: 'Run a small reversible experiment and gather hard signal', value: 'run_experiment', nextNodeId: 'market_feedback', requiresEvaluation: true },
        { id: 'research_more', label: 'Pause and research competitors, customers, and second-order effects', value: 'research_more', nextNodeId: 'market_feedback', requiresEvaluation: true },
      ],
    } as DecisionNode,
    {
      id: 'market_feedback',
      type: 'event',
      name: 'Market Feedback Window',
      description: 'Reality starts to answer back, but the signal is noisy and easy to misread.',
      probability: 1.0,
      outcomes: [
        {
          id: 'early_traction',
          label: 'A few strong signals suggest the path might work',
          effects: [
            { target: 'capital', delta: 0.08, type: 'percentage' },
            { target: 'happiness', delta: 0.1, type: 'absolute' },
            { target: 'metrics.progressRate', delta: 0.22, type: 'absolute' },
            { target: 'metrics.evidenceQuality', delta: 0.25, type: 'absolute' },
            { target: 'metrics.opportunityAccess', delta: 0.15, type: 'absolute' },
            { target: 'metrics.convictionStability', delta: 0.12, type: 'absolute' },
          ],
          nextNodeId: 'pressure_response',
        },
        {
          id: 'mixed_signal',
          label: 'Results are mixed and easy to rationalize either way',
          effects: [
            { target: 'capital', delta: -0.08, type: 'percentage' },
            { target: 'happiness', delta: -0.05, type: 'absolute' },
            { target: 'metrics.progressRate', delta: 0.08, type: 'absolute' },
            { target: 'metrics.evidenceQuality', delta: 0.18, type: 'absolute' },
            { target: 'metrics.socialPressure', delta: 0.1, type: 'absolute' },
            { target: 'metrics.convictionStability', delta: -0.08, type: 'absolute' },
          ],
          nextNodeId: 'pressure_response',
        },
        {
          id: 'weak_demand',
          label: 'Weak demand and execution friction expose flaws in the plan',
          effects: [
            { target: 'capital', delta: -0.14, type: 'percentage' },
            { target: 'happiness', delta: -0.12, type: 'absolute' },
            { target: 'metrics.progressRate', delta: -0.04, type: 'absolute' },
            { target: 'metrics.setbackCount', delta: 1, type: 'absolute' },
            { target: 'metrics.evidenceQuality', delta: 0.12, type: 'absolute' },
            { target: 'metrics.convictionStability', delta: -0.15, type: 'absolute' },
          ],
          nextNodeId: 'pressure_response',
        },
      ],
    } as EventNode,
    {
      id: 'pressure_response',
      type: 'decision',
      prompt: 'The signal is no longer abstract. Do you double down, pivot, or preserve runway?',
      options: [
        { id: 'double_down', label: 'Double down — spend more and push harder now', value: 'double_down', nextNodeId: 'double_down_setup', requiresEvaluation: true },
        { id: 'pivot', label: 'Pivot — keep the mission but change the approach based on evidence', value: 'pivot', nextNodeId: 'pivot_setup', requiresEvaluation: true },
        { id: 'preserve_runway', label: 'Preserve runway — cut burn, slow down, and keep options alive', value: 'preserve_runway', nextNodeId: 'preserve_runway_setup', requiresEvaluation: true },
      ],
    } as DecisionNode,
    {
      id: 'double_down_setup',
      type: 'event',
      name: 'Escalation',
      description: 'You increase commitment under uncertainty.',
      probability: 1.0,
      outcomes: [
        {
          id: 'double_down_effect',
          label: 'Speed increases, but so do downside and identity costs',
          effects: [
            { target: 'capital', delta: -0.18, type: 'percentage' },
            { target: 'metrics.commitmentLevel', delta: 0.22, type: 'absolute' },
            { target: 'metrics.progressRate', delta: 0.14, type: 'absolute' },
            { target: 'metrics.optionalityPreserved', delta: -0.18, type: 'absolute' },
            { target: 'metrics.burnRate', delta: 0.18, type: 'absolute' },
            { target: 'metrics.reversibility', delta: -0.18, type: 'absolute' },
          ],
          nextNodeId: 'pressure_builds',
        },
      ],
    } as EventNode,
    {
      id: 'pivot_setup',
      type: 'event',
      name: 'Adaptive Pivot',
      description: 'You accept that the original framing was wrong and change course.',
      probability: 1.0,
      outcomes: [
        {
          id: 'pivot_effect',
          label: 'You give up some speed for a higher-quality path',
          effects: [
            { target: 'capital', delta: -0.1, type: 'percentage' },
            { target: 'metrics.adaptationScore', delta: 0.3, type: 'absolute' },
            { target: 'metrics.evidenceQuality', delta: 0.18, type: 'absolute' },
            { target: 'metrics.progressRate', delta: -0.03, type: 'absolute' },
            { target: 'metrics.optionalityPreserved', delta: 0.08, type: 'absolute' },
            { target: 'metrics.reversibility', delta: 0.12, type: 'absolute' },
          ],
          nextNodeId: 'pressure_builds',
        },
      ],
    } as EventNode,
    {
      id: 'preserve_runway_setup',
      type: 'event',
      name: 'Runway Preservation',
      description: 'You deliberately reduce burn and avoid irreversible moves.',
      probability: 1.0,
      outcomes: [
        {
          id: 'runway_preserved',
          label: 'The pace slows, but downside becomes more survivable',
          effects: [
            { target: 'capital', delta: -0.04, type: 'percentage' },
            { target: 'metrics.optionalityPreserved', delta: 0.18, type: 'absolute' },
            { target: 'metrics.burnRate', delta: -0.08, type: 'absolute' },
            { target: 'metrics.commitmentLevel', delta: -0.08, type: 'absolute' },
            { target: 'metrics.reversibility', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'pressure_builds',
        },
      ],
    } as EventNode,
    {
      id: 'pressure_builds',
      type: 'event',
      name: 'Pressure Builds',
      description: 'Social expectations, hidden costs, and time pressure begin to matter.',
      probability: 1.0,
      outcomes: [
        {
          id: 'unexpected_setback',
          label: 'An unexpected setback creates urgency and visible doubt',
          effects: [
            { target: 'capital', delta: -0.15, type: 'percentage' },
            { target: 'health', delta: -0.05, type: 'absolute' },
            { target: 'happiness', delta: -0.1, type: 'absolute' },
            { target: 'metrics.setbackCount', delta: 1, type: 'absolute' },
            { target: 'metrics.socialPressure', delta: 0.15, type: 'absolute' },
            { target: 'metrics.runwayMonths', delta: -3, type: 'absolute' },
          ],
          nextNodeId: 'final_tradeoff',
        },
        {
          id: 'hidden_costs',
          label: 'Hidden costs and second-order effects arrive late',
          effects: [
            { target: 'capital', delta: -0.12, type: 'percentage' },
            { target: 'metrics.burnRate', delta: 0.12, type: 'absolute' },
            { target: 'metrics.optionalityPreserved', delta: -0.08, type: 'absolute' },
            { target: 'metrics.setbackCount', delta: 1, type: 'absolute' },
            { target: 'metrics.socialPressure', delta: 0.08, type: 'absolute' },
          ],
          nextNodeId: 'final_tradeoff',
        },
        {
          id: 'supportive_momentum',
          label: 'Useful support and momentum buy you time and confidence',
          effects: [
            { target: 'capital', delta: 0.06, type: 'percentage' },
            { target: 'happiness', delta: 0.08, type: 'absolute' },
            { target: 'health', delta: 0.04, type: 'absolute' },
            { target: 'metrics.opportunityAccess', delta: 0.15, type: 'absolute' },
            { target: 'metrics.convictionStability', delta: 0.12, type: 'absolute' },
          ],
          nextNodeId: 'final_tradeoff',
        },
      ],
    } as EventNode,
    {
      id: 'final_tradeoff',
      type: 'decision',
      prompt: 'Under accumulated pressure, which tradeoff do you choose at the critical moment?',
      options: [
        { id: 'scale', label: 'Scale aggressively — spend now to capture the window', value: 'scale', nextNodeId: 'scale_setup', requiresEvaluation: true },
        { id: 'consolidate', label: 'Consolidate cautiously — tighten scope and improve execution', value: 'consolidate', nextNodeId: 'consolidate_setup', requiresEvaluation: true },
        { id: 'retreat', label: 'Strategic retreat — pause the bet and preserve optionality', value: 'retreat', nextNodeId: 'retreat_setup', requiresEvaluation: true },
      ],
    } as DecisionNode,
    {
      id: 'scale_setup',
      type: 'event',
      name: 'Aggressive Scaling',
      description: 'You spend for speed and commit harder than before.',
      probability: 1.0,
      outcomes: [
        {
          id: 'scale_effect',
          label: 'Upside increases, but fragility does too',
          effects: [
            { target: 'capital', delta: -0.22, type: 'percentage' },
            { target: 'metrics.progressRate', delta: 0.18, type: 'absolute' },
            { target: 'metrics.commitmentLevel', delta: 0.18, type: 'absolute' },
            { target: 'metrics.optionalityPreserved', delta: -0.18, type: 'absolute' },
            { target: 'metrics.burnRate', delta: 0.2, type: 'absolute' },
            { target: 'metrics.executionQuality', delta: -0.05, type: 'absolute' },
          ],
          nextNodeId: 'final_resolution',
        },
      ],
    } as EventNode,
    {
      id: 'consolidate_setup',
      type: 'event',
      name: 'Focused Consolidation',
      description: 'You narrow scope and improve execution instead of chasing maximum upside.',
      probability: 1.0,
      outcomes: [
        {
          id: 'consolidate_effect',
          label: 'Execution quality rises while burn falls',
          effects: [
            { target: 'capital', delta: -0.08, type: 'percentage' },
            { target: 'metrics.executionQuality', delta: 0.22, type: 'absolute' },
            { target: 'metrics.adaptationScore', delta: 0.12, type: 'absolute' },
            { target: 'metrics.evidenceQuality', delta: 0.1, type: 'absolute' },
            { target: 'metrics.burnRate', delta: -0.06, type: 'absolute' },
          ],
          nextNodeId: 'final_resolution',
        },
      ],
    } as EventNode,
    {
      id: 'retreat_setup',
      type: 'event',
      name: 'Strategic Retreat',
      description: 'You deliberately give up some upside to avoid irreversible damage.',
      probability: 1.0,
      outcomes: [
        {
          id: 'retreat_effect',
          label: 'The opportunity shrinks, but optionality and survivability increase',
          effects: [
            { target: 'capital', delta: -0.03, type: 'percentage' },
            { target: 'metrics.optionalityPreserved', delta: 0.2, type: 'absolute' },
            { target: 'metrics.adaptationScore', delta: 0.14, type: 'absolute' },
            { target: 'metrics.commitmentLevel', delta: -0.14, type: 'absolute' },
            { target: 'metrics.reversibility', delta: 0.2, type: 'absolute' },
          ],
          nextNodeId: 'final_resolution',
        },
      ],
    } as EventNode,
    {
      id: 'final_resolution',
      type: 'event',
      name: 'Final Resolution',
      description: 'The bet resolves with a mix of execution quality, luck, and adaptability.',
      probability: 1.0,
      outcomes: [
        {
          id: 'durable_success',
          label: 'The path compounds into a durable win',
          effects: [
            { target: 'capital', delta: 0.2, type: 'percentage' },
            { target: 'happiness', delta: 0.15, type: 'absolute' },
            { target: 'metrics.progressRate', delta: 0.25, type: 'absolute' },
            { target: 'metrics.evidenceQuality', delta: 0.12, type: 'absolute' },
            { target: 'metrics.executionQuality', delta: 0.15, type: 'absolute' },
          ],
          nextNodeId: 'outcome_durable_success',
        },
        {
          id: 'fragile_win',
          label: 'You get a win, but it is narrow and costly',
          effects: [
            { target: 'capital', delta: 0.05, type: 'percentage' },
            { target: 'happiness', delta: 0.05, type: 'absolute' },
            { target: 'metrics.progressRate', delta: 0.12, type: 'absolute' },
            { target: 'metrics.burnRate', delta: 0.08, type: 'absolute' },
            { target: 'metrics.optionalityPreserved', delta: -0.08, type: 'absolute' },
          ],
          nextNodeId: 'outcome_fragile_win',
        },
        {
          id: 'contained_failure',
          label: 'The bet fails, but losses stay survivable and teach you something',
          effects: [
            { target: 'capital', delta: -0.1, type: 'percentage' },
            { target: 'happiness', delta: -0.05, type: 'absolute' },
            { target: 'metrics.adaptationScore', delta: 0.22, type: 'absolute' },
            { target: 'metrics.optionalityPreserved', delta: 0.16, type: 'absolute' },
            { target: 'metrics.setbackCount', delta: 1, type: 'absolute' },
          ],
          nextNodeId: 'outcome_contained_failure',
        },
        {
          id: 'exhausted_collapse',
          label: 'Costs compound faster than learning and the path collapses',
          effects: [
            { target: 'capital', delta: -0.22, type: 'percentage' },
            { target: 'happiness', delta: -0.2, type: 'absolute' },
            { target: 'health', delta: -0.1, type: 'absolute' },
            { target: 'metrics.socialPressure', delta: 0.18, type: 'absolute' },
            { target: 'metrics.setbackCount', delta: 2, type: 'absolute' },
          ],
          nextNodeId: 'outcome_exhausted_collapse',
        },
      ],
    } as EventNode,
    {
      id: 'outcome_durable_success',
      type: 'outcome',
      results: {
        outcome: 'durable_success',
        adaptationScore: 0.8,
        commitmentLevel: 0.9,
        optionalityPreserved: 0.55,
        executionQuality: 0.85,
      },
    } as OutcomeNode,
    {
      id: 'outcome_fragile_win',
      type: 'outcome',
      results: {
        outcome: 'fragile_win',
        adaptationScore: 0.55,
        commitmentLevel: 0.85,
        optionalityPreserved: 0.35,
        executionQuality: 0.6,
      },
    } as OutcomeNode,
    {
      id: 'outcome_contained_failure',
      type: 'outcome',
      results: {
        outcome: 'contained_failure',
        adaptationScore: 0.7,
        commitmentLevel: 0.45,
        optionalityPreserved: 0.85,
        executionQuality: 0.55,
      },
    } as OutcomeNode,
    {
      id: 'outcome_exhausted_collapse',
      type: 'outcome',
      results: {
        outcome: 'exhausted_collapse',
        adaptationScore: 0.2,
        commitmentLevel: 0.9,
        optionalityPreserved: 0.15,
        executionQuality: 0.35,
      },
    } as OutcomeNode,
  ];
}

// Get full scenario definition
export function getScenario(scenarioType: string): Scenario {
  const graph = buildDecisionGraph(scenarioType);
  const initialState = getInitialState(scenarioType);
  
  const scenarioNames: Record<string, string> = {
    [ScenarioType.DAY_TRADING]: 'Day Trading Career',
    [ScenarioType.STARTUP_FOUNDING]: 'Startup Founding',
    [ScenarioType.CAREER_CHANGE]: 'Career Change',
    [ScenarioType.ADVANCED_DEGREE]: 'Advanced Degree',
    [ScenarioType.GEOGRAPHIC_RELOCATION]: 'Geographic Relocation',
    [ScenarioType.REAL_ESTATE_PURCHASE]: 'Real Estate Purchase',
    [ScenarioType.HEALTH_FITNESS_GOAL]: 'Health & Fitness Goal',
    [ScenarioType.CUSTOM]: 'Custom Scenario',
  };

  const scenarioTimeframes: Record<string, string> = {
    [ScenarioType.DAY_TRADING]: '12-24 months',
    [ScenarioType.STARTUP_FOUNDING]: '36-60 months',
    [ScenarioType.CAREER_CHANGE]: '12-24 months',
    [ScenarioType.ADVANCED_DEGREE]: '24-48 months',
    [ScenarioType.GEOGRAPHIC_RELOCATION]: '12-36 months',
    [ScenarioType.REAL_ESTATE_PURCHASE]: '60-120 months',
    [ScenarioType.HEALTH_FITNESS_GOAL]: '6-18 months',
    [ScenarioType.CUSTOM]: 'variable',
  };

  return {
    id: scenarioType,
    name: scenarioNames[scenarioType] || scenarioType,
    description: `Monte Carlo simulation for ${scenarioNames[scenarioType] || scenarioType}`,
    timeframe: scenarioTimeframes[scenarioType] || '12 months',
    initialState,
    graph,
    entryNodeId: 'start',
  };
}

// Find node by ID in graph
export function findNode(graph: GraphNode[], nodeId: string): GraphNode | undefined {
  return graph.find(node => node.id === nodeId);
}

// Get next node
export function getNextNode(graph: GraphNode[], currentNodeId: string, choiceId?: string): GraphNode | null {
  const currentNode = findNode(graph, currentNodeId);
  if (!currentNode) return null;

  if (currentNode.type === 'decision' && choiceId) {
    const option = currentNode.options.find(opt => opt.id === choiceId);
    if (option) {
      return findNode(graph, option.nextNodeId) || null;
    }
  } else if (currentNode.type === 'event') {
    // For events, we would probabilistically select outcome
    // For now return first outcome's next node
    if (currentNode.outcomes.length > 0) {
      return findNode(graph, currentNode.outcomes[0].nextNodeId) || null;
    }
  }

  return null;
}

// Check if node is terminal
export function isTerminalNode(node: GraphNode): boolean {
  return node.type === 'outcome';
}

// Apply outcome effects to state
export function applyEffects(state: SimulationState, effects: OutcomeEffect[]): SimulationState {
  return applyEffectsToState(state, effects);
}

// Determine outcome category based on final state
export function categorizeOutcome(state: SimulationState, scenarioType: string): 'success' | 'failure' | 'neutral' {
  switch (scenarioType) {
    case ScenarioType.DAY_TRADING:
      // Success if capital increased or happiness maintained
      if (state.capital > 50000 || state.happiness > 0.6) return 'success';
      if (state.capital < 30000 || state.happiness < 0.3) return 'failure';
      return 'neutral';
    
    case ScenarioType.STARTUP_FOUNDING:
      // Success if positive metrics or maintained capital
      const revenue = typeof state.metrics.revenue === 'number' ? state.metrics.revenue : 0;
      if (revenue > 10000 || state.capital > 80000) return 'success';
      if (state.capital < 20000 && revenue === 0) return 'failure';
      return 'neutral';
    
    case ScenarioType.CAREER_CHANGE:
      // Success based on happiness and skill progress
      const confidence = typeof state.metrics.confidenceLevel === 'number' ? state.metrics.confidenceLevel : 0;
      if (state.happiness > 0.6 || confidence > 0.7) return 'success';
      if (state.happiness < 0.3) return 'failure';
      return 'neutral';
    
    case ScenarioType.ADVANCED_DEGREE:
      // Success if completion progress good or salary increase
      const completion = typeof state.metrics.completionProgress === 'number' ? state.metrics.completionProgress : 0;
      const newSalary = typeof state.metrics.newSalary === 'number' ? state.metrics.newSalary : 0;
      if (completion > 0.7 || newSalary > 80000) return 'success';
      if (completion < 0.3 && state.capital < -40000) return 'failure';
      return 'neutral';
    
    case ScenarioType.GEOGRAPHIC_RELOCATION:
      // Success based on happiness and adaptation
      const adaptation = typeof state.metrics.adaptationProgress === 'number' ? state.metrics.adaptationProgress : 0;
      if (state.happiness > 0.6 || adaptation > 0.5) return 'success';
      if (state.happiness < 0.3 && adaptation < 0.2) return 'failure';
      return 'neutral';
    
    case ScenarioType.REAL_ESTATE_PURCHASE:
      // Success if property value increased or happiness good
      const propertyValue = typeof state.metrics.propertyValue === 'number' ? state.metrics.propertyValue : 0;
      if (propertyValue > 310000 || state.happiness > 0.6) return 'success';
      if (state.capital < 20000 && state.happiness < 0.4) return 'failure';
      return 'neutral';
    
    case ScenarioType.HEALTH_FITNESS_GOAL:
      // Success based on fitness level and health
      const fitnessLevel = typeof state.metrics.fitnessLevel === 'number' ? state.metrics.fitnessLevel : 0;
      const consistency = typeof state.metrics.consistency === 'number' ? state.metrics.consistency : 0;
      if (fitnessLevel > 0.6 || state.health > 0.8) return 'success';
      if (fitnessLevel < 0.3 && consistency < 0.2) return 'failure';
      return 'neutral';

    case ScenarioType.CUSTOM: {
      const initialState = getInitialState(ScenarioType.CUSTOM);
      const capitalPreservation = initialState.capital > 0
        ? state.capital / initialState.capital
        : state.capital >= 0 ? 1 : 0;
      const happinessDrop = initialState.happiness - state.happiness;
      const progressRate = typeof state.metrics.progressRate === 'number' ? state.metrics.progressRate : 0;
      const adaptationScore = typeof state.metrics.adaptationScore === 'number' ? state.metrics.adaptationScore : 0;
      const optionalityPreserved = typeof state.metrics.optionalityPreserved === 'number'
        ? state.metrics.optionalityPreserved
        : 0;
      const evidenceQuality = typeof state.metrics.evidenceQuality === 'number' ? state.metrics.evidenceQuality : 0;
      const executionQuality = typeof state.metrics.executionQuality === 'number' ? state.metrics.executionQuality : 0;
      const burnRate = typeof state.metrics.burnRate === 'number' ? state.metrics.burnRate : 0;
      const setbackCount = typeof state.metrics.setbackCount === 'number' ? state.metrics.setbackCount : 0;
      const reversibility = typeof state.metrics.reversibility === 'number' ? state.metrics.reversibility : 0;

      if (state.outcome === 'exhausted_collapse') return 'failure';
      if (state.outcome === 'durable_success') return 'success';
      if (state.outcome === 'contained_failure' && adaptationScore >= 0.6 && optionalityPreserved >= 0.7) {
        return 'neutral';
      }

      if (
        capitalPreservation <= 0.55 ||
        state.happiness <= 0.42 ||
        state.health <= 0.45 ||
        happinessDrop >= 0.22 ||
        (burnRate >= 0.7 && progressRate <= 0.3) ||
        (setbackCount >= 3 && optionalityPreserved <= 0.4)
      ) {
        return 'failure';
      }

      if (
        capitalPreservation >= 0.8 &&
        state.happiness >= 0.62 &&
        progressRate >= 0.45 &&
        (adaptationScore >= 0.55 || evidenceQuality >= 0.6) &&
        (executionQuality >= 0.58 || optionalityPreserved >= 0.72) &&
        reversibility >= 0.35
      ) {
        return 'success';
      }

      return 'neutral';
    }
    
    default:
      if (state.capital < 0 || state.happiness < 0.3) return 'failure';
      if (state.capital > 0 && state.happiness > 0.6) return 'success';
      return 'neutral';
  }
}

// Export scenario type enum for external use
export { ScenarioType };

// Get all available scenarios
export function getAllScenarios(): Array<{ id: string; name: string; timeframe: string }> {
  return [
    { id: ScenarioType.DAY_TRADING, name: 'Day Trading Career', timeframe: '12-24 months' },
    { id: ScenarioType.STARTUP_FOUNDING, name: 'Startup Founding', timeframe: '36-60 months' },
    { id: ScenarioType.CAREER_CHANGE, name: 'Career Change', timeframe: '12-24 months' },
    { id: ScenarioType.ADVANCED_DEGREE, name: 'Advanced Degree', timeframe: '24-48 months' },
    { id: ScenarioType.GEOGRAPHIC_RELOCATION, name: 'Geographic Relocation', timeframe: '12-36 months' },
    { id: ScenarioType.REAL_ESTATE_PURCHASE, name: 'Real Estate Purchase', timeframe: '60-120 months' },
    { id: ScenarioType.HEALTH_FITNESS_GOAL, name: 'Health & Fitness Goal', timeframe: '6-18 months' },
    { id: ScenarioType.CUSTOM, name: 'Custom Scenario', timeframe: 'variable' },
  ];
}

// Validate scenario exists
export function isValidScenario(scenarioType: string): boolean {
  return Object.values(ScenarioType).includes(scenarioType as ScenarioType);
}
