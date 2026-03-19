import { Command } from 'commander';
import { api } from '../api.js';
import { requireAuth } from '../config.js';

export const personaCommands = new Command('persona')
  .description('Persona management commands');

personaCommands
  .command('status')
  .description('Check persona status')
  .action(async () => {
    requireAuth();
    try {
      const persona = await api.getPersona() as {
        status?: string;
        id?: string;
        version?: number;
        buildStatus?: string;
        traitCount?: number;
        memoryCount?: number;
        message?: string;
      };

      if (persona.status === 'none') {
        console.log('No persona exists yet.');
        console.log('Run `monte persona build` to create one.');
        return;
      }

      console.log('\nPersona Status:');
      console.log(`  ID: ${persona.id}`);
      console.log(`  Version: ${persona.version}`);
      console.log(`  Status: ${persona.buildStatus}`);
      console.log(`  Traits: ${persona.traitCount || 0}`);
      console.log(`  Memories: ${persona.memoryCount || 0}`);
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

personaCommands
  .command('build')
  .description('Build a new persona from your data sources')
  .option('-t, --traits <traits>', 'base traits as JSON (e.g., {"riskTolerance":0.7})')
  .action(async (options) => {
    requireAuth();
    try {
      console.log('Starting persona build...');

      let baseTraits: Record<string, number> | undefined;
      if (options.traits) {
        baseTraits = JSON.parse(options.traits);
      }

      const result = await api.buildPersona(baseTraits) as {
        personaId: string;
        version: number;
        status: string;
        message: string;
      };

      console.log(`✓ Persona build started`);
      console.log(`  ID: ${result.personaId}`);
      console.log(`  Version: ${result.version}`);
      console.log(`  Status: ${result.status}`);
      console.log('\nThis may take a few minutes to complete.');
      console.log('Run `monte persona status` to check progress.');
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

personaCommands
  .command('history')
  .description('View persona build history')
  .action(async () => {
    requireAuth();
    try {
      const history = await api.getPersonaHistory() as Array<{
        id: string;
        version: number;
        buildStatus: string;
        createdAt: string;
      }>;

      if (history.length === 0) {
        console.log('No persona history found');
        return;
      }

      console.log('\nPersona History:');
      console.log('-'.repeat(80));
      console.log(`${'Version'.padEnd(10)} ${'Status'.padEnd(12)} ${'Created'.padEnd(25)} ID`);
      console.log('-'.repeat(80));

      for (const entry of history) {
        const date = new Date(entry.createdAt).toLocaleString();
        console.log(
          `${String(entry.version).padEnd(10)} ${entry.buildStatus.padEnd(12)} ${date.padEnd(25)} ${entry.id.slice(0, 8)}...`
        );
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });

personaCommands
  .command('traits')
  .description('View persona traits')
  .action(async () => {
    requireAuth();
    try {
      const traits = await api.getPersonaTraits() as Array<{
        name: string;
        value: number;
        confidence: number;
        evidence: string;
      }>;

      if (traits.length === 0) {
        console.log('No traits found. Build a persona first.');
        return;
      }

      console.log('\nPersona Traits:');
      console.log('-'.repeat(80));
      console.log(`${'Trait'.padEnd(25)} ${'Value'.padEnd(10)} ${'Confidence'.padEnd(12)} Evidence`);
      console.log('-'.repeat(80));

      for (const trait of traits) {
        const value = (trait.value * 100).toFixed(0) + '%';
        const confidence = (trait.confidence * 100).toFixed(0) + '%';
        console.log(
          `${trait.name.padEnd(25)} ${value.padEnd(10)} ${confidence.padEnd(12)} ${trait.evidence.slice(0, 30)}`
        );
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  });
