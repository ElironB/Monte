import OpenAI from 'openai';
import { AggregatedResults } from './types.js';
import { BehavioralSignal } from '../ingestion/types.js';
import { BehavioralDimensions } from '../persona/dimensionMapper.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface NarrativeResult {
  executiveSummary: string;
  outcomeAnalysis: string;
  behavioralDrivers: string;
  riskFactors: string;
  contradictionInsights: string;
  recommendation: string;
}

interface SignalSummary {
  value: string;
  type: string;
  confidence: number;
  frequency: number;
  trend: string;
  evidence: string;
}

const NARRATIVE_SECTIONS = [
  'executive_summary',
  'outcome_analysis',
  'behavioral_drivers',
  'risk_factors',
  'contradiction_insights',
  'recommendation',
] as const;

const SYSTEM_PROMPT = `You are Monte's narrative analysis engine. Monte is a probabilistic life simulation engine that creates 1,000 behavioral clones of a person, runs them through realistic life scenarios using Monte Carlo simulation, and aggregates the outcomes to predict probable futures.

Your job is to interpret simulation results and behavioral signals into clear, insightful narrative analysis. Write in second person ("you", "your") addressing the person whose data was analyzed. Be direct, evidence-based, and specific — cite actual numbers and behavioral signals. Avoid generic advice; ground every insight in the data provided.

You must respond with EXACTLY these 6 sections, each preceded by its header on its own line:

EXECUTIVE_SUMMARY
(2-3 sentences summarizing the overall simulation outcome and what it means)

OUTCOME_ANALYSIS
(What the numbers mean in plain English — translate statistics into human-readable insight)

BEHAVIORAL_DRIVERS
(Which specific behavioral signals drove the outcome and why — connect signals to results)

RISK_FACTORS
(Key risks identified from the simulation — what could go wrong and how likely)

CONTRADICTION_INSIGHTS
(How behavioral contradictions affected results — where stated intentions diverge from revealed behavior)

RECOMMENDATION
(Actionable takeaway based on the data — not financial advice, just behavioral insight)`;

export class NarrativeGenerator {
  private client: OpenAI | null = null;
  private model: string;

  constructor() {
    if (config.llm?.apiKey) {
      this.client = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl || 'https://api.groq.com/openai/v1',
      });
      this.model = config.llm.model || 'llama-3.1-70b-versatile';
    } else {
      this.model = '';
    }
  }

  async generate(
    results: AggregatedResults,
    signals: BehavioralSignal[],
    dimensions: BehavioralDimensions,
    scenarioType: string,
  ): Promise<NarrativeResult> {
    if (!this.client) {
      return this.generateFallbackNarrative(results, signals, dimensions, scenarioType);
    }

    try {
      const userMessage = this.buildUserMessage(results, signals, dimensions, scenarioType);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        logger.warn('LLM returned empty response for narrative, using fallback');
        return this.generateFallbackNarrative(results, signals, dimensions, scenarioType);
      }

      const parsed = this.parseResponse(content);
      if (parsed) return parsed;

      logger.warn('Failed to parse LLM narrative response, using fallback');
      return this.generateFallbackNarrative(results, signals, dimensions, scenarioType);
    } catch (error) {
      logger.error({ error }, 'Narrative generation LLM call failed, using fallback');
      return this.generateFallbackNarrative(results, signals, dimensions, scenarioType);
    }
  }

  buildUserMessage(
    results: AggregatedResults,
    signals: BehavioralSignal[],
    dimensions: BehavioralDimensions,
    scenarioType: string,
  ): string {
    const { statistics, outcomeDistribution, stratifiedBreakdown } = results;
    const topSignals = this.getTopSignals(signals, 15);
    const contradictions = this.detectContradictionPairs(signals);

    const signalList = topSignals
      .map(
        (s) =>
          `- ${s.type}: "${s.value}" (confidence: ${(s.confidence * 100).toFixed(0)}%, frequency: ${s.frequency}, trend: ${s.trend}) — ${s.evidence}`,
      )
      .join('\n');

    const contradictionList =
      contradictions.length > 0
        ? contradictions.map((c) => `- ${c.description}`).join('\n')
        : 'No significant contradictions detected.';

    return `SCENARIO: ${scenarioType.replace(/_/g, ' ')}

OUTCOME DISTRIBUTION:
- Success: ${(outcomeDistribution.success * 100).toFixed(1)}%
- Failure: ${(outcomeDistribution.failure * 100).toFixed(1)}%
- Neutral: ${(outcomeDistribution.neutral * 100).toFixed(1)}%

STATISTICS:
- Mean Capital: $${statistics.meanCapital.toFixed(0)}
- Median Capital: $${statistics.medianCapital.toFixed(0)}
- Mean Health: ${(statistics.meanHealth * 100).toFixed(0)}%
- Mean Happiness: ${(statistics.meanHappiness * 100).toFixed(0)}%
- Success Rate: ${(statistics.successRate * 100).toFixed(1)}%
- Average Duration: ${statistics.averageDuration.toFixed(1)} months

STRATIFIED BREAKDOWN:
- Edge clones (extreme behavior): ${stratifiedBreakdown.edge.count} clones, avg outcome ${stratifiedBreakdown.edge.avgOutcome.toFixed(2)}
- Typical clones: ${stratifiedBreakdown.typical.count} clones, avg outcome ${stratifiedBreakdown.typical.avgOutcome.toFixed(2)}
- Central clones (moderate behavior): ${stratifiedBreakdown.central.count} clones, avg outcome ${stratifiedBreakdown.central.avgOutcome.toFixed(2)}

BEHAVIORAL DIMENSIONS:
- Risk Tolerance: ${dimensions.riskTolerance.toFixed(2)} (${this.labelDimension(dimensions.riskTolerance, 'conservative', 'risk-seeking')})
- Time Preference: ${dimensions.timePreference.toFixed(2)} (${this.labelDimension(dimensions.timePreference, 'delayed gratification', 'immediate gratification')})
- Social Dependency: ${dimensions.socialDependency.toFixed(2)} (${this.labelDimension(dimensions.socialDependency, 'independent', 'group-oriented')})
- Learning Style: ${dimensions.learningStyle.toFixed(2)} (${this.labelDimension(dimensions.learningStyle, 'experiential', 'theoretical')})
- Decision Speed: ${dimensions.decisionSpeed.toFixed(2)} (${this.labelDimension(dimensions.decisionSpeed, 'deliberative', 'impulsive')})
- Emotional Volatility: ${dimensions.emotionalVolatility.toFixed(2)} (${this.labelDimension(dimensions.emotionalVolatility, 'stable', 'reactive')})

TOP BEHAVIORAL SIGNALS (${topSignals.length}):
${signalList}

DETECTED CONTRADICTIONS:
${contradictionList}

Analyze these results and provide the 6 narrative sections.`;
  }

  getTopSignals(signals: BehavioralSignal[], n: number): SignalSummary[] {
    const scored = signals.map((s) => ({
      signal: s,
      score: s.confidence * (1 + (s.dimensions.frequency || 0) * 0.1),
    }));

    scored.sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const result: SignalSummary[] = [];

    for (const { signal } of scored) {
      const key = `${signal.type}:${signal.value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      result.push({
        value: signal.value,
        type: signal.type,
        confidence: signal.confidence,
        frequency: signal.dimensions.frequency || 0,
        trend: signal.dimensions.intensityTrend || 'stable',
        evidence: signal.evidence,
      });

      if (result.length >= n) break;
    }

    return result;
  }

  detectContradictionPairs(
    signals: BehavioralSignal[],
  ): { description: string; signalA: string; signalB: string }[] {
    const contradictions: { description: string; signalA: string; signalB: string }[] = [];
    const values = new Set(signals.map((s) => s.value));

    const pairs: [string, string, string][] = [
      ['goal_oriented', 'budget_struggles', 'Goal-oriented mindset but persistent budget struggles suggest execution gap between intention and action'],
      ['high_risk_tolerance', 'anxiety', 'High risk tolerance paired with anxiety signals indicates internal conflict between desired risk profile and emotional capacity'],
      ['patient', 'impulse_spending', 'Patience as a stated trait contradicts impulse spending behavior — revealed preferences diverge from self-image'],
      ['educational_content', 'high_risk_tolerance', 'Interest in educational content suggests analytical approach, but high risk tolerance indicates decisions may bypass that analysis'],
    ];

    for (const [a, b, description] of pairs) {
      if (values.has(a) && values.has(b)) {
        contradictions.push({ description, signalA: a, signalB: b });
      }
    }

    return contradictions;
  }

  parseResponse(content: string): NarrativeResult | null {
    const sections: Record<string, string> = {};

    const headers = [
      'EXECUTIVE_SUMMARY',
      'OUTCOME_ANALYSIS',
      'BEHAVIORAL_DRIVERS',
      'RISK_FACTORS',
      'CONTRADICTION_INSIGHTS',
      'RECOMMENDATION',
    ];

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const nextHeader = headers[i + 1];

      const startPattern = new RegExp(`${header}\\s*\\n`, 'i');
      const startMatch = content.match(startPattern);
      if (!startMatch || startMatch.index === undefined) continue;

      const startIdx = startMatch.index + startMatch[0].length;
      let endIdx = content.length;

      if (nextHeader) {
        const endPattern = new RegExp(`${nextHeader}\\s*\\n`, 'i');
        const endMatch = content.slice(startIdx).match(endPattern);
        if (endMatch && endMatch.index !== undefined) {
          endIdx = startIdx + endMatch.index;
        }
      }

      sections[header] = content.slice(startIdx, endIdx).trim();
    }

    const foundCount = Object.keys(sections).length;
    if (foundCount < 3) return null;

    return {
      executiveSummary: sections['EXECUTIVE_SUMMARY'] || '',
      outcomeAnalysis: sections['OUTCOME_ANALYSIS'] || '',
      behavioralDrivers: sections['BEHAVIORAL_DRIVERS'] || '',
      riskFactors: sections['RISK_FACTORS'] || '',
      contradictionInsights: sections['CONTRADICTION_INSIGHTS'] || '',
      recommendation: sections['RECOMMENDATION'] || '',
    };
  }

  labelDimension(value: number, lowLabel: string, highLabel: string): string {
    if (value < 0.3) return `strongly ${lowLabel}`;
    if (value < 0.45) return `leaning ${lowLabel}`;
    if (value <= 0.55) return 'neutral';
    if (value <= 0.7) return `leaning ${highLabel}`;
    return `strongly ${highLabel}`;
  }

  generateFallbackNarrative(
    results: AggregatedResults,
    signals: BehavioralSignal[],
    dimensions: BehavioralDimensions,
    scenarioType: string,
  ): NarrativeResult {
    const { statistics, outcomeDistribution, stratifiedBreakdown } = results;
    const topSignals = this.getTopSignals(signals, 5);
    const contradictions = this.detectContradictionPairs(signals);
    const scenario = scenarioType.replace(/_/g, ' ');

    const successPct = (outcomeDistribution.success * 100).toFixed(1);
    const failurePct = (outcomeDistribution.failure * 100).toFixed(1);
    const meanCap = statistics.meanCapital.toFixed(0);
    const medianCap = statistics.medianCapital.toFixed(0);
    const riskLabel = this.labelDimension(dimensions.riskTolerance, 'conservative', 'risk-seeking');
    const decisionLabel = this.labelDimension(dimensions.decisionSpeed, 'deliberative', 'impulsive');

    const topSignalNames = topSignals.map((s) => s.value).join(', ');
    const strongestSignal = topSignals[0];

    const edgeOutcome = stratifiedBreakdown.edge.avgOutcome.toFixed(2);
    const centralOutcome = stratifiedBreakdown.central.avgOutcome.toFixed(2);

    const executiveSummary = `Across ${results.cloneCount} simulated clones running the ${scenario} scenario, your success rate was ${successPct}% with a mean capital outcome of $${meanCap}. Your behavioral profile — ${riskLabel} risk tolerance and ${decisionLabel} decision-making — was the primary driver of these outcomes.`;

    const outcomeAnalysis = `Your median capital outcome of $${medianCap} ${parseInt(medianCap) < parseInt(meanCap) ? 'trails the mean, indicating a right-skewed distribution where a few high performers pulled the average up' : 'is close to the mean, suggesting a relatively symmetric distribution'}. The ${successPct}% success rate means roughly ${Math.round(outcomeDistribution.success * results.cloneCount)} of ${results.cloneCount} clones achieved a positive outcome, while ${failurePct}% (${Math.round(outcomeDistribution.failure * results.cloneCount)} clones) ended in failure. Mean health was ${(statistics.meanHealth * 100).toFixed(0)}% and mean happiness was ${(statistics.meanHappiness * 100).toFixed(0)}%, averaged over ${statistics.averageDuration.toFixed(1)} months of simulation.`;

    const behavioralDrivers = topSignals.length > 0
      ? `Your top behavioral signals — ${topSignalNames} — shaped how your clones navigated the ${scenario} scenario. ${strongestSignal ? `The strongest signal was "${strongestSignal.value}" (${strongestSignal.type}, ${(strongestSignal.confidence * 100).toFixed(0)}% confidence), which appeared with frequency ${strongestSignal.frequency} and showed a ${strongestSignal.trend} trend.` : ''} Edge-case clones (extreme behavior) averaged an outcome of ${edgeOutcome} compared to ${centralOutcome} for central (moderate) clones, ${parseFloat(edgeOutcome) > parseFloat(centralOutcome) ? 'suggesting that bolder behavioral patterns yielded better results in this scenario' : 'suggesting that moderate behavioral patterns yielded more stable results'}.`
      : `No strong behavioral signals were detected. The simulation relied primarily on dimensional parameters: risk tolerance (${dimensions.riskTolerance.toFixed(2)}), decision speed (${dimensions.decisionSpeed.toFixed(2)}), and emotional volatility (${dimensions.emotionalVolatility.toFixed(2)}).`;

    const riskFactors = `The ${failurePct}% failure rate represents a real risk. ${outcomeDistribution.failure > 0.3 ? 'This is a notably high failure rate — more than 1 in 3 clones did not achieve a positive outcome.' : outcomeDistribution.failure > 0.15 ? 'While not extreme, the failure rate is significant enough to warrant caution.' : 'The failure rate is relatively contained, but edge cases still show vulnerability.'} Your emotional volatility score of ${dimensions.emotionalVolatility.toFixed(2)} (${this.labelDimension(dimensions.emotionalVolatility, 'stable', 'reactive')}) ${dimensions.emotionalVolatility > 0.6 ? 'is a key risk factor — reactive emotional patterns tend to amplify losses during downturns' : 'provides some buffer against emotional decision-making during volatile periods'}.`;

    const contradictionInsights = contradictions.length > 0
      ? `${contradictions.length} behavioral contradiction${contradictions.length > 1 ? 's were' : ' was'} detected in your signal profile: ${contradictions.map((c) => c.description).join('. ')}. These contradictions create uncertainty in the simulation — clones that resolved contradictions toward the more adaptive behavior tended to outperform.`
      : `No significant contradictions were detected between your behavioral signals. Your stated preferences and revealed behaviors appear consistent, which generally leads to more predictable simulation outcomes.`;

    const recommendation = `Based on the ${scenario} simulation with a ${successPct}% success rate: ${parseFloat(successPct) > 60 ? 'the odds are in your favor, but monitor the risk factors identified above' : parseFloat(successPct) > 40 ? 'outcomes are mixed — your success depends heavily on which behavioral patterns dominate your decision-making' : 'proceed with caution — the simulation suggests significant headwinds given your current behavioral profile'}. Your ${riskLabel} risk stance and ${decisionLabel} decision style are the biggest levers you can adjust. ${contradictions.length > 0 ? 'Resolving the behavioral contradictions identified above could meaningfully improve outcomes.' : 'Maintaining behavioral consistency will be key to achieving the more favorable outcomes in the distribution.'}`;

    return {
      executiveSummary,
      outcomeAnalysis,
      behavioralDrivers,
      riskFactors,
      contradictionInsights,
      recommendation,
    };
  }
}
