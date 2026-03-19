import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { SyntheticGenerator, GeneratedPersona } from '../../persona/syntheticGenerator.js';

export const generateCommands = new Command('generate')
  .description('Generate synthetic persona data from a natural language description')
  .argument('<description>', 'Natural language persona description')
  .option('-o, --output <dir>', 'Output directory', './generated-persona')
  .option('--entries <count>', 'Approximate entries per file', '50')
  .option('--timespan <months>', 'Data timespan in months', '6')
  .action(async (description: string, options: { output: string; entries: string; timespan: string }) => {
    const outputDir = resolve(options.output);
    const entries = parseInt(options.entries, 10);
    const timespanMonths = parseInt(options.timespan, 10);

    if (isNaN(entries) || entries < 1) {
      console.error('Error: --entries must be a positive integer');
      process.exit(1);
    }
    if (isNaN(timespanMonths) || timespanMonths < 1) {
      console.error('Error: --timespan must be a positive integer');
      process.exit(1);
    }

    console.log('Generating persona data...\n');

    const generator = new SyntheticGenerator();

    let persona: GeneratedPersona;
    try {
      persona = await generator.generate({
        description,
        entries,
        timespanMonths,
        outputDir,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      return process.exit(1);
    }

    mkdirSync(join(outputDir, 'notes'), { recursive: true });

    const searchHistoryStr = JSON.stringify(persona.searchHistory, null, 2);
    const searchHistoryPath = join(outputDir, 'search-history.json');
    writeFileSync(searchHistoryPath, searchHistoryStr);
    const searchCount = (persona.searchHistory as { searches?: unknown[] }).searches?.length ?? 0;
    console.log(`✓ search-history.json    (${searchCount} entries, ${timespanMonths} months)`);

    const redditPostsStr = JSON.stringify(persona.redditPosts, null, 2);
    const redditPostsPath = join(outputDir, 'reddit-posts.json');
    writeFileSync(redditPostsPath, redditPostsStr);
    const postCount = (persona.redditPosts as { posts?: unknown[] }).posts?.length ?? 0;
    console.log(`✓ reddit-posts.json      (${postCount} posts, ${timespanMonths} months)`);

    const transactionsPath = join(outputDir, 'transactions.csv');
    writeFileSync(transactionsPath, persona.transactions);
    const txLines = persona.transactions.trim().split('\n').length - 1;
    console.log(`✓ transactions.csv       (${txLines} transactions, ${timespanMonths} months)`);

    const watchHistoryStr = JSON.stringify(persona.watchHistory, null, 2);
    const watchHistoryPath = join(outputDir, 'watch-history.json');
    writeFileSync(watchHistoryPath, watchHistoryStr);
    const watchCount = (persona.watchHistory as { history?: unknown[] }).history?.length ?? 0;
    console.log(`✓ watch-history.json     (${watchCount} videos, ${timespanMonths} months)`);

    const notesPath = join(outputDir, 'notes', 'reflections.md');
    writeFileSync(notesPath, persona.notes);
    const wordCount = persona.notes.split(/\s+/).length;
    console.log(`✓ notes/reflections.md   (${wordCount.toLocaleString()} words)`);

    console.log(`\nPersona files saved to ${outputDir}/`);
    console.log(`Run \`monte ingest ${options.output}\` to load this persona.`);
  });
