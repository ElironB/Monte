import chalk from 'chalk';
import { Command } from 'commander';
import { api } from '../api.js';
import { parseSimulationQuery } from '../queryParser.js';
import {
  dimText,
  icons,
  infoLabel,
  progressBar,
  sectionHeader,
  statusColor,
  valueText,
  warningText,
} from '../styles.js';

function divider(width: number): string {
  return chalk.dim('─'.repeat(width));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPoints(value: number): string {
  const points = `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} pts`;
  return value >= 0 ? chalk.green(points) : chalk.red(points);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export const simulationCommands = new Command('simulate')
  .description(chalk.dim('Run a simulation from a natural language description'))
  .usage('[query] [--clones <count>] [--wait]')
  .allowUnknownOption()
  .argument('[query...]', 'Describe your decision in plain English')
  .addHelpText(
    'after',
    `
Options:
  -c, --clones <count>  Number of clones for natural-language simulations
  --wait                Wait for completion and show results

Examples:
  $ monte simulate "should I quit my job and start a business?"
  $ monte simulate "is buying a $600k house smart right now?"
  $ monte simulate "should I take this $3500 freelance gig?"

Advanced mode:
  $ monte simulate run -s day_trading --wait
  $ monte simulate scenarios
`,
  )
  .action(async () => {
    try {
      const options = parseNaturalLanguageInvocation(getNaturalLanguageArgs());
      const query = options.query;

      if (!query) {
        console.log(chalk.cyan('Usage: monte simulate "your decision question"'));
        console.log(chalk.dim('  e.g., monte simulate "should I quit my job and day trade?"'));
        console.log(chalk.dim('  e.g., monte simulate "should I buy a house for $600k?"'));
        console.log(chalk.dim('\nOr use specific commands:'));
        console.log(chalk.dim('  monte simulate run -s day_trading --wait'));
        console.log(chalk.dim('  monte simulate scenarios'));
        return;
      }

      const params = await parseSimulationQuery(query);
      const parameters = params.timeframe === undefined
        ? params.context
        : { ...params.context, timeframe: params.timeframe };

      console.log(chalk.cyan('Parsed simulation:'));
      console.log(`  ${chalk.dim('Scenario:')} ${chalk.white.bold(params.scenarioType)}`);
      console.log(`  ${chalk.dim('Name:')} ${chalk.white(params.name)}`);
      if (params.capitalAtRisk !== undefined) {
        console.log(`  ${chalk.dim('Capital at risk:')} ${chalk.white.bold(`$${params.capitalAtRisk.toLocaleString()}`)}`);
      }
      if (params.timeframe !== undefined) {
        console.log(`  ${chalk.dim('Timeframe:')} ${chalk.white(`${params.timeframe} months`)}`);
      }
      console.log();

      await createSimulationAndHandleResult(params.scenarioType, params.name, {
        cloneCount: options.cloneCount,
        capitalAtRisk: params.capitalAtRisk,
        parameters,
        wait: options.wait,
      });
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

type SimulationCreateResult = {
  simulationId: string;
  status: string;
  cloneCount: number;
};

type SimulationProgressResult = {
  simulationId: string;
  status: string;
  progress: number;
  completedBatches: number;
  totalBatches: number;
  cloneCount: number;
  processedClones?: number;
  currentBatch?: number;
  batchProcessedClones?: number;
  batchCloneCount?: number;
  estimatedTimeRemaining?: number;
  lastUpdated?: string;
  error?: string;
};

type SimulationEvidenceResult = {
  evidence: {
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
  } | null;
  evidenceCount: number;
};

type SimulationRerunResult = SimulationCreateResult & {
  sourceSimulationId: string;
  evidenceCount: number;
};

type SimulationResultsPayload = {
  status: string;
  distributions: {
    outcomeDistribution: {
      success: number;
      failure: number;
      neutral: number;
    };
    statistics: {
      successRate: number;
      meanCapital: number;
      meanHealth: number;
      meanHappiness: number;
      averageDuration: number;
    };
    stratifiedBreakdown: {
      edge: { count: number; avgOutcome: number };
      typical: { count: number; avgOutcome: number };
      central: { count: number; avgOutcome: number };
    };
    appliedEvidence?: Array<{
      id: string;
      uncertainty: string;
      result: 'positive' | 'negative' | 'mixed' | 'inconclusive';
      confidence: number;
      observedSignal: string;
    }>;
    rerunComparison?: {
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
    };
  } | null;
};

async function createSimulationAndHandleResult(
  scenarioType: string,
  name: string,
  options: {
    cloneCount: number;
    capitalAtRisk?: number;
    parameters?: Record<string, unknown>;
    wait?: boolean;
  },
): Promise<void> {
  console.log(
    `${infoLabel('Creating simulation')} ${valueText(`"${name}"`)} ${dimText('with')} ${valueText(options.cloneCount)} ${dimText('clones...')}`,
  );

  const result = await api.createSimulation(scenarioType, name, {
    cloneCount: options.cloneCount,
    capitalAtRisk: options.capitalAtRisk,
    parameters: options.parameters,
  }) as SimulationCreateResult;

  console.log(`${icons.success} ${chalk.green.bold('Simulation created')}`);
  console.log(`  ${infoLabel('Simulation ID:')} ${chalk.cyan(result.simulationId)}`);
  console.log(`  ${infoLabel('Status:')} ${statusColor(result.status)}`);
  console.log(`  ${infoLabel('Clones:')} ${valueText(result.cloneCount)}`);

  if (options.wait) {
    console.log(`\n${infoLabel('Waiting for completion...')}`);
    await waitForSimulation(result.simulationId);
    return;
  }

  console.log(`\n${dimText(`Run \`monte simulate progress ${result.simulationId}\` to check progress`)}`);
  console.log(dimText(`Run \`monte simulate results ${result.simulationId}\` for results when done`));
}

function getNaturalLanguageArgs(): string[] {
  const args = process.argv.slice(2);
  const simulateIndex = args.findIndex(arg => arg === 'simulate');
  return simulateIndex === -1 ? args : args.slice(simulateIndex + 1);
}

function parseNaturalLanguageInvocation(args: string[]): { query?: string; cloneCount: number; wait: boolean } {
  let cloneCount = 1000;
  let wait = false;
  const queryParts: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === '--wait') {
      wait = true;
      continue;
    }

    if (arg === '-c' || arg === '--clones') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value for --clones');
      }
      cloneCount = parseCloneCount(value);
      index++;
      continue;
    }

    if (arg.startsWith('--clones=')) {
      cloneCount = parseCloneCount(arg.split('=', 2)[1]);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    queryParts.push(arg);
  }

  const query = queryParts.join(' ').trim();
  return {
    query: query.length > 0 ? query : undefined,
    cloneCount,
    wait,
  };
}

function parseCloneCount(value: string): number {
  const cloneCount = parseInt(value, 10);
  if (Number.isNaN(cloneCount)) {
    throw new Error(`Invalid clone count: ${value}`);
  }
  return cloneCount;
}

simulationCommands
  .command('list')
  .description(chalk.dim('List all simulations'))
  .action(async () => {
    try {
      const simulations = await api.listSimulations() as Array<{
        id: string;
        name: string;
        scenarioType: string;
        status: string;
        cloneCount: number;
        createdAt: string;
      }>;

      if (simulations.length === 0) {
        console.log(dimText('No simulations found'));
        return;
      }

      console.log(`\n${sectionHeader('Simulations')}`);
      console.log(divider(118));
      console.log(
        `  ${infoLabel('ID'.padEnd(36))}  ${infoLabel('Name'.padEnd(22))}  ${infoLabel('Scenario'.padEnd(22))}  ${infoLabel('Status'.padEnd(12))}  ${infoLabel('Clones'.padStart(6))}  ${infoLabel('Created')}`,
      );
      console.log(divider(118));

      for (const sim of simulations) {
        const date = new Date(sim.createdAt).toLocaleDateString();
        console.log(
          `  ${dimText(sim.id)}  ${chalk.white.bold(sim.name.slice(0, 20).padEnd(22))}  ${chalk.white(sim.scenarioType.padEnd(22))}  ${statusColor(sim.status, 12)}  ${chalk.cyan(String(sim.cloneCount).padStart(6))}  ${dimText(date)}`,
        );
      }
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

simulationCommands
  .command('run')
  .description(chalk.dim('Run a new simulation'))
  .requiredOption('-s, --scenario <type>', 'scenario type (day_trading, startup_founding, career_change, etc.)')
  .option('-n, --name <name>', 'simulation name')
  .option('-c, --clones <count>', 'number of clones', '1000')
  .option('--capital-at-risk <amount>', 'capital at risk for Kelly sizing', parseFloat)
  .option('--wait', 'wait for completion and show results', false)
  .action(async (options) => {
    try {
      const name = options.name || `${options.scenario}-${Date.now()}`;
      const cloneCount = parseInt(options.clones, 10);
      await createSimulationAndHandleResult(options.scenario, name, {
        cloneCount,
        capitalAtRisk: options.capitalAtRisk,
        wait: options.wait,
      });
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

simulationCommands
  .command('progress')
  .description(chalk.dim('Check simulation progress'))
  .argument('<id>', 'simulation ID')
  .action(async (id) => {
    try {
      const progress = await api.getSimulationProgress(id) as SimulationProgressResult;

      console.log(`\n${sectionHeader('Simulation Progress')}`);
      console.log(`  ${infoLabel('Simulation:')} ${chalk.cyan(progress.simulationId)}`);
      console.log(`  ${infoLabel('Status:')} ${statusColor(progress.status)}`);
      console.log(
        `  ${infoLabel('Progress:')} ${chalk.cyan.bold(`${progress.progress}%`)} ${dimText(`(${formatProgressSummary(progress)})`)}`,
      );
      console.log(`  ${infoLabel('Clones:')} ${valueText(progress.cloneCount)}`);
      const currentBatch = formatCurrentBatch(progress);
      if (currentBatch) {
        console.log(`  ${infoLabel('Live batch:')} ${dimText(currentBatch)}`);
      }
      if (progress.estimatedTimeRemaining) {
        console.log(`  ${infoLabel('ETA:')} ${dimText(formatDuration(progress.estimatedTimeRemaining))}`);
      }

      console.log(`\n  [${progressBar(progress.progress)}] ${chalk.cyan.bold(`${progress.progress}%`)}`);
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

simulationCommands
  .command('results')
  .description(chalk.dim('Get simulation results'))
  .argument('<id>', 'simulation ID')
  .option('-f, --format <format>', 'output format (table, json)', 'table')
  .action(async (id, options) => {
    try {
      const data = await api.getSimulationResults(id) as SimulationResultsPayload;

      if (data.status !== 'completed') {
        console.log(`${warningText(`Simulation is ${data.status}.`)} ${dimText('Results not available yet.')}`);
        return;
      }

      if (!data.distributions) {
        console.log(`${warningText('Simulation finished but aggregated results are not readable yet.')} ${dimText('Try again in a moment.')}`);
        return;
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(data.distributions, null, 2));
        return;
      }

      const { outcomeDistribution, statistics, stratifiedBreakdown, appliedEvidence, rerunComparison } = data.distributions;

      console.log(`\n${sectionHeader('Simulation Results')}\n`);

      console.log(sectionHeader('Outcome Distribution'));
      console.log(`  ${infoLabel('Success:')} ${chalk.green.bold(formatPercent(outcomeDistribution.success))}`);
      console.log(`  ${infoLabel('Failure:')} ${chalk.red.bold(formatPercent(outcomeDistribution.failure))}`);
      console.log(`  ${infoLabel('Neutral:')} ${chalk.yellow(formatPercent(outcomeDistribution.neutral))}`);
      console.log();

      console.log(sectionHeader('Statistics'));
      console.log(`  ${infoLabel('Success Rate:')} ${chalk.green.bold(formatPercent(statistics.successRate))}`);
      console.log(`  ${infoLabel('Mean Capital:')} ${chalk.cyan(`$${statistics.meanCapital.toFixed(0)}`)}`);
      console.log(`  ${infoLabel('Mean Health:')} ${chalk.cyan(formatPercent(statistics.meanHealth))}`);
      console.log(`  ${infoLabel('Mean Happiness:')} ${chalk.cyan(formatPercent(statistics.meanHappiness))}`);
      console.log(`  ${infoLabel('Avg Duration:')} ${chalk.cyan(`${statistics.averageDuration.toFixed(1)} months`)}`);
      console.log();

      console.log(sectionHeader('Stratified Breakdown'));
      console.log(
        `  ${infoLabel('Edge Cases:')} ${valueText(stratifiedBreakdown.edge.count)} ${dimText('clones')} ${infoLabel('avg outcome:')} ${chalk.cyan(stratifiedBreakdown.edge.avgOutcome.toFixed(2))}`,
      );
      console.log(
        `  ${infoLabel('Typical:')} ${valueText(stratifiedBreakdown.typical.count)} ${dimText('clones')} ${infoLabel('avg outcome:')} ${chalk.cyan(stratifiedBreakdown.typical.avgOutcome.toFixed(2))}`,
      );
      console.log(
        `  ${infoLabel('Central:')} ${valueText(stratifiedBreakdown.central.count)} ${dimText('clones')} ${infoLabel('avg outcome:')} ${chalk.cyan(stratifiedBreakdown.central.avgOutcome.toFixed(2))}`,
      );

      if (rerunComparison) {
        console.log();
        console.log(sectionHeader('Evidence Loop Delta'));
        console.log(`  ${dimText(rerunComparison.summary)}`);
        console.log(`  ${infoLabel('Thesis confidence:')} ${formatSignedPoints(rerunComparison.beliefDelta.thesisConfidence)}`);
        console.log(`  ${infoLabel('Uncertainty:')} ${formatSignedPoints(rerunComparison.beliefDelta.uncertaintyLevel)}`);
        console.log(`  ${infoLabel('Downside salience:')} ${formatSignedPoints(rerunComparison.beliefDelta.downsideSalience)}`);

        if (rerunComparison.recommendationDelta.changed) {
          if (rerunComparison.recommendationDelta.previousTopUncertainty || rerunComparison.recommendationDelta.newTopUncertainty) {
            console.log(
              `  ${infoLabel('Top uncertainty:')} ${dimText(rerunComparison.recommendationDelta.previousTopUncertainty ?? 'n/a')} ${chalk.dim('→')} ${valueText(rerunComparison.recommendationDelta.newTopUncertainty ?? 'n/a')}`,
            );
          }
          if (rerunComparison.recommendationDelta.previousTopExperiment || rerunComparison.recommendationDelta.newTopExperiment) {
            console.log(
              `  ${infoLabel('Top experiment:')} ${dimText(truncateText(rerunComparison.recommendationDelta.previousTopExperiment ?? 'n/a', 72))} ${chalk.dim('→')} ${valueText(truncateText(rerunComparison.recommendationDelta.newTopExperiment ?? 'n/a', 72))}`,
            );
          }
        }
      }

      if (appliedEvidence && appliedEvidence.length > 0) {
        console.log();
        console.log(sectionHeader('Applied Evidence'));
        for (const entry of appliedEvidence.slice(0, 3)) {
          console.log(
            `  ${valueText(entry.result.toUpperCase())} ${chalk.white(entry.uncertainty)} ${dimText(`(${formatPercent(entry.confidence)})`)}`,
          );
          console.log(`    ${dimText(truncateText(entry.observedSignal, 110))}`);
        }
        if (appliedEvidence.length > 3) {
          console.log(`  ${dimText(`...and ${appliedEvidence.length - 3} more evidence result(s)`)}`);
        }
      }
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

simulationCommands
  .command('evidence')
  .description(chalk.dim('Record an experiment result for a completed simulation'))
  .argument('<id>', 'simulation ID')
  .requiredOption('--result <result>', 'positive, negative, mixed, or inconclusive')
  .requiredOption('--signal <text>', 'observed signal / what happened')
  .option('-r, --recommendation <index>', 'recommended experiment number to resolve')
  .option('--uncertainty <text>', 'manual uncertainty label')
  .option('--focus-metric <metric>', 'manual focus metric')
  .option('--experiment <text>', 'manual experiment description')
  .option('--confidence <value>', 'confidence in the evidence signal (0-1)', '0.75')
  .option('--notes <text>', 'extra notes')
  .action(async (id, options) => {
    try {
      const recommendationIndex = options.recommendation ? parseInt(options.recommendation, 10) : undefined;
      const confidence = parseFloat(options.confidence);

      if (options.recommendation && Number.isNaN(recommendationIndex)) {
        throw new Error(`Invalid recommendation index: ${options.recommendation}`);
      }
      if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
        throw new Error(`Invalid confidence value: ${options.confidence}`);
      }

      if (!recommendationIndex && (!options.uncertainty || !options.experiment)) {
        throw new Error('Provide --recommendation <n> or supply both --uncertainty and --experiment.');
      }

      const result = await api.recordSimulationEvidence(id, {
        recommendationIndex,
        uncertainty: options.uncertainty,
        focusMetric: options.focusMetric,
        recommendedExperiment: options.experiment,
        result: options.result,
        confidence,
        observedSignal: options.signal,
        notes: options.notes,
      }) as SimulationEvidenceResult;

      if (!result.evidence) {
        throw new Error('Evidence was not recorded.');
      }

      console.log(`${icons.success} ${chalk.green.bold('Evidence recorded')}`);
      console.log(`  ${infoLabel('Evidence ID:')} ${chalk.cyan(result.evidence.id)}`);
      console.log(`  ${infoLabel('Uncertainty:')} ${valueText(result.evidence.uncertainty)}`);
      console.log(`  ${infoLabel('Result:')} ${valueText(result.evidence.result.toUpperCase())} ${dimText(`(${formatPercent(result.evidence.confidence)})`)}`);
      console.log(`  ${infoLabel('Signal:')} ${dimText(result.evidence.observedSignal)}`);
      console.log(`  ${infoLabel('Evidence count:')} ${valueText(result.evidenceCount)}`);
      console.log(`\n${dimText('Run `monte simulate rerun ' + id + ' --wait` to create an evidence-adjusted rerun.')}`);
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

simulationCommands
  .command('rerun')
  .description(chalk.dim('Create an evidence-adjusted rerun from a completed simulation'))
  .argument('<id>', 'simulation ID')
  .option('-n, --name <name>', 'rerun simulation name')
  .option('-c, --clones <count>', 'override clone count')
  .option('--evidence <ids>', 'comma-separated evidence IDs to apply')
  .option('--wait', 'wait for completion and show results', false)
  .action(async (id, options) => {
    try {
      const cloneCount = options.clones ? parseCloneCount(options.clones) : undefined;
      const evidenceIds = options.evidence
        ? options.evidence
          .split(',')
          .map((entry: string) => entry.trim())
          .filter((entry: string) => entry.length > 0)
        : undefined;

      const result = await api.rerunSimulationWithEvidence(id, {
        name: options.name,
        cloneCount,
        evidenceIds,
      }) as SimulationRerunResult;

      console.log(`${icons.success} ${chalk.green.bold('Evidence rerun created')}`);
      console.log(`  ${infoLabel('Simulation ID:')} ${chalk.cyan(result.simulationId)}`);
      console.log(`  ${infoLabel('Source:')} ${chalk.cyan(result.sourceSimulationId)}`);
      console.log(`  ${infoLabel('Clones:')} ${valueText(result.cloneCount)}`);
      console.log(`  ${infoLabel('Evidence used:')} ${valueText(result.evidenceCount)}`);

      if (options.wait) {
        console.log(`\n${infoLabel('Waiting for completion...')}`);
        await waitForSimulation(result.simulationId);
        return;
      }

      console.log(`\n${dimText('Run `monte simulate progress ' + result.simulationId + '` to check progress')}`);
      console.log(dimText('Run `monte simulate results ' + result.simulationId + '` for the evidence delta when done'));
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

simulationCommands
  .command('scenarios')
  .description(chalk.dim('List available scenarios'))
  .action(async () => {
    try {
      const scenarios = await api.listScenarios() as Array<{
        id: string;
        name: string;
        timeframe: string;
      }>;

      console.log(`\n${sectionHeader('Available Scenarios')}`);
      console.log(divider(78));
      console.log(
        `  ${infoLabel('Scenario ID'.padEnd(26))}  ${infoLabel('Name'.padEnd(28))}  ${infoLabel('Timeframe')}`,
      );
      console.log(divider(78));

      for (const scenario of scenarios) {
        console.log(
          `  ${chalk.cyan(scenario.id.padEnd(26))}  ${chalk.white.bold(scenario.name.padEnd(28))}  ${dimText(scenario.timeframe)}`,
        );
      }
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

simulationCommands
  .command('delete')
  .description(chalk.dim('Delete a simulation'))
  .argument('<id>', 'simulation ID')
  .option('--force', 'skip confirmation', false)
  .action(async (id, options) => {
    try {
      if (!options.force) {
        console.log(`${icons.warning} ${warningText('Destructive action')}`);
        console.log(`  ${warningText('This will delete simulation')} ${chalk.cyan(id)}`);
        console.log(`  ${dimText('Use --force to confirm.')}`);
        process.exit(1);
      }

      await api.deleteSimulation(id);
      console.log(`${icons.success} ${chalk.green.bold('Simulation deleted')}`);
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

async function waitForSimulation(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let lastProgress = -1;
    let stagnantPolls = 0;
    let warnedAboutStall = false;

    const check = async () => {
      try {
        const progress = await api.getSimulationProgress(id) as SimulationProgressResult;

        if (progress.status === 'completed') {
          // Re-fetch until results are actually in Neo4j (race: Redis marks
          // completed before the aggregation write finishes)
          const results = await api.getSimulationResults(id) as {
            status: string;
            distributions: { statistics: { successRate: number } } | null;
          };

          if (!results.distributions) {
            // Aggregation not written yet — keep polling
            setTimeout(check, 1000);
            return;
          }

          process.stdout.write('\n');
          console.log(`${icons.success} ${chalk.green.bold('Simulation complete!')}`);
          console.log(`  ${infoLabel('Success Rate:')} ${chalk.green.bold(formatPercent(results.distributions.statistics.successRate))}`);
          resolve();
          return;
        }

        if (progress.status === 'failed') {
          process.stdout.write('\n');
          console.log(`${icons.error} ${chalk.red.bold('Simulation failed')}`);
          if (progress.error) {
            console.log(`  ${infoLabel('Error:')} ${chalk.red(progress.error)}`);
          }
          reject(new Error(progress.error || 'Simulation failed'));
          return;
        }

        if (progress.progress === lastProgress) {
          stagnantPolls += 1;
        } else {
          stagnantPolls = 0;
          warnedAboutStall = false;
          lastProgress = progress.progress;
        }

        process.stdout.write(
          `\r${infoLabel('Progress:')} [${progressBar(progress.progress)}] ${chalk.cyan.bold(`${progress.progress}%`)} ${dimText(`(${formatProgressSummary(progress)})`)}${progress.status === 'aggregating' ? ` ${dimText('aggregating results')}` : ''}`
        );

        if (stagnantPolls >= 15 && !warnedAboutStall) {
          process.stdout.write('\n');
          console.log(
            warningText(
              progress.status === 'aggregating'
                ? `No progress update for ~${stagnantPolls * 2}s. Final aggregation may still be writing results.`
                : `No progress update for ~${stagnantPolls * 2}s. Simulation may be waiting on workers or queued LLM calls.`
            )
          );
          if (progress.lastUpdated) {
            console.log(`  ${infoLabel('Last update:')} ${dimText(progress.lastUpdated)}`);
          }
          console.log(`  ${dimText(`Try \`monte simulate progress ${id}\` or inspect the server logs if this persists.`)}`);
          warnedAboutStall = true;
        }

        setTimeout(check, 2000);
      } catch (err) {
        reject(err);
      }
    };

    check();
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatProgressSummary(progress: SimulationProgressResult): string {
  const processedClones = typeof progress.processedClones === 'number'
    ? Math.min(progress.cloneCount, Math.max(0, progress.processedClones))
    : undefined;
  const cloneSummary = processedClones === undefined
    ? `${progress.cloneCount} clones`
    : `${processedClones}/${progress.cloneCount} clones`;

  return `${cloneSummary}, ${progress.completedBatches}/${progress.totalBatches} batches`;
}

function formatCurrentBatch(progress: SimulationProgressResult): string | null {
  if (typeof progress.currentBatch !== 'number') {
    return null;
  }

  const batchLabel = `batch ${progress.currentBatch + 1}/${progress.totalBatches}`;
  if (typeof progress.batchProcessedClones === 'number' && typeof progress.batchCloneCount === 'number') {
    return `${batchLabel} · ${progress.batchProcessedClones}/${progress.batchCloneCount} clones`;
  }

  return batchLabel;
}
