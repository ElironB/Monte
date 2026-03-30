import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PERSONALIZATION_MODES,
  buildPersonalizationBootstrapPayload,
  buildPersonalizationContextPayload,
  buildPersonalizationProfilePayload,
} from '../../personalization/builder.js';
import { getLatestPersonalizationSeed } from '../../personalization/repository.js';
import { runQuerySingle } from '../../config/neo4j.js';
import { ConflictError } from '../../utils/errors.js';

const contextSchema = z.object({
  task: z.string().min(1).max(2000),
  agentName: z.string().min(1).max(120).optional(),
  additionalContext: z.string().max(4000).optional(),
  mode: z.enum(PERSONALIZATION_MODES).optional(),
});

const bootstrapSchema = contextSchema;

function getUnavailableMessage(
  result: Exclude<Awaited<ReturnType<typeof getLatestPersonalizationSeed>>, { status: 'ready' }>,
): string {
  if (result.status === 'none') {
    return 'No ready persona is available yet. Run `monte ingest <path>` and `monte persona build` first.';
  }

  if (result.buildStatus === 'building') {
    return `The latest persona build (v${result.version}) is still building. Run \`monte persona status\` and try again when it is ready.`;
  }

  if (result.buildStatus === 'failed') {
    return `The latest persona build (v${result.version}) failed. Fix the underlying issue and run \`monte persona build\` again.`;
  }

  return `The latest persona build (v${result.version}) is not ready yet. Current status: ${result.buildStatus}.`;
}

async function personalizationRoutes(fastify: FastifyInstance) {
  fastify.post('/bootstrap', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Bootstrap an external agent into the correct Monte surface for a task',
      tags: ['personalization'],
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      const body = bootstrapSchema.parse(request.body);
      const [result, sourceCounts] = await Promise.all([
        getLatestPersonalizationSeed(request.user.userId),
        runQuerySingle<{ count: number }>(
          `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)
           RETURN count(d) as count`,
          { userId: request.user.userId },
        ),
      ]);

      const sourceCount = sourceCounts?.count ?? 0;

      if (result.status === 'none') {
        const needsIngestion = sourceCount === 0;
        return buildPersonalizationBootstrapPayload({
          status: needsIngestion ? 'needs_ingestion' : 'needs_persona',
          task: body.task,
          mode: body.mode,
          agentName: body.agentName,
          additionalContext: body.additionalContext,
          nextAction: needsIngestion
            ? {
                command: 'monte ingest <path>',
                description: 'Ingest personal data before asking Monte to personalize.',
              }
            : {
                command: 'monte persona build',
                description: 'Build a persona from the ingested sources before asking Monte to personalize.',
              },
          reasonIfNotReady: needsIngestion
            ? 'No ingested sources were found for this user yet.'
            : 'Sources exist, but no persona has been built yet.',
        });
      }

      if (result.status === 'not_ready') {
        if (result.buildStatus === 'building') {
          return buildPersonalizationBootstrapPayload({
            status: 'building',
            task: body.task,
            mode: body.mode,
            agentName: body.agentName,
            additionalContext: body.additionalContext,
            nextAction: {
              command: 'monte persona status',
              description: 'Wait for the current persona build to finish.',
            },
            reasonIfNotReady: `Persona build v${result.version} is still running.`,
          });
        }

        return buildPersonalizationBootstrapPayload({
          status: 'failed',
          task: body.task,
          mode: body.mode,
          agentName: body.agentName,
          additionalContext: body.additionalContext,
          nextAction: {
            command: 'monte persona build',
            description: 'Rebuild the persona after fixing the underlying issue.',
          },
          reasonIfNotReady: `Persona build v${result.version} is not ready. Current status: ${result.buildStatus}.`,
        });
      }

      return buildPersonalizationBootstrapPayload({
        status: 'ready',
        task: body.task,
        mode: body.mode,
        agentName: body.agentName,
        additionalContext: body.additionalContext,
        nextAction: {
          command: 'monte personalize context "<task>" --json',
          description: 'Use task-aware personalization by default for agent workflows.',
        },
        seed: result.seed,
      });
    },
  });

  fastify.get('/profile', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Get the latest agent-ready personalization profile',
      tags: ['personalization'],
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      const result = await getLatestPersonalizationSeed(request.user.userId);
      if (result.status !== 'ready') {
        throw new ConflictError(getUnavailableMessage(result));
      }

      return buildPersonalizationProfilePayload(result.seed);
    },
  });

  fastify.post('/context', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Build task-aware personalization guidance for an agent',
      tags: ['personalization'],
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      const body = contextSchema.parse(request.body);
      const result = await getLatestPersonalizationSeed(request.user.userId);

      if (result.status !== 'ready') {
        throw new ConflictError(getUnavailableMessage(result));
      }

      return buildPersonalizationContextPayload(result.seed, body);
    },
  });
}

export default personalizationRoutes;
