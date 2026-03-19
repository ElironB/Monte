import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
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

async function ingestionRoutes(fastify: FastifyInstance) {
  fastify.get('/sources', {
    preHandler: [fastify.authenticate],
    schema: { description: 'List data sources', tags: ['ingestion'], security: [{ bearerAuth: [] }] },
    handler: async (request) => {
      return await runQuery<{
        id: string;
        sourceType: string;
        name: string;
        status: string;
        createdAt: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)
         RETURN d.id as id, d.sourceType as sourceType, d.name as name, d.status as status, d.createdAt as createdAt
         ORDER BY d.createdAt DESC`,
        { userId: request.user.userId }
      );
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
      const source = await runQuerySingle<{
        id: string;
        sourceType: string;
        name: string;
        status: string;
        progress: number;
        createdAt: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         RETURN d.id as id, d.sourceType as sourceType, d.name as name, d.status as status,
                d.progress as progress, d.createdAt as createdAt`,
        { userId: request.user.userId, sourceId: id }
      );
      if (!source) throw new NotFoundError('Data source');
      return source;
    },
  });

  fastify.delete('/sources/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      await runWriteSingle(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         DETACH DELETE d`,
        { userId: request.user.userId, sourceId: id }
      );
      reply.status(204);
    },
  });
}

export default ingestionRoutes;
