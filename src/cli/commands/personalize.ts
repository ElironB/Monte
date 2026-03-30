import chalk from 'chalk';
import { Command } from 'commander';
import type {
  PersonalizationBootstrapPayload,
  PersonalizationContextPayload,
  PersonalizationProfile,
  PersonalizationProfilePayload,
} from '../../personalization/builder.js';
import { api } from '../api.js';
import { printJson, printJsonErrorAndExit } from '../output.js';
import { dimText, icons, infoLabel, sectionHeader, valueText } from '../styles.js';

function divider(width: number): string {
  return chalk.dim('─'.repeat(width));
}

function formatList(items: string[], empty: string): string[] {
  if (items.length === 0) {
    return [`  ${dimText(empty)}`];
  }

  return items.map((item) => `  - ${item}`);
}

export function renderPersonalizationProfile(profile: PersonalizationProfile): string {
  const lines: string[] = [];

  lines.push(`\n${sectionHeader('Personalization Profile')}`);
  lines.push(`  ${infoLabel('Persona ID:')} ${dimText(profile.personaId)}`);
  lines.push(`  ${infoLabel('Version:')} ${valueText(profile.version)}`);
  lines.push(`  ${infoLabel('Summary:')} ${dimText(profile.summary)}`);
  lines.push(`  ${infoLabel('Sources:')} ${valueText(profile.sourceCoverage.sourceTypes.join(', ') || 'none')}`);
  lines.push(`  ${infoLabel('Signals:')} ${valueText(profile.sourceCoverage.signalCount)}`);

  lines.push(`\n${sectionHeader('Interaction Style')}`);
  lines.push(divider(92));
  lines.push(`  ${infoLabel('Communication:')} ${valueText(`${profile.guidance.communication.directness} directness`)} ${dimText('|')} ${valueText(`${profile.guidance.communication.structure} structure`)} ${dimText('|')} ${valueText(`${profile.guidance.communication.verbosity} verbosity`)} ${dimText('|')} ${valueText(profile.guidance.communication.tone)}`);
  lines.push(`  ${infoLabel('Collaboration:')} ${valueText(profile.guidance.collaboration.autonomy)} ${dimText('|')} ${valueText(profile.guidance.collaboration.clarificationStyle)} ${dimText('|')} ${valueText(profile.guidance.collaboration.challengeStyle)} ${dimText('|')} ${valueText(`${profile.guidance.collaboration.optionCount} options`)}`);
  lines.push(`  ${infoLabel('Decisioning:')} ${valueText(profile.guidance.decisioning.pace)} ${dimText('|')} ${valueText(profile.guidance.decisioning.riskFrame)} ${dimText('|')} ${valueText(`${profile.guidance.decisioning.reassuranceNeed} reassurance`)}`);

  lines.push(`\n${sectionHeader('Do')}`);
  lines.push(...formatList(profile.guidance.do, 'No specific do guidance.'));

  lines.push(`\n${sectionHeader('Avoid')}`);
  lines.push(...formatList(profile.guidance.dont, 'No specific avoid guidance.'));

  lines.push(`\n${sectionHeader('Watchouts')}`);
  lines.push(...formatList(profile.guidance.watchouts, 'No specific watchouts.'));

  lines.push(`\n${sectionHeader('Instruction Block')}`);
  lines.push(profile.instructionBlock);

  return lines.join('\n');
}

export function renderPersonalizationContext(payload: PersonalizationContextPayload): string {
  const lines: string[] = [];

  lines.push(renderPersonalizationProfile(payload.profile));
  lines.push(`\n${sectionHeader('Task Context')}`);
  lines.push(`  ${infoLabel('Mode:')} ${valueText(payload.mode)}`);
  lines.push(`  ${infoLabel('Task:')} ${dimText(payload.task)}`);
  lines.push(`  ${infoLabel('Response shape:')} ${dimText(payload.taskAdaptation.responseShape)}`);

  lines.push(`\n${sectionHeader('Emphasis')}`);
  lines.push(...formatList(payload.taskAdaptation.emphasis, 'No task emphasis.'));

  lines.push(`\n${sectionHeader('Guardrails')}`);
  lines.push(...formatList(payload.taskAdaptation.guardrails, 'No extra guardrails.'));

  lines.push(`\n${sectionHeader('Task Do')}`);
  lines.push(...formatList(payload.taskAdaptation.do, 'No extra task guidance.'));

  lines.push(`\n${sectionHeader('Task Avoid')}`);
  lines.push(...formatList(payload.taskAdaptation.dont, 'No extra task avoid guidance.'));

  lines.push(`\n${sectionHeader('Task Instruction Block')}`);
  lines.push(payload.instructionBlock);

  return lines.join('\n');
}

export function renderPersonalizationBootstrap(payload: PersonalizationBootstrapPayload): string {
  const lines: string[] = [];

  lines.push(`\n${sectionHeader('Agent Bootstrap')}`);
  lines.push(`  ${infoLabel('Status:')} ${valueText(payload.status)}`);
  lines.push(`  ${infoLabel('Task:')} ${dimText(payload.task)}`);
  lines.push(`  ${infoLabel('Mode:')} ${valueText(payload.mode)}`);
  lines.push(`  ${infoLabel('Preferred surface:')} ${valueText(payload.recommendedSurface)}`);
  lines.push(`  ${infoLabel('Next action:')} ${dimText(`${payload.nextAction.command} — ${payload.nextAction.description}`)}`);

  if (payload.reasonIfNotReady) {
    lines.push(`  ${infoLabel('Reason:')} ${dimText(payload.reasonIfNotReady)}`);
  }

  if (payload.profile) {
    lines.push(renderPersonalizationProfile(payload.profile));
  }

  if (payload.taskAdaptation) {
    lines.push(`\n${sectionHeader('Task Adaptation')}`);
    lines.push(`  ${infoLabel('Response shape:')} ${dimText(payload.taskAdaptation.responseShape)}`);
    lines.push(`\n${sectionHeader('Bootstrap Instruction Block')}`);
    lines.push(payload.instructionBlock);
    return lines.join('\n');
  }

  lines.push(`\n${sectionHeader('Bootstrap Instruction Block')}`);
  lines.push(payload.instructionBlock);
  return lines.join('\n');
}

export const personalizeCommands = new Command('personalize')
  .description(chalk.dim('Expose agent-ready personalization guidance'));

personalizeCommands
  .command('bootstrap')
  .description(chalk.dim('Bootstrap an external agent into the right Monte surface for a task'))
  .argument('<task...>', 'Describe the task the agent is about to do')
  .option('--mode <mode>', 'personalization mode: general, decision, writing, planning, or learning')
  .option('--agent-name <name>', 'label for the consuming agent')
  .option('--context <text>', 'extra task context used for classification and routing')
  .option('--json', 'output machine-readable JSON', false)
  .action(async (
    taskParts: string[],
    options: {
      mode?: string;
      agentName?: string;
      context?: string;
      json?: boolean;
    },
  ) => {
    try {
      const task = taskParts.join(' ').trim();
      const payload = await api.getPersonalizationBootstrap({
        task,
        mode: options.mode,
        agentName: options.agentName,
        additionalContext: options.context,
      }) as PersonalizationBootstrapPayload;

      if (options.json) {
        printJson(payload);
        return;
      }

      console.log(renderPersonalizationBootstrap(payload));
    } catch (err) {
      if (options.json) {
        printJsonErrorAndExit(err);
      }
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

personalizeCommands
  .command('profile')
  .description(chalk.dim('Show the latest personalization profile'))
  .option('--json', 'output machine-readable JSON', false)
  .action(async (options: { json?: boolean }) => {
    try {
      const payload = await api.getPersonalizationProfile() as PersonalizationProfilePayload;

      if (options.json) {
        printJson(payload);
        return;
      }

      console.log(renderPersonalizationProfile(payload.profile));
    } catch (err) {
      if (options.json) {
        printJsonErrorAndExit(err);
      }
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });

personalizeCommands
  .command('context')
  .description(chalk.dim('Build task-aware personalization guidance'))
  .argument('<task...>', 'Describe the task the agent is about to do')
  .option('--mode <mode>', 'personalization mode: general, decision, writing, planning, or learning')
  .option('--agent-name <name>', 'label for the consuming agent')
  .option('--context <text>', 'extra task context used for classification and adaptation')
  .option('--json', 'output machine-readable JSON', false)
  .action(async (
    taskParts: string[],
    options: {
      mode?: string;
      agentName?: string;
      context?: string;
      json?: boolean;
    },
  ) => {
    try {
      const task = taskParts.join(' ').trim();
      const payload = await api.getPersonalizationContext({
        task,
        mode: options.mode,
        agentName: options.agentName,
        additionalContext: options.context,
      }) as PersonalizationContextPayload;

      if (options.json) {
        printJson(payload);
        return;
      }

      console.log(renderPersonalizationContext(payload));
    } catch (err) {
      if (options.json) {
        printJsonErrorAndExit(err);
      }
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });
