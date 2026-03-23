import chalk from 'chalk';
import { Command } from 'commander';
import { api } from '../api.js';
import { printJson, printJsonErrorAndExit } from '../output.js';
import { ParsedSimulation, parseSimulationQuery, SCENARIO_TYPES } from '../queryParser.js';
import { dimText, icons, infoLabel, progressBar, sectionHeader, valueText, warningText } from '../styles.js';
import { SimulationCreateResult, SimulationProgressResult, SimulationResultsPayload, waitForSimulationData } from './simulation.js';

type DecisionMode = 'fast' | 'standard' | 'deep';

const DECISION_MODE_CLONE_COUNTS: Record<DecisionMode, number> = {
  fast: 50,
  standard: 200,
  deep: 1000,
};

interface DecidePayload {
  ok: true;
  simulation: {
    id: string;
    name: string;
    scenarioType: string;
    status: string;
    cloneCount: number;
    mode: DecisionMode;
  };
  poll?: {
    progressCommand: string;
    resultsCommand: string;
  };
  decision?: {
    summary: string;
    successRate: number;
    failureRate: number;
    neutralRate: number;
    meanCapital: number;
    meanHealth: number;
    meanHappiness: number;
    topUncertainties: string[];
    recommendedExperiments: unknown[];
    rerunComparison?: NonNullable<SimulationResultsPayload['distributions']>['rerunComparison'];
  };
  results?: NonNullable<SimulationResultsPayload['distributions']>;
}

function isDecisionMode(value: unknown): value is DecisionMode {
  return value === 'fast' || value === 'standard' || value === 'deep';
}

function isScenarioType(value: unknown): value is typeof SCENARIO_TYPES[number] {
  return typeof value === 'string' && SCENARIO_TYPES.includes(value as typeof SCENARIO_TYPES[number]);
}

function buildDecisionSummary(results: NonNullable<SimulationResultsPayload['distributions']>) {
  return {
    summary: results.decisionIntelligence?.summary
      || `Monte simulated ${results.cloneCount} clones with a ${Math.round(results.statistics.successRate * 100)}% success rate.`,
    successRate: results.outcomeDistribution.success,
    failureRate: results.outcomeDistribution.failure,
    neutralRate: results.outcomeDistribution.neutral,
    meanCapital: results.statistics.meanCapital,
    meanHealth: results.statistics.meanHealth,
    meanHappiness: results.statistics.meanHappiness,
    topUncertainties: results.decisionIntelligence?.dominantUncertainties ?? [],
    recommendedExperiments: results.decisionIntelligence?.recommendedExperiments ?? [],
    rerunComparison: results.rerunComparison,
  };
}

export function buildDecideJsonPayload(options: {
  simulation: SimulationCreateResult & { scenarioType: string; name: string };
  mode: DecisionMode;
  results?: NonNullable<SimulationResultsPayload['distributions']>;
}): DecidePayload {
  const basePayload: DecidePayload = {
    ok: true,
    simulation: {
      id: options.simulation.simulationId,
      name: options.simulation.name,
      scenarioType: options.simulation.scenarioType,
      status: options.simulation.status,
      cloneCount: options.simulation.cloneCount,
      mode: options.mode,
    },
  };

  if (!options.results) {
    return {
      ...basePayload,
      poll: {
        progressCommand: `monte simulate progress ${options.simulation.simulationId} --json`,
        resultsCommand: `monte simulate results ${options.simulation.simulationId} -f json`,
      },
    };
  }

  return {
    ...basePayload,
    decision: buildDecisionSummary(options.results),
    results: options.results,
  };
}

function buildSimulationRequest(
  parsed: ParsedSimulation,
  options: {
    scenario?: string;
    capitalAtRisk?: number;
    mode: DecisionMode;
  },
) {
  const scenarioType = options.scenario && isScenarioType(options.scenario)
    ? options.scenario
    : parsed.scenarioType;

  const parameters = parsed.timeframe === undefined
    ? parsed.context
    : { ...parsed.context, timeframe: parsed.timeframe };

  return {
    scenarioType,
    name: parsed.name,
    capitalAtRisk: options.capitalAtRisk ?? parsed.capitalAtRisk,
    parameters,
    cloneCount: DECISION_MODE_CLONE_COUNTS[options.mode],
  };
}

export const decideCommands = new Command('decide')
  .description(chalk.dim('Agent-first decision command with machine-readable output support'))
  .argument('<query...>', 'Describe the decision in plain English')
  .option('--mode <mode>', 'execution profile: fast, standard, or deep', 'standard')
  .option('--wait', 'wait for completion and include decision results', false)
  .option('--json', 'output machine-readable JSON', false)
  .option('--capital-at-risk <amount>', 'capital at risk for Kelly sizing', parseFloat)
  .option('--scenario <type>', 'override the detected scenario type')
  .action(async (queryParts: string[], options: {
    mode?: string;
    wait?: boolean;
    json?: boolean;
    capitalAtRisk?: number;
    scenario?: string;
  }) => {
    try {
      if (!isDecisionMode(options.mode)) {
        throw new Error(`Invalid decision mode: ${options.mode}`);
      }
      if (options.scenario && !isScenarioType(options.scenario)) {
        throw new Error(`Invalid scenario type: ${options.scenario}`);
      }

      const query = queryParts.join(' ').trim();
      const parsed = await parseSimulationQuery(query);
      const request = buildSimulationRequest(parsed, {
        scenario: options.scenario,
        capitalAtRisk: options.capitalAtRisk,
        mode: options.mode,
      });

      if (!options.json) {
        console.log(`\n${sectionHeader('Decision Parse')}`);
        console.log(`  ${infoLabel('Scenario:')} ${valueText(request.scenarioType)}`);
        console.log(`  ${infoLabel('Name:')} ${valueText(request.name)}`);
        console.log(`  ${infoLabel('Mode:')} ${valueText(options.mode)}`);
        console.log(`  ${infoLabel('Clones:')} ${valueText(request.cloneCount)}`);
        if (request.capitalAtRisk !== undefined) {
          console.log(`  ${infoLabel('Capital at risk:')} ${valueText(`$${request.capitalAtRisk.toLocaleString()}`)}`);
        }
        console.log();
      }

      const simulation = await api.createSimulation(request.scenarioType, request.name, {
        cloneCount: request.cloneCount,
        capitalAtRisk: request.capitalAtRisk,
        parameters: request.parameters,
      }) as SimulationCreateResult;

      const simulationWithMetadata = {
        ...simulation,
        scenarioType: request.scenarioType,
        name: request.name,
      };

      if (!options.wait) {
        if (options.json) {
          printJson(buildDecideJsonPayload({
            simulation: simulationWithMetadata,
            mode: options.mode,
          }));
          return;
        }

        console.log(`${icons.success} ${chalk.green.bold('Decision queued')}`);
        console.log(`  ${infoLabel('Simulation ID:')} ${chalk.cyan(simulation.simulationId)}`);
        console.log(`  ${infoLabel('Status:')} ${valueText(simulation.status)}`);
        console.log(`  ${dimText(`Poll with \`monte simulate progress ${simulation.simulationId} --json\` or fetch final results with \`monte simulate results ${simulation.simulationId} -f json\`.`)}`);
        return;
      }

      if (!options.json) {
        console.log(`${infoLabel('Waiting for completion...')}`);
      }

      const results = await waitForSimulationData(simulation.simulationId, {
        onProgress: options.json
          ? undefined
          : (progress: SimulationProgressResult) => {
              const phase = progress.phase
                ? ` ${dimText(progress.phase)}`
                : '';
              process.stdout.write(
                `\r${infoLabel('Progress:')} [${progressBar(progress.progress)}] ${chalk.cyan.bold(`${progress.progress}%`)} ${dimText(`(${progress.processedClones ?? 0}/${progress.cloneCount} clones)`)}${phase}`
              );
            },
        onStall: options.json
          ? undefined
          : (progress, stagnantPolls) => {
              process.stdout.write('\n');
              console.log(warningText(`No progress update for ~${stagnantPolls * 2}s while Monte is ${progress.phase ?? progress.status}.`));
            },
      });

      if (options.json) {
        printJson(buildDecideJsonPayload({
          simulation: {
            ...simulationWithMetadata,
            status: 'completed',
          },
          mode: options.mode,
          results,
        }));
        return;
      }

      process.stdout.write('\n');
      console.log(`\n${sectionHeader('Decision Summary')}`);
      console.log(`  ${infoLabel('Success:')} ${valueText(`${(results.outcomeDistribution.success * 100).toFixed(1)}%`)}`);
      console.log(`  ${infoLabel('Failure:')} ${valueText(`${(results.outcomeDistribution.failure * 100).toFixed(1)}%`)}`);
      console.log(`  ${infoLabel('Neutral:')} ${valueText(`${(results.outcomeDistribution.neutral * 100).toFixed(1)}%`)}`);
      console.log(`  ${infoLabel('Mean Capital:')} ${valueText(`$${results.statistics.meanCapital.toFixed(0)}`)}`);
      if (results.decisionIntelligence?.summary) {
        console.log(`\n  ${dimText(results.decisionIntelligence.summary)}`);
      }
      if ((results.decisionIntelligence?.dominantUncertainties ?? []).length > 0) {
        console.log(`\n${sectionHeader('Top Uncertainties')}`);
        for (const uncertainty of results.decisionIntelligence?.dominantUncertainties ?? []) {
          console.log(`  - ${uncertainty}`);
        }
      }
    } catch (err) {
      if (options.json) {
        printJsonErrorAndExit(err);
      }
      console.error(`${icons.error} ${(err as Error).message}`);
      process.exit(1);
    }
  });
