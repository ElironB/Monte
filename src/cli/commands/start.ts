import chalk from 'chalk';
import { Command } from 'commander';
import { buildJsonErrorPayload } from '../output.js';
import { config } from '../../config/index.js';
import { startMonteServer } from '../../server.js';

interface StartCommandOptions {
  host: string;
  port: string;
  dashboard: boolean;
}

export const startCommands = new Command('start')
  .description(chalk.dim('Start the Monte API, workers, and bundled dashboard'))
  .option('--host <host>', 'host to bind', '0.0.0.0')
  .option('--port <port>', 'port to bind', String(config.server.port))
  .option('--no-dashboard', 'disable the bundled dashboard and serve API only')
  .action(async (options: StartCommandOptions) => {
    try {
      await startMonteServer({
        host: options.host,
        port: Number.parseInt(options.port, 10),
        enableDashboard: options.dashboard,
      });
    } catch (err) {
      const payload = buildJsonErrorPayload(err);
      console.error(`${chalk.red('error:')} ${payload.error.message}`);
      process.exit(1);
    }
  });
