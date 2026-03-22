#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { formatBenchmarkSummary, runBenchmarkSuite } from './harness.js';

interface CliOptions {
  json: boolean;
  output?: string;
  assert: boolean;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    assert: true,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--no-assert') {
      options.assert = false;
      continue;
    }

    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --output');
      }

      options.output = value;
      index++;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const summary = await runBenchmarkSuite();
  const json = JSON.stringify(summary, null, 2);

  if (options.output) {
    await writeFile(options.output, json, 'utf-8');
  }

  if (options.json) {
    process.stdout.write(json);
  } else {
    console.log(formatBenchmarkSummary(summary));
    if (options.output) {
      console.log(`\nWrote JSON summary to ${options.output}`);
    }
  }

  if (options.assert && !summary.pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
