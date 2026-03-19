import { Command } from 'commander';
import { api } from '../api.js';
import { requireAuth, loadConfig } from '../config.js';

export const simulationCommands = new Command('simulate')
  .description('Simulation commands');

simulationCommands
  .command('list')
  .description('List all simulations')
  .action(async () => {
    requireAuth();
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
        console.log('No simulations found');
        return;
      }

      console.log('\nSimulations:');
      console.log('-'.repeat(100));
      console.log(`${'ID'.padEnd(36)} ${'Name'.padEnd(20)} ${'Scenario'.padEnd(15)} ${'Status'.padEnd(12)} ${'Clones'.padEnd(8)} Created`);
      console.log('-'.repeat(100));

      for (const sim of simulations) {
        const date = new Date(sim.createdAt).toLocaleDateString();
        console.log(
          `${sim.id.padEnd(36)} ${sim.name.slice(0, 18).padEnd(20)} ${sim.scenarioType.padEnd(15)} ${sim.status.padEnd(12)} ${String(sim.cloneCount).padEnd(8)} ${date}`
        );
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

simulationCommands
  .command('run')
  .description('Run a new simulation')
  .requiredOption('-s, --scenario <type>', 'scenario type (day_trading, startup_founding, career_change, etc.)')
  .option('-n, --name <name>', 'simulation name')
  .option('-c, --clones <count>', 'number of clones', '1000')
  .option('--wait', 'wait for completion and show results', false)
  .action(async (options) => {
    requireAuth();
    try {
      const name = options.name || `${options.scenario}-${Date.now()}`;
      const cloneCount = parseInt(options.clones, 10);

      console.log(`Creating simulation "${name}" with ${cloneCount} clones...`);

      const result = await api.createSimulation(options.scenario, name, {
        cloneCount,
      }) as {
        simulationId: string;
        status: string;
        cloneCount: number;
      };

      console.log(`✓ Simulation created: ${result.simulationId}`);
      console.log(`  Status: ${result.status}`);
      console.log(`  Clones: ${result.cloneCount}`);

      if (options.wait) {
        console.log('\nWaiting for completion...');
        await waitForSimulation(result.simulationId);
      } else {
        console.log(`\nRun 
monnt' to check progress`);
        console.log(`Run 
monns`);
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

simulationCommands
  .command('progress')
  .description('Check simulation progress')
  .argument('<id>', 'simulation ID')
  .action(async (id) => {
    requireAuth();
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

      console.log(`\nSimulation: ${progress.simulationId}`);
      console.log(`Status: ${progress.status}`);
      console.log(`Progress: ${progress.progress}% (${progress.completedBatches}/${progress.totalBatches} batches)`);
      console.log(`Clones: ${progress.cloneCount}`);
      if (progress.estimatedTimeRemaining) {
        console.log(`ETA: ${formatDuration(progress.estimatedTimeRemaining)}`);
      }

      // Progress bar
      const barWidth = 40;
      const filled = Math.round((progress.progress / 100) * barWidth);
      const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
      console.log(`\n[${bar}] ${progress.progress}%`);
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

simulationCommands
  .command('results')
  .description('Get simulation results')
  .argument('<id>', 'simulation ID')
  .option('-f, --format <format>', 'output format (table, json)', 'table')
  .action(async (id, options) => {
    requireAuth();
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
        console.log(`Simulation is ${data.status}. Results not available yet.`);
        return;
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(data.distributions, null, 2));
        return;
      }

      const { outcomeDistribution, statistics, stratifiedBreakdown } = data.distributions;

      console.log('\n=== Simulation Results ===\n');

      // Outcome Distribution
      console.log('Outcome Distribution:');
      console.log(`  Success: ${(outcomeDistribution.success * 100).toFixed(1)}%`);
      console.log(`  Failure: ${(outcomeDistribution.failure * 100).toFixed(1)}%`);
      console.log(`  Neutral: ${(outcomeDistribution.neutral * 100).toFixed(1)}%`);
      console.log();

      // Statistics
      console.log('Statistics:');
      console.log(`  Success Rate: ${(statistics.successRate * 100).toFixed(1)}%`);
      console.log(`  Mean Capital: $${statistics.meanCapital.toFixed(0)}`);
      console.log(`  Mean Health: ${(statistics.meanHealth * 100).toFixed(1)}%`);
      console.log(`  Mean Happiness: ${(statistics.meanHappiness * 100).toFixed(1)}%`);
      console.log(`  Avg Duration: ${statistics.averageDuration.toFixed(1)} months`);
      console.log();

      // Stratified Breakdown
      console.log('Stratified Breakdown:');
      console.log(`  Edge Cases: ${stratifiedBreakdown.edge.count} clones (avg outcome: ${stratifiedBreakdown.edge.avgOutcome.toFixed(2)})`);
      console.log(`  Typical: ${stratifiedBreakdown.typical.count} clones (avg outcome: ${stratifiedBreakdown.typical.avgOutcome.toFixed(2)})`);
      console.log(`  Central: ${stratifiedBreakdown.central.count} clones (avg outcome: ${stratifiedBreakdown.central.avgOutcome.toFixed(2)})`);
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

simulationCommands
  .command('scenarios')
  .description('List available scenarios')
  .action(async () => {
    try {
      const scenarios = await api.listScenarios() as Array<{
        id: string;
        name: string;
        timeframe: string;
      }>;

      console.log('\nAvailable Scenarios:');
      console.log('-'.repeat(60));

      for (const scenario of scenarios) {
        console.log(`${scenario.id.padEnd(25)} ${scenario.name.padEnd(25)} ${scenario.timeframe}`);
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

simulationCommands
  .command('delete')
  .description('Delete a simulation')
  .argument('<id>', 'simulation ID')
  .option('--force', 'skip confirmation', false)
  .action(async (id, options) => {
    requireAuth();
    try {
      if (!options.force) {
        console.log(`This will delete simulation ${id}`);
        console.log('Use --force to confirm');
        process.exit(1);
      }

      await api.deleteSimulation(id);
      console.log('✓ Simulation deleted');
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

async function waitForSimulation(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const progress = await api.getSimulationProgress(id) as { status: string; progress: number };

        if (progress.status === 'completed') {
          console.log('\n✓ Simulation complete!');
          // Show results
          const results = await api.getSimulationResults(id) as {
            distributions: {
              statistics: { successRate: number };
            };
          };
          console.log(`\nSuccess Rate: ${(results.distributions.statistics.successRate * 100).toFixed(1)}%`);
          resolve();
          return;
        }

        if (progress.status === 'failed') {
          console.log('\n✗ Simulation failed');
          reject(new Error('Simulation failed'));
          return;
        }

        process.stdout.write(`\rProgress: ${progress.progress}%`);

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
