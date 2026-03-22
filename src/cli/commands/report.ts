import chalk from 'chalk';
import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { api } from '../api.js';
import { DIMENSION_DISPLAY, DIMENSION_LABELS } from '../dimensionMetadata.js';
import { icons, infoLabel, sectionHeader, valueText } from '../styles.js';

interface Bin {
  min: number;
  max: number;
  count: number;
  frequency: number;
}

interface Histogram {
  metric: string;
  bins: Bin[];
  mean: number;
  median: number;
  stdDev: number;
  p5: number;
  p95: number;
}

interface OutcomeDistribution {
  success: number;
  failure: number;
  neutral: number;
  byCategory: {
    edge: { success: number; failure: number; neutral: number };
    typical: { success: number; failure: number; neutral: number };
    central: { success: number; failure: number; neutral: number };
  };
}

interface SimulationStatistics {
  meanCapital: number;
  medianCapital: number;
  meanHealth: number;
  meanHappiness: number;
  successRate: number;
  averageDuration: number;
}

interface StratifiedBreakdown {
  edge: { count: number; avgOutcome: number };
  typical: { count: number; avgOutcome: number };
  central: { count: number; avgOutcome: number };
}

interface NarrativeResult {
  executiveSummary: string;
  outcomeAnalysis: string;
  behavioralDrivers: string;
  riskFactors: string;
  contradictionInsights: string;
  recommendation: string;
}

interface KellyOutput {
  successProbability: number;
  netOddsRatio: number;
  fullKellyPercentage: number;
  adjustedKellyPercentage: number;
  optimalCommitmentAmount: number;
  kellyFractionUsed: number;
  rationale: string;
  warning?: string;
}

interface DecisionFrame {
  title: string;
  primaryQuestion: string;
  contextSummary: string;
  timeframeMonths: number;
  capitalAtRisk: number;
  runwayMonths: number;
  fallbackPlan: string;
  reversibilityScore: number;
  socialExposure: number;
  uncertaintyLoad: number;
  downsideSeverity: number;
  keyUnknowns: string[];
}

interface ExperimentRecommendation {
  priority: 'highest' | 'high' | 'medium';
  focusMetric?: string;
  uncertainty: string;
  whyItMatters: string;
  recommendedExperiment: string;
  successSignal: string;
  stopSignal: string;
  learningValue: number;
}

interface DecisionIntelligence {
  summary: string;
  dominantUncertainties: string[];
  recommendedExperiments: ExperimentRecommendation[];
}

interface EvidenceResult {
  id: string;
  uncertainty: string;
  focusMetric: string;
  recommendationIndex?: number;
  recommendedExperiment: string;
  result: 'positive' | 'negative' | 'mixed' | 'inconclusive';
  confidence: number;
  observedSignal: string;
  notes?: string;
  createdAt: string;
}

interface RerunComparison {
  sourceSimulationId: string;
  evidenceCount: number;
  summary: string;
  beliefDelta: {
    thesisConfidence: number;
    uncertaintyLevel: number;
    downsideSalience: number;
  };
  recommendationDelta: {
    changed: boolean;
    previousTopUncertainty?: string;
    newTopUncertainty?: string;
    previousTopExperiment?: string;
    newTopExperiment?: string;
  };
}

interface AggregatedResults {
  scenarioId: string;
  cloneCount: number;
  histograms: Histogram[];
  outcomeDistribution: OutcomeDistribution;
  statistics: SimulationStatistics;
  stratifiedBreakdown: StratifiedBreakdown;
  decisionFrame?: DecisionFrame;
  decisionIntelligence?: DecisionIntelligence;
  appliedEvidence?: EvidenceResult[];
  rerunComparison?: RerunComparison;
  narrative?: NarrativeResult;
  kelly?: KellyOutput;
}

interface SimulationInfo {
  id: string;
  name: string;
  scenarioType: string;
  status: string;
  cloneCount: number;
  createdAt: string;
}

interface PersonaTrait {
  name: string;
  value: number;
  confidence: number;
  evidence: string;
}

interface ResultsResponse {
  status: string;
  distributions: AggregatedResults;
}


function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatCurrency(n: number): string {
  return '$' + formatNumber(Math.round(n));
}

function formatPct(n: number, decimals: number = 1): string {
  return (n * 100).toFixed(decimals) + '%';
}

function formatSignedPoints(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)} pts`;
}

function formatMonths(n: number): string {
  return `${n} month${n === 1 ? '' : 's'}`;
}

function renderBar(value: number, maxValue: number, width: number = 40): string {
  const filled = Math.round((value / maxValue) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function renderMiniBar(value: number, width: number = 10): string {
  const filled = Math.round(value * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatPriority(priority: ExperimentRecommendation['priority']): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function dimensionLevel(value: number, metric: string): string {
  const labels = DIMENSION_LABELS[metric];
  if (!labels) {
    if (value < 0.3) return 'Low';
    if (value < 0.55) return 'Moderate';
    if (value < 0.75) return 'Moderate-High';
    return 'High';
  }
  if (value < 0.3) return labels.low;
  if (value < 0.45) return `Moderate-${labels.low}`;
  if (value <= 0.55) return 'Moderate';
  if (value <= 0.7) return `Moderate-${labels.high}`;
  return labels.high;
}

function formatMetricLabel(metric: string, value: number): string {
  if (metric === 'capital') return formatCurrency(value);
  if (metric === 'health' || metric === 'happiness') return formatPct(value);
  if (Math.abs(value) >= 1000) return formatNumber(Math.round(value));
  return value.toFixed(1);
}

function formatScenarioName(scenarioType: string): string {
  return scenarioType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function renderOutcomeDistribution(dist: OutcomeDistribution): string {
  const lines: string[] = [];
  const maxVal = Math.max(dist.success, dist.failure, dist.neutral);

  lines.push(`Success: ${formatPct(dist.success).padStart(6)} ${renderBar(dist.success, maxVal)}`);
  lines.push(`Failure: ${formatPct(dist.failure).padStart(6)} ${renderBar(dist.failure, maxVal)}`);
  lines.push(`Neutral: ${formatPct(dist.neutral).padStart(6)} ${renderBar(dist.neutral, maxVal)}`);

  return lines.join('\n');
}

function renderAppliedEvidenceSection(evidence: EvidenceResult[]): string {
  const lines: string[] = [];
  lines.push('## Applied Evidence');

  for (const [index, entry] of evidence.entries()) {
    lines.push(`### ${index + 1}. ${entry.uncertainty}`);
    lines.push(`- Result: ${entry.result}`);
    lines.push(`- Confidence: ${formatPct(entry.confidence)}`);
    lines.push(`- Focus metric: ${entry.focusMetric}`);
    lines.push(`- Experiment: ${entry.recommendedExperiment}`);
    lines.push(`- Observed signal: ${entry.observedSignal}`);
    if (entry.notes) {
      lines.push(`- Notes: ${entry.notes}`);
    }
    lines.push('');
  }

  if (lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

function renderRerunComparisonSection(rerunComparison: RerunComparison): string {
  const lines: string[] = [];
  lines.push('## Evidence Loop Delta');
  lines.push(rerunComparison.summary);
  lines.push('');
  lines.push('| Measure | Delta |');
  lines.push('|---------|-------|');
  lines.push(`| Thesis confidence | ${formatSignedPoints(rerunComparison.beliefDelta.thesisConfidence)} |`);
  lines.push(`| Uncertainty | ${formatSignedPoints(rerunComparison.beliefDelta.uncertaintyLevel)} |`);
  lines.push(`| Downside salience | ${formatSignedPoints(rerunComparison.beliefDelta.downsideSalience)} |`);

  if (
    rerunComparison.recommendationDelta.previousTopUncertainty
    || rerunComparison.recommendationDelta.newTopUncertainty
    || rerunComparison.recommendationDelta.previousTopExperiment
    || rerunComparison.recommendationDelta.newTopExperiment
  ) {
    lines.push('');
    lines.push('### Recommendation Shift');
    lines.push(`- Source simulation: ${rerunComparison.sourceSimulationId}`);
    lines.push(`- Evidence items applied: ${rerunComparison.evidenceCount}`);
    lines.push(`- Top uncertainty: ${rerunComparison.recommendationDelta.previousTopUncertainty ?? 'n/a'} → ${rerunComparison.recommendationDelta.newTopUncertainty ?? 'n/a'}`);
    lines.push(`- Top experiment: ${rerunComparison.recommendationDelta.previousTopExperiment ?? 'n/a'} → ${rerunComparison.recommendationDelta.newTopExperiment ?? 'n/a'}`);
  }

  return lines.join('\n');
}

function renderCategoryTable(dist: OutcomeDistribution, breakdown: StratifiedBreakdown): string {
  const lines: string[] = [];
  lines.push('| Category | Success | Failure | Neutral | Avg Outcome |');
  lines.push('|----------|---------|---------|---------|-------------|');

  const categories: Array<{ key: 'edge' | 'typical' | 'central'; label: string; pct: string }> = [
    { key: 'edge', label: 'Edge (10%)', pct: '10%' },
    { key: 'typical', label: 'Typical (70%)', pct: '70%' },
    { key: 'central', label: 'Central (20%)', pct: '20%' },
  ];

  for (const cat of categories) {
    const catDist = dist.byCategory[cat.key];
    const catTotal = catDist.success + catDist.failure + catDist.neutral;
    const s = catTotal > 0 ? formatPct(catDist.success / catTotal) : '0.0%';
    const f = catTotal > 0 ? formatPct(catDist.failure / catTotal) : '0.0%';
    const n = catTotal > 0 ? formatPct(catDist.neutral / catTotal) : '0.0%';
    const avg = breakdown[cat.key].avgOutcome.toFixed(2);
    lines.push(`| ${cat.label.padEnd(8)} | ${s.padEnd(7)} | ${f.padEnd(7)} | ${n.padEnd(7)} | ${avg.padEnd(11)} |`);
  }

  return lines.join('\n');
}

function findHistogram(histograms: Histogram[], metric: string): Histogram | undefined {
  return histograms.find(h => h.metric === metric);
}

function renderMetricsTable(histograms: Histogram[], stats: SimulationStatistics): string {
  const capitalHist = findHistogram(histograms, 'capital');
  const healthHist = findHistogram(histograms, 'health');
  const happinessHist = findHistogram(histograms, 'happiness');

  const lines: string[] = [];
  lines.push('| Metric | Mean | Median | P5 | P95 | Std Dev |');
  lines.push('|--------|------|--------|----|----|---------|');

  if (capitalHist) {
    lines.push(
      `| Capital ($) | ${formatNumber(Math.round(capitalHist.mean))} | ${formatNumber(Math.round(capitalHist.median))} | ${formatNumber(Math.round(capitalHist.p5))} | ${formatNumber(Math.round(capitalHist.p95))} | ${formatNumber(Math.round(capitalHist.stdDev))} |`
    );
  } else {
    lines.push(
      `| Capital ($) | ${formatNumber(Math.round(stats.meanCapital))} | ${formatNumber(Math.round(stats.medianCapital))} | — | — | — |`
    );
  }

  if (healthHist) {
    lines.push(
      `| Health | ${formatPct(healthHist.mean)} | ${formatPct(healthHist.median)} | ${formatPct(healthHist.p5)} | ${formatPct(healthHist.p95)} | ${formatPct(healthHist.stdDev)} |`
    );
  } else {
    lines.push(
      `| Health | ${formatPct(stats.meanHealth)} | — | — | — | — |`
    );
  }

  if (happinessHist) {
    lines.push(
      `| Happiness | ${formatPct(happinessHist.mean)} | ${formatPct(happinessHist.median)} | ${formatPct(happinessHist.p5)} | ${formatPct(happinessHist.p95)} | ${formatPct(happinessHist.stdDev)} |`
    );
  } else {
    lines.push(
      `| Happiness | ${formatPct(stats.meanHappiness)} | — | — | — | — |`
    );
  }

  return lines.join('\n');
}

function renderHistogram(histogram: Histogram): string {
  const maxFreq = Math.max(...histogram.bins.map(b => b.frequency));
  if (maxFreq === 0) return '';

  return histogram.bins.map(bin => {
    const label = formatMetricLabel(histogram.metric, bin.min);
    const bar = renderBar(bin.frequency, maxFreq, 30);
    const pct = (bin.frequency * 100).toFixed(0);
    return `${label.padStart(10)} ${bar} (${pct}%)`;
  }).join('\n');
}

function renderBehavioralProfile(traits: PersonaTrait[]): string {
  const dimensionTraits = traits.filter(t => DIMENSION_DISPLAY[t.name]);
  if (dimensionTraits.length === 0) return '';

  const lines: string[] = [];
  lines.push('| Dimension | Score | Level |');
  lines.push('|-----------|-------|-------|');

  for (const trait of dimensionTraits) {
    const display = DIMENSION_DISPLAY[trait.name] || trait.name;
    const bar = renderMiniBar(trait.value);
    const level = dimensionLevel(trait.value, trait.name);
    lines.push(`| ${display} | ${trait.value.toFixed(2)} | ${bar} ${level} |`);
  }

  return lines.join('\n');
}

function renderKellySection(kelly: KellyOutput): string {
  const lines: string[] = [];
  lines.push('## Position Sizing (Kelly Criterion)');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Success Probability | ${formatPct(kelly.successProbability)} |`);
  lines.push(`| Net Odds Ratio | ${kelly.netOddsRatio.toFixed(2)}:1 |`);
  lines.push(`| Full Kelly | ${formatPct(kelly.fullKellyPercentage)} |`);
  lines.push(`| Your Kelly (adjusted) | ${formatPct(kelly.adjustedKellyPercentage)} |`);
  lines.push(`| Recommended Commitment | ${formatCurrency(kelly.optimalCommitmentAmount)} |`);
  lines.push('');
  lines.push(`> ${kelly.rationale}`);
  if (kelly.warning) {
    lines.push('');
    lines.push(`> Warning: ${kelly.warning}`);
  }
  lines.push('');
  lines.push('> Kelly sizing is a probabilistic simulation output, not financial advice.');
  return lines.join('\n');
}

function renderDecisionFrameSection(frame: DecisionFrame): string {
  const lines: string[] = [];
  lines.push('## Decision Frame');
  lines.push(`**Primary question:** ${frame.primaryQuestion}`);
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Decision title | ${escapeTableCell(frame.title)} |`);
  lines.push(`| Time horizon | ${formatMonths(frame.timeframeMonths)} |`);
  lines.push(`| Capital at risk | ${formatCurrency(frame.capitalAtRisk)} |`);
  lines.push(`| Runway | ${formatMonths(frame.runwayMonths)} |`);
  lines.push(`| Fallback path | ${escapeTableCell(frame.fallbackPlan)} |`);
  lines.push(`| Reversibility score | ${formatPct(frame.reversibilityScore)} |`);
  lines.push(`| Social exposure | ${formatPct(frame.socialExposure)} |`);
  lines.push(`| Uncertainty load | ${formatPct(frame.uncertaintyLoad)} |`);
  lines.push(`| Downside severity | ${formatPct(frame.downsideSeverity)} |`);

  if (frame.contextSummary) {
    lines.push('');
    lines.push(`**Context summary:** ${frame.contextSummary}`);
  }

  if (frame.keyUnknowns.length > 0) {
    lines.push('');
    lines.push('### Key Unknowns');
    for (const [index, unknown] of frame.keyUnknowns.entries()) {
      lines.push(`${index + 1}. ${unknown}`);
    }
  }

  return lines.join('\n');
}

function renderDecisionIntelligenceSection(decisionIntelligence: DecisionIntelligence): string {
  const lines: string[] = [];
  lines.push('## Decision Intelligence');
  lines.push(decisionIntelligence.summary);

  if (decisionIntelligence.dominantUncertainties.length > 0) {
    lines.push('');
    lines.push('### Dominant Uncertainties');
    for (const [index, uncertainty] of decisionIntelligence.dominantUncertainties.entries()) {
      lines.push(`${index + 1}. ${uncertainty}`);
    }
  }

  if (decisionIntelligence.recommendedExperiments.length > 0) {
    lines.push('');
    lines.push('### Recommended Experiments');

    for (const [index, experiment] of decisionIntelligence.recommendedExperiments.entries()) {
      lines.push(`#### ${index + 1}. ${formatPriority(experiment.priority)} priority — ${experiment.uncertainty}`);
      lines.push(`- Learning value: ${formatPct(experiment.learningValue)}`);
      lines.push(`- Why it matters: ${experiment.whyItMatters}`);
      lines.push(`- Recommended experiment: ${experiment.recommendedExperiment}`);
      lines.push(`- Success signal: ${experiment.successSignal}`);
      lines.push(`- Stop signal: ${experiment.stopSignal}`);
      lines.push('');
    }

    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
  }

  return lines.join('\n');
}

export function generateReport(
  sim: SimulationInfo,
  results: AggregatedResults,
  traits: PersonaTrait[] | null,
  narrative: NarrativeResult | null,
): string {
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const scenarioName = formatScenarioName(sim.scenarioType);
  const decisionTitle = results.decisionFrame?.title && results.decisionFrame.title !== scenarioName
    ? ` | **Decision**: ${results.decisionFrame.title}`
    : '';
  const sections: string[] = [];

  sections.push(`# Monte Engine Report`);
  sections.push(`**Scenario**: ${scenarioName}${decisionTitle} | **Clones**: ${formatNumber(results.cloneCount)} | **Generated**: ${now}`);
  sections.push('---');

  if (narrative?.executiveSummary) {
    sections.push('## Executive Summary');
    sections.push(narrative.executiveSummary);
    sections.push('---');
  } else {
    const successPct = formatPct(results.outcomeDistribution.success);
    const failurePct = formatPct(results.outcomeDistribution.failure);
    const meanCap = formatCurrency(results.statistics.meanCapital);
    sections.push('## Executive Summary');
    sections.push(
      `Across ${formatNumber(results.cloneCount)} simulated clones in the ${scenarioName} scenario, ` +
      `${successPct} achieved a successful outcome while ${failurePct} ended in failure. ` +
      `Mean capital at simulation end was ${meanCap} with an average health score of ${formatPct(results.statistics.meanHealth)} ` +
      `and happiness of ${formatPct(results.statistics.meanHappiness)}.` +
      (results.decisionIntelligence?.summary ? ` ${results.decisionIntelligence.summary}` : '')
    );
    sections.push('---');
  }

  if (results.decisionFrame) {
    sections.push(renderDecisionFrameSection(results.decisionFrame));
    sections.push('---');
  }

  if (results.decisionIntelligence) {
    sections.push(renderDecisionIntelligenceSection(results.decisionIntelligence));
    sections.push('---');
  }

  if (results.appliedEvidence && results.appliedEvidence.length > 0) {
    sections.push(renderAppliedEvidenceSection(results.appliedEvidence));
    sections.push('---');
  }

  if (results.rerunComparison) {
    sections.push(renderRerunComparisonSection(results.rerunComparison));
    sections.push('---');
  }

  sections.push('## Outcome Distribution');
  sections.push('```');
  sections.push(renderOutcomeDistribution(results.outcomeDistribution));
  sections.push('```');
  sections.push('');
  sections.push('### By Clone Category');
  sections.push(renderCategoryTable(results.outcomeDistribution, results.stratifiedBreakdown));
  sections.push('---');

  sections.push('## Key Metrics');
  sections.push(renderMetricsTable(results.histograms, results.statistics));

  const capitalHist = findHistogram(results.histograms, 'capital');
  if (capitalHist) {
    sections.push('');
    sections.push('### Capital Distribution');
    sections.push('```');
    sections.push(renderHistogram(capitalHist));
    sections.push('```');
  }

  sections.push('---');

  if (results.kelly) {
    sections.push(renderKellySection(results.kelly));
    sections.push('---');
  }

  if (traits && traits.length > 0) {
    const profileTable = renderBehavioralProfile(traits);
    if (profileTable) {
      sections.push('## Behavioral Profile');
      sections.push(profileTable);
      sections.push('---');
    }
  }

  if (narrative?.outcomeAnalysis) {
    sections.push('## Outcome Analysis');
    sections.push(narrative.outcomeAnalysis);
    sections.push('');
  }

  if (narrative?.behavioralDrivers) {
    sections.push('## Behavioral Drivers');
    sections.push(narrative.behavioralDrivers);
    sections.push('');
  }

  if (narrative?.riskFactors) {
    sections.push('## Risk Factors');
    sections.push(narrative.riskFactors);
    sections.push('');
  }

  if (narrative?.contradictionInsights) {
    sections.push('## Contradiction Insights');
    sections.push(narrative.contradictionInsights);
    sections.push('');
  }

  if (narrative?.recommendation) {
    sections.push('## Recommendation');
    sections.push(narrative.recommendation);
    sections.push('');
  }

  sections.push('---');
  sections.push('');
  sections.push('*Generated by Monte Engine v0.1.0 \u2014 https://github.com/ElironB/Monte*');

  return sections.join('\n\n');
}

export const reportCommands = new Command('report')
  .description(chalk.dim('Generate simulation report'))
  .argument('<id>', 'simulation ID')
  .option('-o, --output <path>', 'output file path')
  .option('--no-narrative', 'skip LLM narrative generation')
  .option('--stdout', 'print to stdout instead of file')
  .action(async (id: string, options: { output?: string; narrative: boolean; stdout?: boolean }) => {
    try {
      const sim = await api.getSimulation(id) as SimulationInfo;

      const resultsResponse = await api.getSimulationResults(
        id,
        { narrative: options.narrative }
      ) as ResultsResponse;

      if (resultsResponse.status !== 'completed') {
        console.error(`${icons.error} Simulation is ${resultsResponse.status}. Results not available yet.`);
        process.exit(1);
      }

      const results = resultsResponse.distributions;

      let traits: PersonaTrait[] | null = null;
      try {
        traits = await api.getPersonaTraits() as PersonaTrait[];
        if (!Array.isArray(traits) || traits.length === 0) traits = null;
      } catch {
        traits = null;
      }

      const narrative = results.narrative || null;
      console.log(`${infoLabel('Generating report...')}`);
      const markdown = generateReport(sim, results, traits, narrative);

      if (options.stdout) {
        console.log(markdown);
      } else {
        const outputPath = options.output || `./monte-report-${id}.md`;
        writeFileSync(outputPath, markdown, 'utf-8');
        console.log(`${icons.success} ${chalk.green.bold('Report saved to')} ${valueText(outputPath)}`);
      }
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });
