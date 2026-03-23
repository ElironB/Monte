import chalk from 'chalk';
import { Command } from 'commander';
import { assertBundledExamplePersonaExists, getBundledExamplePersona, listBundledExamplePersonas } from '../examples.js';
import { groupDiscoveredFiles, resolveDiscoveredFiles, uploadDiscoveredFiles } from '../ingestUtils.js';
import { dimText, icons, infoLabel, sectionHeader, statusColor, valueText } from '../styles.js';

export const exampleCommands = new Command('example')
  .description(chalk.dim('Bundled example personas and starter assets'));

exampleCommands
  .command('list')
  .description(chalk.dim('List bundled example personas'))
  .action(() => {
    const examples = listBundledExamplePersonas();

    console.log(`\n${sectionHeader('Bundled Example Personas')}`);
    for (const example of examples) {
      console.log(`  ${infoLabel(example.id)} ${valueText(`(${example.name})`)}`);
      console.log(`    ${dimText(example.description)}`);
      console.log(`    ${dimText(`Suggested scenario: ${example.recommendedScenario}`)}`);
      console.log(`    ${dimText(`Suggested prompt: ${example.recommendedQuestion}`)}`);
    }
  });

exampleCommands
  .command('path')
  .description(chalk.dim('Print the absolute path to a bundled example persona'))
  .argument('[id]', 'example persona id', 'starter')
  .action((id: string) => {
    console.log(assertBundledExamplePersonaExists(id));
  });

exampleCommands
  .command('ingest')
  .description(chalk.dim('Ingest a bundled example persona into the current Monte API'))
  .argument('[id]', 'example persona id', 'starter')
  .action(async (id: string) => {
    try {
      const example = getBundledExamplePersona(id);
      const examplePath = assertBundledExamplePersonaExists(id);
      const { files } = resolveDiscoveredFiles(examplePath, {
        excludeFilenames: ['README.md'],
      });

      if (files.length === 0) {
        throw new Error(`No files found in bundled example persona: ${examplePath}`);
      }

      const groups = groupDiscoveredFiles(files);

      console.log(`\n${sectionHeader('Bundled Example Persona')}`);
      console.log(`  ${infoLabel('Example:')} ${valueText(example.name)}`);
      console.log(`  ${infoLabel('Path:')} ${dimText(examplePath)}`);
      console.log(`  ${infoLabel('Files:')} ${valueText(files.length)}`);
      console.log(`  ${infoLabel('Prompt:')} ${dimText(example.recommendedQuestion)}`);

      await uploadDiscoveredFiles(groups, {
        onGroupStart: (sourceType) => {
          console.log(`\n${sectionHeader(`Uploading ${sourceType}`)}`);
        },
        onBatchStart: (_sourceType, batchIndex, totalBatches, batchSize) => {
          process.stdout.write(`  ${infoLabel(`[${batchIndex}/${totalBatches}]`)} ${dimText(`Uploading ${batchSize} file(s)...`)}`);
        },
        onBatchComplete: (_sourceType, batchIndex, totalBatches, _batchSize, result) => {
          process.stdout.write(`\r  ${icons.success} ${chalk.green.bold(`Batch ${batchIndex}/${totalBatches}`)} ${dimText('→')} ${chalk.cyan(result.sourceId)} ${statusColor(result.status)}\n`);
        },
      });

      console.log(`\n${icons.success} ${chalk.green.bold('Bundled example ingested')}`);
      console.log(`  ${dimText('Run `monte persona build` next, then ask Monte a hard question with `monte decide "... --wait"`.')}`);
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });
