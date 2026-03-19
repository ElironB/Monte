#!/usr/bin/env node

import { Command } from 'commander';
import { simulationCommands } from './commands/simulation.js';
import { personaCommands } from './commands/persona.js';
import { ingestionCommands } from './commands/ingestion.js';
import { configCommands } from './commands/config.js';
import { connectCommands } from './commands/connect.js';
import { loadConfig } from './config.js';

const program = new Command();

program
  .name('monte')
  .description('Monte Engine CLI - Probabilistic life simulation')
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

// Default help
if (process.argv.length === 2) {
  program.help();
}

program.parse();
