#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { simulationCommands } from './commands/simulation.js';
import { personaCommands } from './commands/persona.js';
import { ingestionCommands } from './commands/ingestion.js';
import { configCommands } from './commands/config.js';
import { connectCommands } from './commands/connect.js';
import { reportCommands } from './commands/report.js';
import { generateCommands } from './commands/generate.js';
import { compareCommands } from './commands/compare.js';
import { doctorCommands } from './commands/doctor.js';
import { decideCommands } from './commands/decide.js';
import { exampleCommands } from './commands/example.js';
import { startCommands } from './commands/start.js';
import { loadConfig } from './config.js';

const program = new Command();

program
  .name('monte')
  .description(chalk.dim('Probabilistic life simulation engine'))
  .version('0.1.0');

// Global options
program.option('-v, --verbose', 'verbose output', false);
program.option('--api <url>', 'API endpoint', loadConfig().apiUrl || 'http://localhost:3000');

// Commands
program.addCommand(simulationCommands);
program.addCommand(personaCommands);
program.addCommand(ingestionCommands);
program.addCommand(configCommands);
program.addCommand(connectCommands);
program.addCommand(reportCommands);
program.addCommand(generateCommands);
program.addCommand(compareCommands);
program.addCommand(doctorCommands);
program.addCommand(decideCommands);
program.addCommand(exampleCommands);
program.addCommand(startCommands);

// Default help
if (process.argv.length === 2) {
  program.help();
}

program.parse();
