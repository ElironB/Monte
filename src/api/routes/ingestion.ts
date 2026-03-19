import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
import { cacheGet, cacheSet } from '../../config/redis.js';
import { uploadFile } from '../../config/minio.js';
import { scheduleIngestionJob } from '../../ingestion/queue/ingestionQueue.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { v4 as uuidv4 } from 'uuid';

const dataSourceSchema = z.object({
  sourceType: z.enum(['obsidian', 'notion', 'file', 'composio']),
  name: z.string().min(1).max(100),
  metadata: z.record(z.unknown()).optional(),
});

const uploadSchema = z.object({
  files: z.array(z.object({
    filename: z.string(),
    content: z.string(),
    mimetype: z.string(),
  })),
});

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  sortBy: z.enum(['createdAt', 'name', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

const CACHE_TTL = 60; // 1 minute for data source lists

async function ingestionRoutes(fastify: FastifyInstance) {
  // List data sources with pagination and filtering
  fastify.get('/sources', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'List data sources with pagination',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20 },
          status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
          sortBy: { type: 'string', enum: ['createdAt', 'name', 'status'] },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
    },
    handler: async (request: FastifyRequest) => {
      const query = listQuerySchema.parse(request.query);
      const skip = (query.page - 1) * query.limit;
      const cacheKey = `sources:${request.user.userId}:${query.page}:${query.limit}:${query.status || 'all'}:${query.sortBy}:${query.sortOrder}`;

      // Try cache first
      const cached = await cacheGet<{
        data: unknown[];
        pagination: unknown;
        cached: boolean;
      }>(cacheKey);

      if (cached) {
        return { ...cached, cached: true };
      }

      // Build where clause
      let whereClause = '';
      const params: Record<string, unknown> = { userId: request.user.userId, skip, limit: query.limit };

      if (query.status) {
        whereClause = 'WHERE d.status = $status';
        params.status = query.status;
      }

      // Fetch data with pagination
      const [sources, countResult] = await Promise.all([
        runQuery<{
          id: string;
          sourceType: string;
          name: string;
          status: string;
          signalCount: number;
          createdAt: string;
        }>(
          `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)
           ${whereClause}
           RETURN d.id as id, d.sourceType as sourceType, d.name as name, d.status as status,
                  d.signalCount as signalCount, d.createdAt as createdAt
           ORDER BY d.${query.sortBy} ${query.sortOrder.toUpperCase()}
           SKIP $skip LIMIT $limit`,
          params
        ),
        runQuerySingle<{ total: number }>(
          `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)
           ${whereClause}
           RETURN count(d) as total`,
          { userId: request.user.userId, status: query.status }
        ),
      ]);

      const total = countResult?.total ?? 0;
      const totalPages = Math.ceil(total / query.limit);

      const result = {
        data: sources,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages,
          hasNextPage: query.page < totalPages,
          hasPrevPage: query.page > 1,
        },
      };

      // Cache result
      await cacheSet(cacheKey, result, CACHE_TTL);

      return result;
    },
  });

  fastify.post('/sources', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Register data source', tags: ['ingestion'], security: [{ bearerAuth: [] }] },
    handler: async (request, reply) => {
      const body = dataSourceSchema.parse(request.body);
      const sourceId = uuidv4();

      await runWriteSingle(
        `MATCH (u:User {id: $userId})
         CREATE (d:DataSource {
           id: $sourceId,
           sourceType: $sourceType,
           name: $name,
           status: 'pending',
           metadata: $metadata,
           signalCount: 0,
           createdAt: datetime(),
           updatedAt: datetime()
         })
         CREATE (u)-[:HAS_DATA_SOURCE]->(d)
         RETURN d.id as id`,
        {
          userId: request.user.userId,
          sourceId,
          sourceType: body.sourceType,
          name: body.name,
          metadata: JSON.stringify(body.metadata ?? {}),
        }
      );

      reply.status(201);
      return { id: sourceId, sourceType: body.sourceType, name: body.name, status: 'pending' };
    },
  });

  fastify.post('/upload', {
    preHandler: [fastify.authenticate],
    schema: { description: 'Upload files (base64)', tags: ['ingestion'], security: [{ bearerAuth: [] }] },
    handler: async (request, reply) => {
      const body = uploadSchema.parse(request.body);
      const files: Array<{ filename: string; objectName: string; url: string }> = [];

      for (const file of body.files) {
        const buffer = Buffer.from(file.content, 'base64');
        const objectName = `uploads/${request.user.userId}/${uuidv4()}-${file.filename}`;
        const url = await uploadFile(objectName, buffer, file.mimetype);
        files.push({ filename: file.filename, objectName, url });
      }

      const sourceId = uuidv4();
      await runWriteSingle(
        `MATCH (u:User {id: $userId})
         CREATE (d:DataSource {
           id: $sourceId,
           sourceType: 'file',
           name: $name,
           status: 'processing',
           metadata: $metadata,
           signalCount: 0,
           createdAt: datetime(),
           updatedAt: datetime()
         })
         CREATE (u)-[:HAS_DATA_SOURCE]->(d)
         RETURN d.id as id`,
        {
          userId: request.user.userId,
          sourceId,
          name: `Upload ${new Date().toISOString()}`,
          metadata: JSON.stringify({ files: files.map(f => f.filename) }),
        }
      );

      for (const file of files) {
        await scheduleIngestionJob({
          userId: request.user.userId,
          sourceId,
          sourceType: 'file',
          filePath: file.objectName,
          metadata: { filename: file.filename },
        });
      }

      reply.status(202);
      return { sourceId, files, status: 'processing' };
    },
  });

  fastify.get('/sources/:id/status', {
    preHandler: [fastify.authenticate],
    handler: async (request) => {
      const { id } = request.params as { id: string };
      const cacheKey = `source:${id}:status`;

      // Try cache for completed sources
      const cached = await cacheGet<{
        id: string;
        sourceType: string;
        name: string;
        status: string;
        signalCount: number;
        createdAt: string;
      }>(cacheKey);

      if (cached && cached.status === 'completed') {
        return { ...cached, cached: true };
      }

      const source = await runQuerySingle<{
        id: string;
        sourceType: string;
        name: string;
        status: string;
        progress: number;
        signalCount: number;
        createdAt: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         RETURN d.id as id, d.sourceType as sourceType, d.name as name, d.status as status,
                d.progress as progress, d.signalCount as signalCount, d.createdAt as createdAt`,
        { userId: request.user.userId, sourceId: id }
      );
      if (!source) throw new NotFoundError('Data source');

      // Cache completed sources
      if (source.status === 'completed') {
        await cacheSet(cacheKey, source, 3600);
      }

      return source;
    },
  });

  // Get detailed info about a data source including signals
  fastify.get('/sources/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request) => {
      const { id } = request.params as { id: string };

      const source = await runQuerySingle<{
        id: string;
        sourceType: string;
        name: string;
        status: string;
        progress: number;
        signalCount: number;
        metadata: string;
        createdAt: string;
        completedAt?: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         RETURN d.id as id, d.sourceType as sourceType, d.name as name, d.status as status,
                d.progress as progress, d.signalCount as signalCount, d.metadata as metadata,
                d.createdAt as createdAt, d.completedAt as completedAt`,
        { userId: request.user.userId, sourceId: id }
      );
      if (!source) throw new NotFoundError('Data source');

      // Get signals if completed
      let signals: unknown[] = [];
      if (source.status === 'completed') {
        signals = await runQuery<{
          id: string;
          type: string;
          value: string;
          confidence: number;
          evidence: string;
        }>(
          `MATCH (d:DataSource {id: $sourceId})-[:HAS_SIGNAL]->(s:Signal)
           RETURN s.id as id, s.type as type, s.value as value, s.confidence as confidence, s.evidence as evidence
           LIMIT 50`,
          { sourceId: id }
        );
      }

      return {
        ...source,
        metadata: JSON.parse(source.metadata),
        signals,
      };
    },
  });

  fastify.delete('/sources/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };

      // Invalidate cache
      const cacheKey = `source:${id}:status`;
      await cacheSet(cacheKey, null, 0);

      await runWriteSingle(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         OPTIONAL MATCH (d)-[:HAS_SIGNAL]->(s:Signal)
         DETACH DELETE d, s`,
        { userId: request.user.userId, sourceId: id }
      );
      reply.status(204);
    },
  });
}

export default ingestionRoutes;
