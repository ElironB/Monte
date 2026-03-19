import { Command } from 'commander';
import { loadConfig, saveConfig, loadAuth } from '../config.js';

export const configCommands = new Command('config')
  .description('Configuration commands');

configCommands
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    const auth = loadAuth();

    console.log('\nConfiguration:');
    console.log(`  API URL: ${config.apiUrl}`);
    console.log(`  Default Scenario: ${config.defaultScenario || 'none'}`);
    console.log(`  Default Clones: ${config.defaultCloneCount || 1000}`);
    console.log(`\nAuthenticated: ${auth.accessToken ? 'Yes' : 'No'}`);
    if (auth.email) {
      console.log(`  Email: ${auth.email}`);
    }
  });

configCommands
  .command('set-api')
  .description('Set API endpoint')
  .argument('<url>', 'API URL (e.g., http://localhost:3000)')
  .action((url) => {
    saveConfig({ apiUrl: url });
    console.log(`✓ API URL set to ${url}`);
  });

configCommands
  .command('set-defaults')
  .description('Set default simulation options')
  .option('-s, --scenario <scenario>', 'default scenario type')
  .option('-c, --clones <count>', 'default clone count', parseInt)
  .action((options) => {
    const updates: Partial<{ defaultScenario?: string; defaultCloneCount?: number }> = {};

    if (options.scenario) {
      updates.defaultScenario = options.scenario;
    }
    if (options.clones) {
      updates.defaultCloneCount = options.clones;
    }

    if (Object.keys(updates).length === 0) {
      console.log('No changes made. Use --scenario or --clones to set values.');
      return;
    }

    saveConfig(updates);
    console.log('✓ Defaults updated');
  });

configCommands
  .command('dir')
  .description('Show config directory path')
  .action(() => {
    const { homedir } = require('os');
    const { join } = require('path');
    const dir = join(homedir(), '.monte');
    console.log(dir);
  });
