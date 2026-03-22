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
      const data = await api.getSimulationResults(id) as {
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
        };
      };

      if (data.status !== 'completed') {
        console.log(`${warningText(`Simulation is ${data.status}.`)} ${dimText('Results not available yet.')}`);
        return;
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(data.distributions, null, 2));
        return;
      }

      const { outcomeDistribution, statistics, stratifiedBreakdown } = data.distributions;

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
