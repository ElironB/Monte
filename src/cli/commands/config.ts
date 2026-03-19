import chalk from 'chalk';
import { homedir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import { icons, infoLabel, sectionHeader, valueText } from '../styles.js';

export const configCommands = new Command('config')
  .description(chalk.dim('Configuration commands'));

configCommands
  .command('show')
  .description(chalk.dim('Show current configuration'))
  .action(() => {
    const config = loadConfig();

    console.log(`\n${sectionHeader('Configuration')}`);
    console.log(`  ${infoLabel('API URL:')} ${valueText(config.apiUrl)}`);
    console.log(`  ${infoLabel('Default Scenario:')} ${valueText(config.defaultScenario || 'none')}`);
    console.log(`  ${infoLabel('Default Clones:')} ${valueText(config.defaultCloneCount || 1000)}`);
  });

configCommands
  .command('set-api')
  .description(chalk.dim('Set API endpoint'))
  .argument('<url>', 'API URL (e.g., http://localhost:3000)')
  .action((url) => {
    saveConfig({ apiUrl: url });
    console.log(`${icons.success} ${chalk.green.bold('API URL set to')} ${valueText(url)}`);
  });

configCommands
  .command('set-defaults')
  .description(chalk.dim('Set default simulation options'))
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
      console.log(chalk.yellow('⚠ No changes made. Use --scenario or --clones to set values.'));
      return;
    }

    saveConfig(updates);
    console.log(`${icons.success} ${chalk.green.bold('Defaults updated')}`);
    if (updates.defaultScenario) {
      console.log(`  ${infoLabel('Scenario:')} ${valueText(updates.defaultScenario)}`);
    }
    if (updates.defaultCloneCount) {
      console.log(`  ${infoLabel('Clones:')} ${valueText(updates.defaultCloneCount)}`);
    }
  });

configCommands
  .command('dir')
  .description(chalk.dim('Show config directory path'))
  .action(() => {
    const dir = join(homedir(), '.monte');
    console.log(valueText(dir));
  });
