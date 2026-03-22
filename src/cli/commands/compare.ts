import chalk from 'chalk';
import { Command } from 'commander';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, extname, basename, resolve } from 'path';
import { api, MonteAPIError } from '../api.js';
import OpenAI from 'openai';
import { dimText, icons, infoLabel, sectionHeader, valueText } from '../styles.js';
import type { AggregatedResults, OutcomeDistribution, StratifiedBreakdown, SimulationStatistics, Histogram } from '../../simulation/types.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.json', '.csv', '.txt', '.md', '.pdf', '.docx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.DS_Store', '.obsidian',
]);

interface DiscoveredFile {
  path: string;
  filename: string;
  extension: string;
  sourceType: string;
  mimetype: string;
}

interface PersonaTrait {
  name: string;
  value: number;
  confidence: number;
  evidence: string;
}

interface IngestionResult {
  fileCount: number;
  signalCount: number;
}

interface SimulationInfo {
  simulationId: string;
  status: string;
  cloneCount: number;
}

interface SimulationProgress {
  status: string;
  progress: number;
}

interface ResultsResponse {
  status: string;
  distributions: AggregatedResults;
}

interface PersonaRunResult {
  label: string;
  dir: string;
  ingestion: IngestionResult;
  traits: PersonaTrait[];
  results: AggregatedResults;
  simulationId: string;
  error?: string;
}

interface DivergentSignal {
  signal: string;
  confidenceA: number | null;
  confidenceB: number | null;
  delta: number;
}

const DIMENSION_DISPLAY: Record<string, string> = {
  riskTolerance: 'Risk Tolerance',
  timePreference: 'Time Preference',
  emotionalVolatility: 'Emotional Volatility',
  decisionSpeed: 'Decision Speed',
  socialDependency: 'Social Dependency',
  learningStyle: 'Learning Style',
};

const DIMENSION_KEYS = [
  'riskTolerance',
  'timePreference',
  'emotionalVolatility',
  'decisionSpeed',
  'socialDependency',
  'learningStyle',
];

function walkDirectory(dirPath: string): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];

  function walk(dir: string) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
        files.push({
          path: fullPath,
          filename: basename(entry),
          extension: ext,
          sourceType: detectSourceType(fullPath, ext),
          mimetype: getMimetype(ext),
        });
      }
    }
  }

  walk(dirPath);
  return files;
}

function detectSourceType(filePath: string, ext: string): string {
  if (ext === '.md' || ext === '.txt') return 'notes';
  if (['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'files';
  if (ext === '.json') {
    try {
      const content = readFileSync(filePath, 'utf-8').slice(0, 2000).toLowerCase();
      if (content.includes('mapping') && content.includes('message') && content.includes('author')) return 'ai_chat'; // ChatGPT
      if (content.includes('chat_messages') && content.includes('sender') && content.includes('human')) return 'ai_chat'; // Claude
      if (content.includes('gemini') && content.includes('activitycontrols')) return 'ai_chat'; // Gemini Takeout
      if (content.includes('grok') && (content.includes('conversation') || content.includes('messages'))) return 'ai_chat'; // Grok
      if (content.includes('search') || content.includes('query')) return 'search_history';
      if (content.includes('watch') || content.includes('video') || content.includes('youtube')) return 'watch_history';
      if (content.includes('transaction') || content.includes('amount') || content.includes('balance')) return 'financial';
      if (content.includes('post') || content.includes('comment') || content.includes('subreddit') || content.includes('tweet')) return 'social_media';
    } catch { /* fall through */ }
    return 'files';
  }
  if (ext === '.csv') {
    try {
      const firstLine = readFileSync(filePath, 'utf-8').split('\n')[0].toLowerCase();
      if (firstLine.includes('amount') || firstLine.includes('transaction') || firstLine.includes('debit') || firstLine.includes('credit')) return 'financial';
    } catch { /* fall through */ }
    return 'files';
  }
  return 'files';
}

function getMimetype(ext: string): string {
  const mimeMap: Record<string, string> = {
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

function renderMiniBar(value: number, width: number = 10): string {
  const filled = Math.round(value * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function renderBar(value: number, maxValue: number, width: number = 40): string {
  const filled = Math.round((value / (maxValue || 1)) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
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

function formatScenarioName(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function metricDeltaColor(delta: number): (value: string) => string {
  if (delta > 0) return (value: string) => chalk.green.bold(value);
  if (delta < 0) return (value: string) => chalk.red.bold(value);
  return (value: string) => chalk.white.bold(value);
}

function renderComparisonSummary(resultA: PersonaRunResult, resultB: PersonaRunResult): void {
  const statsA = resultA.results.statistics;
  const statsB = resultB.results.statistics;
  const successDelta = statsA.successRate - statsB.successRate;
  const capitalDelta = statsA.meanCapital - statsB.meanCapital;
  const healthDelta = statsA.meanHealth - statsB.meanHealth;
  const happinessDelta = statsA.meanHappiness - statsB.meanHappiness;

  const rows = [
    { label: 'Success Rate', a: formatPct(statsA.successRate), b: formatPct(statsB.successRate), delta: successDelta, deltaText: `${successDelta >= 0 ? '+' : ''}${formatPct(successDelta)}` },
    { label: 'Mean Capital', a: formatCurrency(statsA.meanCapital), b: formatCurrency(statsB.meanCapital), delta: capitalDelta, deltaText: `${capitalDelta >= 0 ? '+' : '-'}${formatCurrency(Math.abs(capitalDelta))}` },
    { label: 'Mean Health', a: formatPct(statsA.meanHealth), b: formatPct(statsB.meanHealth), delta: healthDelta, deltaText: `${healthDelta >= 0 ? '+' : ''}${formatPct(healthDelta)}` },
    { label: 'Mean Happiness', a: formatPct(statsA.meanHappiness), b: formatPct(statsB.meanHappiness), delta: happinessDelta, deltaText: `${happinessDelta >= 0 ? '+' : ''}${formatPct(happinessDelta)}` },
  ];

  console.log(`\n${sectionHeader('Comparison Summary')}`);
  console.log(`${infoLabel('Metric'.padEnd(18))} ${infoLabel('Persona A'.padEnd(15))} ${infoLabel('Persona B'.padEnd(15))} ${infoLabel('Delta')}`);
  console.log(chalk.dim('─'.repeat(64)));

  for (const row of rows) {
    const colorA = metricDeltaColor(row.delta);
    const colorB = metricDeltaColor(-row.delta);
    console.log(`  ${chalk.white.bold(row.label.padEnd(16))} ${colorA(row.a.padEnd(15))} ${colorB(row.b.padEnd(15))} ${colorA(row.deltaText)}`);
  }

  const categorySuccessRate = (dist: OutcomeDistribution, cat: 'edge' | 'typical' | 'central'): number => {
    const catDist = dist.byCategory[cat];
    const total = catDist.success + catDist.failure + catDist.neutral;
    return total > 0 ? catDist.success / total : 0;
  };

  const spreads = [
    { label: 'Edge (10%)', value: Math.abs(categorySuccessRate(resultA.results.outcomeDistribution, 'edge') - categorySuccessRate(resultB.results.outcomeDistribution, 'edge')) },
    { label: 'Typical (70%)', value: Math.abs(categorySuccessRate(resultA.results.outcomeDistribution, 'typical') - categorySuccessRate(resultB.results.outcomeDistribution, 'typical')) },
    { label: 'Central (20%)', value: Math.abs(categorySuccessRate(resultA.results.outcomeDistribution, 'central') - categorySuccessRate(resultB.results.outcomeDistribution, 'central')) },
  ];

  console.log(`\n${sectionHeader('Divergence by Clone Category')}`);
  for (const spread of spreads) {
    console.log(`  ${infoLabel(`${spread.label}:`)} ${chalk.bold(formatPct(spread.value))}`);
  }
}

async function ingestDirectory(dirPath: string): Promise<IngestionResult> {
  const absPath = resolve(dirPath);
  if (!existsSync(absPath)) {
    throw new Error(`Directory not found: ${absPath}`);
  }

  const stat = statSync(absPath);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${absPath}`);
  }

  const files = walkDirectory(absPath);
  if (files.length === 0) {
    throw new Error(`No supported files found in ${absPath}`);
  }

  const groups = new Map<string, DiscoveredFile[]>();
  for (const file of files) {
    const group = groups.get(file.sourceType) || [];
    group.push(file);
    groups.set(file.sourceType, group);
  }

  let totalSignals = 0;

  for (const [sourceType, typeFiles] of groups) {
    const fileData = typeFiles.map(f => ({
      filename: f.filename,
      content: readFileSync(f.path).toString('base64'),
      mimetype: f.mimetype,
    }));

    const BATCH_SIZE = 10;
    for (let i = 0; i < fileData.length; i += BATCH_SIZE) {
      const batch = fileData.slice(i, i + BATCH_SIZE);
      await api.uploadFiles(batch, sourceType);
    }

    totalSignals += typeFiles.length;
  }

  return { fileCount: files.length, signalCount: totalSignals };
}

async function buildPersonaAndWait(): Promise<PersonaTrait[]> {
  await api.buildPersona();

  let attempts = 0;
  const maxAttempts = 90;

  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;

    try {
      const persona = await api.getPersona() as {
        status?: string;
        buildStatus?: string;
      };

      if (persona.buildStatus === 'ready') {
        const traits = await api.getPersonaTraits() as PersonaTrait[];
        return Array.isArray(traits) ? traits : [];
      }

      if (persona.buildStatus === 'failed') {
        throw new Error('Persona build failed');
      }
    } catch (err) {
      if (err instanceof MonteAPIError && err.status === 404) continue;
      throw err;
    }
  }

  throw new Error('Persona build timed out');
}

async function runSimulationAndWait(scenario: string, cloneCount: number, label: string): Promise<{ simulationId: string; results: AggregatedResults }> {
  const simName = `compare-${label}-${Date.now()}`;
  const sim = await api.createSimulation(scenario, simName, { cloneCount }) as SimulationInfo;

  let attempts = 0;
  const maxAttempts = 300;

  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;

    try {
      const progress = await api.getSimulationProgress(sim.simulationId) as SimulationProgress;

      if (progress.status === 'completed') {
        const resultsResponse = await api.getSimulationResults(sim.simulationId, { narrative: true }) as ResultsResponse;

        if (resultsResponse.status !== 'completed' || !resultsResponse.distributions) {
          throw new Error('Simulation completed but results unavailable');
        }

        return { simulationId: sim.simulationId, results: resultsResponse.distributions };
      }

      if (progress.status === 'failed') {
        throw new Error('Simulation failed');
      }

      if (attempts % 5 === 0) {
        process.stdout.write(`\r  ... ${progress.progress || 0}% complete`);
      }
    } catch (err) {
      if (err instanceof MonteAPIError && err.status === 404) continue;
      throw err;
    }
  }

  throw new Error('Simulation timed out');
}

async function runPersonaPipeline(
  dir: string,
  label: string,
  scenario: string,
  cloneCount: number,
): Promise<PersonaRunResult> {
  console.log(`\n${infoLabel(`Ingesting Persona ${label}`)} ${dimText(`(${dir})`)}`);
  const ingestion = await ingestDirectory(dir);
  console.log(`  ${icons.success} ${chalk.green.bold(`${ingestion.fileCount} files processed`)} ${dimText('—')} ${valueText(`${ingestion.signalCount} signals extracted`)}`);

  console.log(`\n${infoLabel(`Building Persona ${label}...`)}`);
  const traits = await buildPersonaAndWait();
  console.log(`  ${icons.success} ${chalk.green.bold('Persona built')} ${dimText('with')} ${valueText(`${traits.length} traits`)}`);

  console.log(`\n${infoLabel(`Running simulation ${label}`)} ${dimText(`(${formatNumber(cloneCount)} clones)`)}`);
  const { simulationId, results } = await runSimulationAndWait(scenario, cloneCount, label);
  const successRate = formatPct(results.statistics.successRate);
  console.log(`\r  ${icons.success} ${chalk.green.bold('Complete')} ${dimText('—')} ${chalk.green.bold(successRate)} ${dimText('success rate')}`);

  return {
    label,
    dir,
    ingestion,
    traits,
    results,
    simulationId,
  };
}

function getDimensionValue(traits: PersonaTrait[], dimensionKey: string): number {
  const trait = traits.find(t => t.name === dimensionKey);
  return trait?.value ?? 0.5;
}

function findDivergentSignals(traitsA: PersonaTrait[], traitsB: PersonaTrait[]): DivergentSignal[] {
  const signalMapA = new Map<string, number>();
  const signalMapB = new Map<string, number>();

  for (const t of traitsA) {
    signalMapA.set(t.name, t.confidence);
  }
  for (const t of traitsB) {
    signalMapB.set(t.name, t.confidence);
  }

  const allSignals = new Set([...signalMapA.keys(), ...signalMapB.keys()]);
  const divergent: DivergentSignal[] = [];

  for (const signal of allSignals) {
    if (DIMENSION_KEYS.includes(signal)) continue;

    const confA = signalMapA.get(signal) ?? null;
    const confB = signalMapB.get(signal) ?? null;

    const valA = confA ?? 0;
    const valB = confB ?? 0;
    const delta = Math.abs(valA - valB);

    divergent.push({ signal, confidenceA: confA, confidenceB: confB, delta });
  }

  divergent.sort((a, b) => b.delta - a.delta);
  return divergent.slice(0, 10);
}

function loadLLMConfig(): { apiKey?: string; baseUrl?: string; model?: string } {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY || process.env.LLM_API_KEY;
  const baseUrl = process.env.OPENROUTER_API_KEY
    ? 'https://openrouter.ai/api/v1'
    : process.env.GROQ_API_KEY
      ? 'https://api.groq.com/openai/v1'
      : process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
  const model = process.env.LLM_MODEL || 'openai/gpt-oss-20b';
  return { apiKey: apiKey || undefined, baseUrl, model };
}

async function generateComparisonNarrative(
  scenario: string,
  cloneCount: number,
  dirA: string,
  dirB: string,
  resultA: PersonaRunResult,
  resultB: PersonaRunResult,
): Promise<string | null> {
  const llmConfig = loadLLMConfig();

  if (!llmConfig.apiKey) {
    return null;
  }

  const client = new OpenAI({
    apiKey: llmConfig.apiKey,
    baseURL: llmConfig.baseUrl,
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/ElironB/Monte',
      'X-Title': 'Monte Engine',
    },
  });
  const model = llmConfig.model || 'openai/gpt-oss-20b';

  const dimListA = DIMENSION_KEYS.map(k =>
    `  - ${DIMENSION_DISPLAY[k]}: ${getDimensionValue(resultA.traits, k).toFixed(2)}`
  ).join('\n');

  const dimListB = DIMENSION_KEYS.map(k =>
    `  - ${DIMENSION_DISPLAY[k]}: ${getDimensionValue(resultB.traits, k).toFixed(2)}`
  ).join('\n');

  const topSignalsA = resultA.traits
    .filter(t => !DIMENSION_KEYS.includes(t.name))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(t => `  - ${t.name}: ${t.confidence.toFixed(2)} confidence`)
    .join('\n');

  const topSignalsB = resultB.traits
    .filter(t => !DIMENSION_KEYS.includes(t.name))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(t => `  - ${t.name}: ${t.confidence.toFixed(2)} confidence`)
    .join('\n');

  const statsA = resultA.results.statistics;
  const statsB = resultB.results.statistics;

  const systemPrompt = `You analyze Monte Carlo simulation comparisons between two different behavioral personas.`;

  const userMessage = `Two personas ran the same ${scenario.replace(/_/g, ' ')} scenario with ${formatNumber(cloneCount)} clones each.

PERSONA A (from ${dirA}):
- Dimensions:
${dimListA}
- Top signals:
${topSignalsA || '  (none detected)'}
- Results: Success ${formatPct(statsA.successRate)}, Mean Capital ${formatCurrency(statsA.meanCapital)}

PERSONA B (from ${dirB}):
- Dimensions:
${dimListB}
- Top signals:
${topSignalsB || '  (none detected)'}
- Results: Success ${formatPct(statsB.successRate)}, Mean Capital ${formatCurrency(statsB.meanCapital)}

Explain in 3-4 paragraphs WHY these two personas got different outcomes in this scenario. Reference specific behavioral signals and dimensions. Be analytical, not generic.`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    return response.choices[0]?.message?.content || null;
  } catch {
    return null;
  }
}

function generateComparisonReport(
  scenario: string,
  cloneCount: number,
  resultA: PersonaRunResult,
  resultB: PersonaRunResult,
  narrative: string | null,
): string {
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const scenarioName = formatScenarioName(scenario);
  const sections: string[] = [];

  sections.push(`# Monte Engine \u2014 A/B Persona Comparison`);
  sections.push(`**Scenario**: ${scenarioName} | **Clones**: ${formatNumber(cloneCount)} each | **Generated**: ${now}`);
  sections.push('---');

  sections.push('## Behavioral Profiles');
  sections.push('');
  sections.push('| Dimension | Persona A | | Persona B | |');
  sections.push('|-----------|-----------|-----|-----------|-----|');

  for (const key of DIMENSION_KEYS) {
    const display = DIMENSION_DISPLAY[key] || key;
    const valA = getDimensionValue(resultA.traits, key);
    const valB = getDimensionValue(resultB.traits, key);
    const barA = renderMiniBar(valA);
    const barB = renderMiniBar(valB);
    sections.push(`| ${display} | ${valA.toFixed(2)} | ${barA} | ${valB.toFixed(2)} | ${barB} |`);
  }

  sections.push('');
  sections.push('---');

  const statsA = resultA.results.statistics;
  const statsB = resultB.results.statistics;

  sections.push('## Outcome Comparison');
  sections.push('');
  sections.push('| Metric | Persona A | Persona B | Delta |');
  sections.push('|--------|-----------|-----------|-------|');

  const successDelta = statsA.successRate - statsB.successRate;
  const capitalDelta = statsA.meanCapital - statsB.meanCapital;
  const healthDelta = statsA.meanHealth - statsB.meanHealth;
  const happinessDelta = statsA.meanHappiness - statsB.meanHappiness;

  sections.push(`| Success Rate | ${formatPct(statsA.successRate)} | ${formatPct(statsB.successRate)} | ${successDelta >= 0 ? '+' : ''}${formatPct(successDelta)} |`);
  sections.push(`| Mean Capital | ${formatCurrency(statsA.meanCapital)} | ${formatCurrency(statsB.meanCapital)} | ${capitalDelta >= 0 ? '+' : '-'}${formatCurrency(Math.abs(capitalDelta))} |`);
  sections.push(`| Mean Health | ${formatPct(statsA.meanHealth)} | ${formatPct(statsB.meanHealth)} | ${healthDelta >= 0 ? '+' : ''}${formatPct(healthDelta)} |`);
  sections.push(`| Mean Happiness | ${formatPct(statsA.meanHappiness)} | ${formatPct(statsB.meanHappiness)} | ${happinessDelta >= 0 ? '+' : ''}${formatPct(happinessDelta)} |`);

  sections.push('');
  sections.push('### Success Distribution');

  const maxSuccess = Math.max(statsA.successRate, statsB.successRate, 0.01);
  sections.push(`Persona A: ${renderBar(statsA.successRate, 1, 40)} ${formatPct(statsA.successRate)}`);
  sections.push(`Persona B: ${renderBar(statsB.successRate, 1, 40)} ${formatPct(statsB.successRate)}`);

  sections.push('');
  sections.push('---');

  const divergent = findDivergentSignals(resultA.traits, resultB.traits);
  if (divergent.length > 0) {
    sections.push('## Key Differences');
    sections.push('');
    sections.push('### Top Divergent Signals');
    sections.push('| Signal | Persona A | Persona B |');
    sections.push('|--------|-----------|-----------|');

    for (const sig of divergent) {
      const aStr = sig.confidenceA !== null ? `${sig.confidenceA.toFixed(2)} confidence` : 'Not detected';
      const bStr = sig.confidenceB !== null ? `${sig.confidenceB.toFixed(2)} confidence` : 'Not detected';
      sections.push(`| ${sig.signal} | ${aStr} | ${bStr} |`);
    }

    sections.push('');
    sections.push('---');
  }

  if (narrative) {
    sections.push('## Why They Diverge');
    sections.push('');
    sections.push(narrative);
    sections.push('');
    sections.push('---');
  }

  const breakdownA = resultA.results.stratifiedBreakdown;
  const breakdownB = resultB.results.stratifiedBreakdown;
  const distA = resultA.results.outcomeDistribution;
  const distB = resultB.results.outcomeDistribution;

  function categorySuccessRate(dist: OutcomeDistribution, cat: 'edge' | 'typical' | 'central'): number {
    const catDist = dist.byCategory[cat];
    const total = catDist.success + catDist.failure + catDist.neutral;
    return total > 0 ? catDist.success / total : 0;
  }

  const edgeA = categorySuccessRate(distA, 'edge');
  const edgeB = categorySuccessRate(distB, 'edge');
  const typicalA = categorySuccessRate(distA, 'typical');
  const typicalB = categorySuccessRate(distB, 'typical');
  const centralA = categorySuccessRate(distA, 'central');
  const centralB = categorySuccessRate(distB, 'central');

  sections.push('## Edge Case Analysis');
  sections.push('| Clone Category | A Success | B Success | Spread |');
  sections.push('|----------------|-----------|-----------|--------|');
  sections.push(`| Edge (10%) | ${formatPct(edgeA)} | ${formatPct(edgeB)} | ${formatPct(Math.abs(edgeA - edgeB))} |`);
  sections.push(`| Typical (70%) | ${formatPct(typicalA)} | ${formatPct(typicalB)} | ${formatPct(Math.abs(typicalA - typicalB))} |`);
  sections.push(`| Central (20%) | ${formatPct(centralA)} | ${formatPct(centralB)} | ${formatPct(Math.abs(centralA - centralB))} |`);

  sections.push('');
  sections.push('---');

  if (Math.abs(successDelta) < 0.01 && Math.abs(capitalDelta) < 100) {
    sections.push('');
    sections.push('> **Note**: Both personas produced nearly identical results. This is unusual and may indicate the scenario is not sensitive to the behavioral differences between these personas, or the data differences are not significant enough to produce divergent outcomes.');
    sections.push('');
  }

  sections.push('');
  sections.push('*Generated by Monte Engine v0.1.0*');

  return sections.join('\n');
}

export const compareCommands = new Command('compare')
  .description(chalk.dim('Compare two personas on the same scenario'))
  .argument('<dir-a>', 'data directory for Persona A')
  .argument('<dir-b>', 'data directory for Persona B')
  .requiredOption('-s, --scenario <type>', 'scenario to simulate')
  .option('-c, --clones <count>', 'clones per persona', '1000')
  .option('-o, --output <path>', 'output report path', './monte-comparison.md')
  .option('--no-narrative', 'skip LLM narrative comparison')
  .option('--stdout', 'print to stdout')
  .action(async (dirA: string, dirB: string, options: {
    scenario: string;
    clones: string;
    output: string;
    narrative: boolean;
    stdout?: boolean;
  }) => {
    const cloneCount = parseInt(options.clones, 10);

    if (isNaN(cloneCount) || cloneCount < 100) {
      console.error(`${icons.error} clone count must be at least 100`);
      process.exit(1);
    }

    const scenarioName = formatScenarioName(options.scenario);
    console.log(`${infoLabel('Comparing personas on scenario:')} ${valueText(scenarioName)}`);

    let resultA: PersonaRunResult | undefined;
    let resultB: PersonaRunResult | undefined;

    try {
      resultA = await runPersonaPipeline(dirA, 'A', options.scenario, cloneCount);
    } catch (err) {
      console.error(`\n${icons.error} ${chalk.red.bold('Persona A failed:')} ${(err as Error).message}`);
      process.exit(1);
      return;
    }

    try {
      resultB = await runPersonaPipeline(dirB, 'B', options.scenario, cloneCount);
    } catch (err) {
      console.error(`\n${icons.error} ${chalk.red.bold('Persona B failed:')} ${(err as Error).message}`);

      console.log(`\n${sectionHeader('Partial Results (Persona A)')}`);
      console.log(`  ${infoLabel('Success Rate:')} ${chalk.green.bold(formatPct(resultA!.results.statistics.successRate))}`);
      console.log(`  ${infoLabel('Mean Capital:')} ${valueText(formatCurrency(resultA!.results.statistics.meanCapital))}`);
      process.exit(1);
      return;
    }

    renderComparisonSummary(resultA, resultB);
    console.log(`\n${infoLabel('Generating comparison report...')}`);

    let narrative: string | null = null;
    if (options.narrative) {
      try {
        narrative = await generateComparisonNarrative(
          options.scenario,
          cloneCount,
          dirA,
          dirB,
          resultA,
          resultB,
        );
      } catch {
        narrative = null;
      }
    }

    const report = generateComparisonReport(
      options.scenario,
      cloneCount,
      resultA,
      resultB,
      narrative,
    );

    if (options.stdout) {
      console.log('\n' + report);
    } else {
      const outputPath = resolve(options.output);
      writeFileSync(outputPath, report, 'utf-8');
      console.log(`  ${icons.success} ${chalk.green.bold('Report saved to')} ${valueText(outputPath)}`);
    }
  });
