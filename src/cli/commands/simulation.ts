import chalk from 'chalk';
import { Command } from 'commander';
import { api } from '../api.js';
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
  .description(chalk.dim('Simulation commands'));

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

      console.log(
        `${infoLabel('Creating simulation')} ${valueText(`"${name}"`)} ${dimText('with')} ${valueText(cloneCount)} ${dimText('clones...')}`,
      );

      const result = await api.createSimulation(options.scenario, name, {
        cloneCount,
        capitalAtRisk: options.capitalAtRisk,
      }) as {
        simulationId: string;
        status: string;
        cloneCount: number;
      };

      console.log(`${icons.success} ${chalk.green.bold('Simulation created')}`);
      console.log(`  ${infoLabel('Simulation ID:')} ${chalk.cyan(result.simulationId)}`);
      console.log(`  ${infoLabel('Status:')} ${statusColor(result.status)}`);
      console.log(`  ${infoLabel('Clones:')} ${valueText(result.cloneCount)}`);

      if (options.wait) {
        console.log(`\n${infoLabel('Waiting for completion...')}`);
        await waitForSimulation(result.simulationId);
      } else {
        console.log(`\n${dimText(`Run \`monte simulate progress ${result.simulationId}\` to check progress`)}`);
        console.log(dimText(`Run \`monte simulate results ${result.simulationId}\` for results when done`));
      }
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
      const progress = await api.getSimulationProgress(id) as {
        simulationId: string;
        status: string;
        progress: number;
        completedBatches: number;
        totalBatches: number;
        cloneCount: number;
        estimatedTimeRemaining?: number;
      };

      console.log(`\n${sectionHeader('Simulation Progress')}`);
      console.log(`  ${infoLabel('Simulation:')} ${chalk.cyan(progress.simulationId)}`);
      console.log(`  ${infoLabel('Status:')} ${statusColor(progress.status)}`);
      console.log(
        `  ${infoLabel('Progress:')} ${chalk.cyan.bold(`${progress.progress}%`)} ${dimText(`(${progress.completedBatches}/${progress.totalBatches} batches)`)}`,
      );
      console.log(`  ${infoLabel('Clones:')} ${valueText(progress.cloneCount)}`);
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
    const check = async () => {
      try {
        const progress = await api.getSimulationProgress(id) as { status: string; progress: number };

        if (progress.status === 'completed') {
          process.stdout.write('\n');
          console.log(`${icons.success} ${chalk.green.bold('Simulation complete!')}`);
          const results = await api.getSimulationResults(id) as {
            distributions: {
              statistics: { successRate: number };
            };
          };
          console.log(`  ${infoLabel('Success Rate:')} ${chalk.green.bold(formatPercent(results.distributions.statistics.successRate))}`);
          resolve();
          return;
        }

        if (progress.status === 'failed') {
          process.stdout.write('\n');
          console.log(`${icons.error} ${chalk.red.bold('Simulation failed')}`);
          reject(new Error('Simulation failed'));
          return;
        }

        process.stdout.write(`\r${infoLabel('Progress:')} [${progressBar(progress.progress)}] ${chalk.cyan.bold(`${progress.progress}%`)}`);
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
