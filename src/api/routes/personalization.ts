import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PERSONALIZATION_MODES,
  buildPersonalizationContextPayload,
  buildPersonalizationProfilePayload,
} from '../../personalization/builder.js';
import { getLatestPersonalizationSeed } from '../../personalization/repository.js';
import { ConflictError } from '../../utils/errors.js';

const contextSchema = z.object({
  task: z.string().min(1).max(2000),
  agentName: z.string().min(1).max(120).optional(),
  additionalContext: z.string().max(4000).optional(),
  mode: z.enum(PERSONALIZATION_MODES).optional(),
});

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
