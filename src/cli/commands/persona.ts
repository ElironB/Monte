import chalk from 'chalk';
import { Command } from 'commander';
import { api } from '../api.js';
import { DIMENSION_KEYS } from '../dimensionMetadata.js';
import {
  dimText,
  dimensionColor,
  icons,
  infoLabel,
  sectionHeader,
  statusColor,
  valueText,
} from '../styles.js';

const DIMENSION_NAMES = new Set(DIMENSION_KEYS);

function divider(width: number): string {
  return chalk.dim('─'.repeat(width));
}

function asCount(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

export const personaCommands = new Command('persona')
  .description(chalk.dim('Persona management commands'));

personaCommands
  .command('status')
  .description(chalk.dim('Check persona status'))
  .action(async () => {
    try {
      const persona = await api.getPersona() as {
        status?: string;
        id?: string;
        version?: number;
        buildStatus?: string;
        traitCount?: number;
        memoryCount?: number;
        lastError?: string | null;
      };

      if (persona.status === 'none') {
        console.log(dimText('No persona exists yet.'));
        console.log(dimText('Run `monte persona build` to create one.'));
        return;
      }

      console.log(`\n${sectionHeader('Persona Status')}`);
      console.log(`  ${infoLabel('ID:')} ${dimText(persona.id || 'unknown')}`);
      console.log(`  ${infoLabel('Version:')} ${valueText(persona.version || 0)}`);
      console.log(`  ${infoLabel('Status:')} ${statusColor(persona.buildStatus || 'unknown')}`);
      console.log(`  ${infoLabel('Traits:')} ${valueText(asCount(persona.traitCount))}`);
      console.log(`  ${infoLabel('Memories:')} ${valueText(asCount(persona.memoryCount))}`);
      if (persona.lastError) {
        console.log(`  ${infoLabel('Last error:')} ${chalk.red(persona.lastError)}`);
      }
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

personaCommands
  .command('build')
  .description(chalk.dim('Build a new persona from your data sources'))
  .option('-t, --traits <traits>', 'base traits as JSON (e.g., {"riskTolerance":0.7})')
  .action(async (options) => {
    try {
      console.log(infoLabel('Starting persona build...'));

      let baseTraits: Record<string, number> | undefined;
      if (options.traits) {
        baseTraits = JSON.parse(options.traits);
      }

      const result = await api.buildPersona(baseTraits) as {
        personaId: string;
        version: number;
        status: string;
      };

      console.log(`${icons.success} ${chalk.green.bold('Persona build started')}`);
      console.log(`  ${infoLabel('ID:')} ${dimText(result.personaId)}`);
      console.log(`  ${infoLabel('Version:')} ${valueText(result.version)}`);
      console.log(`  ${infoLabel('Status:')} ${statusColor(result.status)}`);
      console.log(`\n${dimText('This may take a few minutes to complete.')}`);
      console.log(dimText('Run `monte persona status` to check progress.'));
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

personaCommands
  .command('history')
  .description(chalk.dim('View persona build history'))
  .action(async () => {
    try {
      const history = await api.getPersonaHistory() as Array<{
        id: string;
        version: number;
        buildStatus: string;
        createdAt: string;
      }>;

      if (history.length === 0) {
        console.log(dimText('No persona history found'));
        return;
      }

      console.log(`\n${sectionHeader('Persona History')}`);
      console.log(divider(92));
      console.log(`  ${infoLabel('Version'.padEnd(10))} ${infoLabel('Status'.padEnd(12))} ${infoLabel('Created'.padEnd(25))} ${infoLabel('ID')}`);
      console.log(divider(92));

      for (const entry of history) {
        const date = new Date(entry.createdAt).toLocaleString();
        console.log(
          `  ${valueText(String(entry.version).padEnd(10))} ${statusColor(entry.buildStatus, 12)} ${dimText(date.padEnd(25))} ${dimText(`${entry.id.slice(0, 8)}...`)}`,
        );
      }
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

personaCommands
  .command('traits')
  .description(chalk.dim('View persona traits'))
  .action(async () => {
    try {
      const traits = await api.getPersonaTraits() as Array<{
        name: string;
        value: number;
        confidence: number;
        evidence: string;
      }>;

      if (traits.length === 0) {
        console.log(dimText('No traits found. Build a persona first.'));
        return;
      }

      const dimensions = traits.filter((trait) => DIMENSION_NAMES.has(trait.name));
      const signals = traits.filter((trait) => !DIMENSION_NAMES.has(trait.name));

      console.log(`\n${sectionHeader('Persona Traits')}`);

      if (dimensions.length > 0) {
        console.log(`\n${sectionHeader('Behavioral Dimensions')}`);
        console.log(divider(96));
        console.log(`  ${infoLabel('Trait'.padEnd(25))} ${infoLabel('Value'.padEnd(10))} ${infoLabel('Confidence'.padEnd(12))} ${infoLabel('Evidence')}`);
        console.log(divider(96));

        for (const trait of dimensions) {
          const confidence = `${(trait.confidence * 100).toFixed(0)}%`;
          console.log(
            `  ${chalk.white.bold(trait.name.padEnd(25))} ${dimensionColor(trait.value).padEnd(19)} ${chalk.cyan(confidence.padEnd(12))} ${dimText(trait.evidence.slice(0, 40))}`,
          );
        }
      }

      if (signals.length > 0) {
        console.log(`\n${sectionHeader('Supporting Signals')}`);
        console.log(divider(96));
        console.log(`  ${infoLabel('Trait'.padEnd(25))} ${infoLabel('Value'.padEnd(10))} ${infoLabel('Confidence'.padEnd(12))} ${infoLabel('Evidence')}`);
        console.log(divider(96));

        for (const trait of signals) {
          const value = `${(trait.value * 100).toFixed(0)}%`;
          const confidence = `${(trait.confidence * 100).toFixed(0)}%`;
          console.log(
            `  ${chalk.white(trait.name.padEnd(25))} ${valueText(value.padEnd(10))} ${chalk.cyan(confidence.padEnd(12))} ${dimText(trait.evidence.slice(0, 40))}`,
          );
        }
      }
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

personaCommands
  .command('psychology')
  .description(chalk.dim('View psychological profile derived from behavioral data'))
  .option('--format <format>', 'Output format: json or human (default: human)')
  .action(async (options) => {
    try {
      const profile = await api.getPersonaPsychology() as {
        status?: string;
        message?: string;
        bigFive?: {
          openness: number;
          conscientiousness: number;
          extraversion: number;
          agreeableness: number;
          neuroticism: number;
          dominantTrait: string;
          deficitTrait: string;
        };
        attachment?: { style: string; anxietyAxis: number; avoidanceAxis: number };
        locusOfControl?: { type: string; score: number };
        temporalDiscounting?: { discountingRate: string; score: number };
        riskFlags?: Array<{ flag: string; severity: 'low' | 'medium' | 'high'; description: string }>;
        narrativeSummary?: string;
        technicalSummary?: string;
      };

      if (profile.status === 'none') {
        console.log(dimText(profile.message || 'No psychological profile available.'));
        return;
      }

      if (options.format === 'json') {
        console.log(JSON.stringify({
          bigFive: {
            O: profile.bigFive?.openness,
            C: profile.bigFive?.conscientiousness,
            E: profile.bigFive?.extraversion,
            A: profile.bigFive?.agreeableness,
            N: profile.bigFive?.neuroticism,
            dominant: profile.bigFive?.dominantTrait,
            deficit: profile.bigFive?.deficitTrait,
          },
          attachment: profile.attachment?.style,
          locusOfControl: { type: profile.locusOfControl?.type, score: profile.locusOfControl?.score },
          temporalDiscounting: { rate: profile.temporalDiscounting?.discountingRate, score: profile.temporalDiscounting?.score },
          riskFlags: profile.riskFlags,
          narrative: profile.narrativeSummary,
        }, null, 2));
        return;
      }

      // Human-readable output
      console.log(`\n${sectionHeader('Behavioral Psychology Profile')}`);

      if (profile.narrativeSummary) {
        console.log(`\n${dimText(profile.narrativeSummary)}`);
      }

      if (profile.bigFive) {
        const bf = profile.bigFive;
        console.log(`\n${sectionHeader('Big Five (OCEAN)')}`);
        const fmt = (v: number) => `${(v * 100).toFixed(0)}%`;
        console.log(`  ${infoLabel('Openness:         ')} ${dimensionColor(bf.openness)}  ${dimText(fmt(bf.openness))}`);
        console.log(`  ${infoLabel('Conscientiousness:')} ${dimensionColor(bf.conscientiousness)}  ${dimText(fmt(bf.conscientiousness))}`);
        console.log(`  ${infoLabel('Extraversion:     ')} ${dimensionColor(bf.extraversion)}  ${dimText(fmt(bf.extraversion))}`);
        console.log(`  ${infoLabel('Agreeableness:    ')} ${dimensionColor(bf.agreeableness)}  ${dimText(fmt(bf.agreeableness))}`);
        console.log(`  ${infoLabel('Neuroticism:      ')} ${dimensionColor(bf.neuroticism)}  ${dimText(fmt(bf.neuroticism))}`);
        console.log(`  ${infoLabel('Dominant trait:   ')} ${valueText(bf.dominantTrait)}   ${infoLabel('Deficit:')} ${valueText(bf.deficitTrait)}`);
      }

      if (profile.attachment) {
        console.log(`\n  ${infoLabel('Attachment style:')} ${valueText(profile.attachment.style)}`);
      }
      if (profile.locusOfControl) {
        console.log(`  ${infoLabel('Locus of control:')} ${valueText(profile.locusOfControl.type)} ${dimText(`(${(profile.locusOfControl.score * 100).toFixed(0)}% internal)`)}`);
      }
      if (profile.temporalDiscounting) {
        console.log(`  ${infoLabel('Time discounting: ')} ${valueText(profile.temporalDiscounting.discountingRate)}`);
      }

      if (profile.riskFlags && profile.riskFlags.length > 0) {
        console.log(`\n${sectionHeader('Risk Flags')}`);
        const SEVERITY_ICON: Record<string, string> = { high: '⚠️ ', medium: 'ℹ️ ', low: '✓  ' };
        for (const flag of profile.riskFlags) {
          const icon = SEVERITY_ICON[flag.severity] || '  ';
          const label = flag.severity === 'high'
            ? chalk.red.bold(flag.flag)
            : flag.severity === 'medium'
              ? chalk.yellow(flag.flag)
              : chalk.green(flag.flag);
          console.log(`  ${icon}${label} ${dimText(`[${flag.severity}]`)}`);
          console.log(`     ${dimText(flag.description.slice(0, 90))}${flag.description.length > 90 ? '...' : ''}`);
        }
      } else if (profile.riskFlags) {
        console.log(`\n  ${icons.success} ${dimText('No risk flags detected.')}`);
      }
    } catch (err) {
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });
