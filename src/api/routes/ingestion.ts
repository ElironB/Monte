import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, runQuerySingle, runWriteSingle } from '../../config/neo4j.js';
import { uploadFile } from '../../config/minio.js';
import { scheduleIngestionJob } from '../../ingestion/queue/ingestionQueue.js';
import {
  assertDataSourceOwnership,
  createDataSource,
  createSourceFileRecord,
  DATA_SOURCE_TYPES,
  DataSourceType,
  attachSourceFileObject,
  markSourceFileFailed,
  markSourceUploadComplete,
  refreshDataSourceAggregate,
  listSourceFiles,
} from '../../ingestion/sourceRecords.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

const dataSourceSchema = z.object({
  sourceType: z.enum(DATA_SOURCE_TYPES).optional(),
  name: z.string().min(1).max(160),
  expectedFileCount: z.number().int().min(0).max(100000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const uploadSchema = z.object({
  sourceType: z.enum(DATA_SOURCE_TYPES).optional(),
  files: z.array(z.object({
    filename: z.string().min(1),
    content: z.string(),
    mimetype: z.string().min(1),
    originalPath: z.string().optional(),
    detectedSourceType: z.enum(DATA_SOURCE_TYPES).optional(),
  })).min(1),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'processing', 'completed', 'partial', 'failed']).optional(),
  sortBy: z.enum(['createdAt', 'name', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

function parseMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asDataSourceType(value: string | undefined, fallback: DataSourceType = 'files'): DataSourceType {
  if (value && DATA_SOURCE_TYPES.includes(value as DataSourceType)) {
    return value as DataSourceType;
  }

  return fallback;
}

function asDetectedSourceType(value: string | undefined, fallback: DataSourceType = 'files'): DataSourceType {
  const parsed = asDataSourceType(value, fallback);
  return parsed === 'mixed' ? fallback : parsed;
}

function buildUploadObjectName(userId: string, filename: string): string {
  return `uploads/${userId}/${uuidv4()}-${filename}`;
}

export interface ExtractedMultipartUpload {
  file: {
    filename: string;
    mimetype: string;
    buffer: Buffer;
  };
  fields: Record<string, string>;
}

export async function extractMultipartUpload(request: FastifyRequest): Promise<ExtractedMultipartUpload> {
  const fields: Record<string, string> = {};
  let filePart: ExtractedMultipartUpload['file'] | null = null;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (filePart) {
        await part.toBuffer().catch(() => {});
        throw new ValidationError('Upload exactly one file per request.');
      }

      filePart = {
        filename: part.filename,
        mimetype: part.mimetype,
        buffer: await part.toBuffer(),
      };
      continue;
    }

    fields[part.fieldname] = String(part.value ?? '');
  }

  if (!filePart) {
    throw new ValidationError('Missing multipart file upload.');
  }

  return { file: filePart, fields };
}

async function ingestionRoutes(fastify: FastifyInstance) {
  fastify.get('/sources', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'List data sources with aggregate file and signal counts',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      const query = listQuerySchema.parse(request.query);
      const skip = (query.page - 1) * query.limit;
      const params: Record<string, unknown> = {
        userId: request.user.userId,
        skip,
        limit: query.limit,
      };

      let whereClause = '';
      if (query.status) {
        whereClause = 'WHERE d.status = $status';
        params.status = query.status;
      }

      const [sources, countResult] = await Promise.all([
        runQuery<{
          id: string;
          sourceType: string;
          name: string;
          status: string;
          signalCount: number;
          fileCount: number;
          uploadedFileCount: number;
          completedFileCount: number;
          skippedFileCount: number;
          failedFileCount: number;
          createdAt: string;
        }>(
          `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)
           ${whereClause}
           RETURN d.id as id,
                  d.sourceType as sourceType,
                  d.name as name,
                  d.status as status,
                  coalesce(d.signalCount, 0) as signalCount,
                  coalesce(d.fileCount, 0) as fileCount,
                  coalesce(d.uploadedFileCount, 0) as uploadedFileCount,
                  coalesce(d.completedFileCount, 0) as completedFileCount,
                  coalesce(d.skippedFileCount, 0) as skippedFileCount,
                  coalesce(d.failedFileCount, 0) as failedFileCount,
                  toString(d.createdAt) as createdAt
           ORDER BY d.${query.sortBy} ${query.sortOrder.toUpperCase()}
           SKIP $skip LIMIT $limit`,
          params,
        ),
        runQuerySingle<{ total: number }>(
          `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource)
           ${whereClause}
           RETURN count(d) as total`,
          { userId: request.user.userId, status: query.status },
        ),
      ]);

      const total = countResult?.total ?? 0;
      const totalPages = Math.ceil(total / query.limit);

      return {
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
    },
  });

  fastify.post('/sources', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Create a logical ingestion source/import session',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const body = dataSourceSchema.parse(request.body);
      const source = await createDataSource({
        userId: request.user.userId,
        name: body.name,
        sourceType: body.sourceType ?? 'mixed',
        expectedFileCount: body.expectedFileCount ?? 0,
        metadata: body.metadata,
      });

      reply.status(201);
      return source;
    },
  });

  fastify.post('/sources/:id/files', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Upload a single file to an existing ingestion source',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      await assertDataSourceOwnership(request.user.userId, id);

      const { file, fields } = await extractMultipartUpload(request);
      const detectedSourceType = asDetectedSourceType(fields.detectedSourceType, 'files');
      const sourceFile = await createSourceFileRecord({
        sourceId: id,
        filename: file.filename,
        originalPath: fields.originalPath || null,
        mimetype: file.mimetype,
        sizeBytes: file.buffer.byteLength,
        detectedSourceType,
      });

      try {
        const objectName = buildUploadObjectName(request.user.userId, file.filename);
        await uploadFile(objectName, file.buffer, file.mimetype);
        await attachSourceFileObject(sourceFile.id, objectName);
        await scheduleIngestionJob({
          userId: request.user.userId,
          sourceId: id,
          fileId: sourceFile.id,
        });
        await refreshDataSourceAggregate(id);

        reply.status(202);
        return {
          sourceId: id,
          fileId: sourceFile.id,
          filename: file.filename,
          detectedSourceType,
          status: 'pending',
        };
      } catch (err) {
        await markSourceFileFailed(sourceFile.id, (err as Error).message, 0);
        await refreshDataSourceAggregate(id);
        throw err;
      }
    },
  });

  fastify.post('/sources/:id/finalize', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Mark an ingestion source upload as complete so aggregate status can settle',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
    handler: async (request) => {
      const { id } = request.params as { id: string };
      await assertDataSourceOwnership(request.user.userId, id);
      await markSourceUploadComplete(id);

      const source = await runQuerySingle<{
        id: string;
        sourceType: string;
        name: string;
        status: string;
        signalCount: number;
        fileCount: number;
        uploadedFileCount: number;
        completedFileCount: number;
        skippedFileCount: number;
        failedFileCount: number;
        createdAt: string;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         RETURN d.id as id,
                d.sourceType as sourceType,
                d.name as name,
                d.status as status,
                coalesce(d.signalCount, 0) as signalCount,
                coalesce(d.fileCount, 0) as fileCount,
                coalesce(d.uploadedFileCount, 0) as uploadedFileCount,
                coalesce(d.completedFileCount, 0) as completedFileCount,
                coalesce(d.skippedFileCount, 0) as skippedFileCount,
                coalesce(d.failedFileCount, 0) as failedFileCount,
                toString(d.createdAt) as createdAt`,
        { userId: request.user.userId, sourceId: id },
      );

      if (!source) {
        throw new NotFoundError('Data source');
      }

      return source;
    },
  });

  fastify.post('/upload', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Compatibility upload path for small base64 payloads',
      tags: ['ingestion'],
      security: [{ bearerAuth: [] }],
    },
    handler: async (request, reply) => {
      const body = uploadSchema.parse(request.body);
      const source = await createDataSource({
        userId: request.user.userId,
        name: `${body.sourceType ?? 'mixed'} ${new Date().toISOString()}`,
        sourceType: body.sourceType ?? 'mixed',
        expectedFileCount: body.files.length,
        metadata: {
          compatibilityUpload: true,
          files: body.files.map((file) => file.filename),
        },
      });

      const results: Array<{
        fileId: string;
        filename: string;
        detectedSourceType: string;
        status: string;
        error?: string;
      }> = [];

      for (const file of body.files) {
        const buffer = Buffer.from(file.content, 'base64');
        const detectedSourceType = asDetectedSourceType(file.detectedSourceType ?? body.sourceType ?? 'files', 'files');
        const sourceFile = await createSourceFileRecord({
          sourceId: source.id,
          filename: file.filename,
          originalPath: file.originalPath ?? null,
          mimetype: file.mimetype,
          sizeBytes: buffer.byteLength,
          detectedSourceType,
        });

        try {
          const objectName = buildUploadObjectName(request.user.userId, file.filename);
          await uploadFile(objectName, buffer, file.mimetype);
          await attachSourceFileObject(sourceFile.id, objectName);
          await scheduleIngestionJob({
            userId: request.user.userId,
            sourceId: source.id,
            fileId: sourceFile.id,
          });
          results.push({
            fileId: sourceFile.id,
            filename: file.filename,
            detectedSourceType,
            status: 'pending',
          });
        } catch (err) {
          await markSourceFileFailed(sourceFile.id, (err as Error).message, 0);
          results.push({
            fileId: sourceFile.id,
            filename: file.filename,
            detectedSourceType,
            status: 'failed',
            error: (err as Error).message,
          });
        }
      }

      await markSourceUploadComplete(source.id);
      const finalizedSource = await runQuerySingle<{ status: string }>(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         RETURN d.status as status`,
        { userId: request.user.userId, sourceId: source.id },
      );

      if (!finalizedSource) {
        throw new NotFoundError('Data source');
      }

      reply.status(202);
      return {
        sourceId: source.id,
        files: results,
        status: finalizedSource.status,
      };
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
        signalCount: number;
        fileCount: number;
        uploadedFileCount: number;
        pendingFileCount: number;
        processingFileCount: number;
        completedFileCount: number;
        skippedFileCount: number;
        failedFileCount: number;
        expectedFileCount: number;
        createdAt: string;
        completedAt: string | null;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         RETURN d.id as id,
                d.sourceType as sourceType,
                d.name as name,
                d.status as status,
                coalesce(d.signalCount, 0) as signalCount,
                coalesce(d.fileCount, 0) as fileCount,
                coalesce(d.uploadedFileCount, 0) as uploadedFileCount,
                coalesce(d.pendingFileCount, 0) as pendingFileCount,
                coalesce(d.processingFileCount, 0) as processingFileCount,
                coalesce(d.completedFileCount, 0) as completedFileCount,
                coalesce(d.skippedFileCount, 0) as skippedFileCount,
                coalesce(d.failedFileCount, 0) as failedFileCount,
                coalesce(d.expectedFileCount, 0) as expectedFileCount,
                toString(d.createdAt) as createdAt,
                toString(d.completedAt) as completedAt`,
        { userId: request.user.userId, sourceId: id },
      );

      if (!source) {
        throw new NotFoundError('Data source');
      }

      return source;
    },
  });

  fastify.get('/sources/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request) => {
      const { id } = request.params as { id: string };
      const source = await runQuerySingle<{
        id: string;
        sourceType: string;
        name: string;
        status: string;
        signalCount: number;
        fileCount: number;
        uploadedFileCount: number;
        pendingFileCount: number;
        processingFileCount: number;
        completedFileCount: number;
        skippedFileCount: number;
        failedFileCount: number;
        expectedFileCount: number;
        metadata: string;
        createdAt: string;
        completedAt: string | null;
      }>(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         RETURN d.id as id,
                d.sourceType as sourceType,
                d.name as name,
                d.status as status,
                coalesce(d.signalCount, 0) as signalCount,
                coalesce(d.fileCount, 0) as fileCount,
                coalesce(d.uploadedFileCount, 0) as uploadedFileCount,
                coalesce(d.pendingFileCount, 0) as pendingFileCount,
                coalesce(d.processingFileCount, 0) as processingFileCount,
                coalesce(d.completedFileCount, 0) as completedFileCount,
                coalesce(d.skippedFileCount, 0) as skippedFileCount,
                coalesce(d.failedFileCount, 0) as failedFileCount,
                coalesce(d.expectedFileCount, 0) as expectedFileCount,
                d.metadata as metadata,
                toString(d.createdAt) as createdAt,
                toString(d.completedAt) as completedAt`,
        { userId: request.user.userId, sourceId: id },
      );

      if (!source) {
        throw new NotFoundError('Data source');
      }

      const [files, signals] = await Promise.all([
        listSourceFiles(id),
        runQuery<{
          id: string;
          type: string;
          value: string;
          confidence: number;
          evidence: string;
        }>(
          `MATCH (d:DataSource {id: $sourceId})
           CALL {
             WITH d
             MATCH (d)-[:HAS_FILE]->(:SourceFile)-[:HAS_SIGNAL]->(s:Signal)
             RETURN s
             UNION
             WITH d
             MATCH (d)-[:HAS_SIGNAL]->(s:Signal)
             RETURN s
           }
           WITH DISTINCT s
           RETURN s.id as id,
                  s.type as type,
                  s.value as value,
                  s.confidence as confidence,
                  s.evidence as evidence
           ORDER BY s.confidence DESC, s.value ASC
           LIMIT 50`,
          { sourceId: id },
        ),
      ]);

      return {
        ...source,
        metadata: parseMetadata(source.metadata),
        files,
        signals,
      };
    },
  });

  fastify.delete('/sources/:id', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      await runWriteSingle(
        `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
         OPTIONAL MATCH (d)-[:HAS_FILE]->(f:SourceFile)
         OPTIONAL MATCH (f)-[:HAS_SIGNAL]->(s:Signal)
         OPTIONAL MATCH (d)-[:HAS_SIGNAL]->(legacySignal:Signal)
         WITH d,
              collect(DISTINCT f) as files,
              collect(DISTINCT s) + collect(DISTINCT legacySignal) as signals
         FOREACH (signal IN signals | DETACH DELETE signal)
         FOREACH (fileNode IN files | DETACH DELETE fileNode)
         DETACH DELETE d`,
        { userId: request.user.userId, sourceId: id },
      );
      reply.status(204);
    },
  });
}

export default ingestionRoutes;
