import chalk from 'chalk';
import { homedir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { loadConfig, saveConfig, type CLIConfig, type LLMProvider } from '../config.js';
import { maskSecret, resolveCliProviderConfig } from '../providerConfig.js';
import { icons, infoLabel, sectionHeader, valueText } from '../styles.js';

export const configCommands = new Command('config')
  .description(chalk.dim('Configuration commands'));

function isProvider(value: unknown): value is LLMProvider {
  return value === 'openrouter' || value === 'groq' || value === 'custom';
}

function renderConfig(config: CLIConfig): void {
  const providers = resolveCliProviderConfig(config);

  console.log(`\n${sectionHeader('Configuration')}`);
  console.log(`  ${infoLabel('API URL:')} ${valueText(config.apiUrl)}`);
  console.log(`  ${infoLabel('Default Scenario:')} ${valueText(config.defaultScenario || 'none')}`);
  console.log(`  ${infoLabel('Default Clones:')} ${valueText(config.defaultCloneCount || 1000)}`);
  console.log(`  ${infoLabel('LLM Provider:')} ${valueText(`${providers.llm.provider} (${providers.llm.source})`)}`);
  console.log(`  ${infoLabel('LLM Key:')} ${valueText(maskSecret(providers.llm.apiKey))}`);
  console.log(`  ${infoLabel('LLM Base URL:')} ${valueText(providers.llm.baseUrl)}`);
  console.log(`  ${infoLabel('LLM Model:')} ${valueText(providers.llm.model)}`);
  console.log(`  ${infoLabel('Reasoning Model:')} ${valueText(providers.llm.reasoningModel)}`);
  console.log(`  ${infoLabel('Embedding Key:')} ${valueText(maskSecret(providers.embedding.apiKey))}`);
  console.log(`  ${infoLabel('Embedding Base URL:')} ${valueText(providers.embedding.baseUrl)}`);
  console.log(`  ${infoLabel('Embedding Model:')} ${valueText(providers.embedding.model)}`);
  console.log(`  ${infoLabel('Embedding Source:')} ${valueText(`${providers.embedding.provider} (${providers.embedding.source}${providers.embedding.usesSharedLlmKey ? ', shared LLM key' : ''})`)}`);
}

configCommands
  .command('show')
  .description(chalk.dim('Show current configuration'))
  .action(() => {
    renderConfig(loadConfig());
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
  .command('set-provider')
  .description(chalk.dim('Set the default LLM provider for the global CLI'))
  .argument('<provider>', 'openrouter, groq, or custom')
  .action((provider: string) => {
    if (!isProvider(provider)) {
      console.error(`${icons.error} Invalid provider: ${provider}`);
      process.exit(1);
    }

    saveConfig({ llmProvider: provider });
    console.log(`${icons.success} ${chalk.green.bold('LLM provider set to')} ${valueText(provider)}`);
  });

configCommands
  .command('set-api-key')
  .description(chalk.dim('Store the LLM API key for the global CLI'))
  .argument('<key>', 'provider API key')
  .action((key: string) => {
    saveConfig({ llmApiKey: key.trim() });
    console.log(`${icons.success} ${chalk.green.bold('LLM API key saved')} ${valueText(maskSecret(key.trim()))}`);
  });

configCommands
  .command('set-embedding-key')
  .description(chalk.dim('Store a dedicated embedding API key for the global CLI'))
  .argument('<key>', 'embedding API key')
  .action((key: string) => {
    saveConfig({ embeddingApiKey: key.trim() });
    console.log(`${icons.success} ${chalk.green.bold('Embedding API key saved')} ${valueText(maskSecret(key.trim()))}`);
  });

configCommands
  .command('set-base-url')
  .description(chalk.dim('Set a custom OpenAI-compatible base URL for LLM calls'))
  .argument('<url>', 'custom LLM base URL')
  .action((url: string) => {
    saveConfig({ llmBaseUrl: url.trim(), llmProvider: 'custom' });
    console.log(`${icons.success} ${chalk.green.bold('Custom LLM base URL set to')} ${valueText(url.trim())}`);
  });

configCommands
  .command('set-embedding-base-url')
  .description(chalk.dim('Set a custom embedding base URL'))
  .argument('<url>', 'embedding base URL')
  .action((url: string) => {
    saveConfig({ embeddingBaseUrl: url.trim() });
    console.log(`${icons.success} ${chalk.green.bold('Embedding base URL set to')} ${valueText(url.trim())}`);
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
  .command('clear-keys')
  .description(chalk.dim('Remove stored CLI provider keys'))
  .action(() => {
    saveConfig({
      llmApiKey: undefined,
      embeddingApiKey: undefined,
    });
    console.log(`${icons.success} ${chalk.green.bold('Stored CLI keys cleared')}`);
  });

configCommands
  .command('dir')
  .description(chalk.dim('Show config directory path'))
  .action(() => {
    const dir = join(homedir(), '.monte');
    console.log(valueText(dir));
  });
