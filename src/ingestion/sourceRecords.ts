import { v4 as uuidv4 } from 'uuid';
import { runQuery, runQuerySingle, runWriteSingle } from '../config/neo4j.js';
import { NotFoundError } from '../utils/errors.js';

export const DATA_SOURCE_TYPES = [
  'search_history',
  'watch_history',
  'social_media',
  'financial',
  'notes',
  'files',
  'composio',
  'ai_chat',
  'mixed',
] as const;

export const INGESTION_SOURCE_STATUSES = [
  'pending',
  'processing',
  'completed',
  'partial',
  'failed',
] as const;

export const INGESTION_FILE_STATUSES = [
  'pending',
  'processing',
  'completed',
  'skipped',
  'failed',
] as const;

export type DataSourceType = typeof DATA_SOURCE_TYPES[number];
export type IngestionSourceStatus = typeof INGESTION_SOURCE_STATUSES[number];
export type IngestionFileStatus = typeof INGESTION_FILE_STATUSES[number];

export interface SourceAggregateCounts {
  expectedFileCount: number;
  uploadedFileCount: number;
  pendingFileCount: number;
  processingFileCount: number;
  completedFileCount: number;
  skippedFileCount: number;
  failedFileCount: number;
}

export interface SourceAggregateSummary extends SourceAggregateCounts {
  uploadComplete: boolean;
}

export interface SourceFileRecord {
  id: string;
  filename: string;
  originalPath: string | null;
  objectName: string | null;
  mimetype: string;
  sizeBytes: number;
  detectedSourceType: DataSourceType;
  status: IngestionFileStatus;
  signalCount: number;
  skipReason: string | null;
  error: string | null;
  processingDurationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SourceFileCreateInput {
  sourceId: string;
  filename: string;
  originalPath?: string | null;
  mimetype: string;
  sizeBytes: number;
  detectedSourceType: DataSourceType;
}

export interface DataSourceCreateInput {
  userId: string;
  name: string;
  sourceType?: DataSourceType;
  expectedFileCount?: number;
  metadata?: Record<string, unknown>;
}

export interface IngestionJobFile {
  sourceId: string;
  userId: string;
  fileId: string;
  filename: string;
  originalPath: string | null;
  objectName: string | null;
  mimetype: string;
  sizeBytes: number;
  detectedSourceType: DataSourceType;
  status: IngestionFileStatus;
}

export function deriveAggregateStatus(summary: SourceAggregateSummary): IngestionSourceStatus {
  if (summary.uploadedFileCount === 0) {
    return 'pending';
  }

  if (
    !summary.uploadComplete
    || summary.uploadedFileCount < summary.expectedFileCount
    || summary.pendingFileCount > 0
    || summary.processingFileCount > 0
  ) {
    return 'processing';
  }

  if (summary.completedFileCount === summary.uploadedFileCount) {
    return 'completed';
  }

  if (summary.completedFileCount === 0) {
    return 'failed';
  }

  return 'partial';
}

export async function createDataSource(input: DataSourceCreateInput): Promise<{ id: string; sourceType: DataSourceType; name: string; status: IngestionSourceStatus }> {
  const sourceId = uuidv4();
  const sourceType = input.sourceType ?? 'mixed';

  await runWriteSingle(
    `MATCH (u:User {id: $userId})
     CREATE (d:DataSource {
       id: $sourceId,
       sourceType: $sourceType,
       name: $name,
       status: 'pending',
       metadata: $metadata,
       expectedFileCount: $expectedFileCount,
       uploadComplete: false,
       fileCount: 0,
       uploadedFileCount: 0,
       pendingFileCount: 0,
       processingFileCount: 0,
       completedFileCount: 0,
       skippedFileCount: 0,
       failedFileCount: 0,
       signalCount: 0,
       totalBytes: 0,
       createdAt: datetime(),
       updatedAt: datetime()
     })
     CREATE (u)-[:HAS_DATA_SOURCE]->(d)
     RETURN d.id as id`,
    {
      userId: input.userId,
      sourceId,
      sourceType,
      name: input.name,
      metadata: JSON.stringify(input.metadata ?? {}),
      expectedFileCount: input.expectedFileCount ?? 0,
    },
  );

  return { id: sourceId, sourceType, name: input.name, status: 'pending' };
}

export async function assertDataSourceOwnership(userId: string, sourceId: string): Promise<void> {
  const record = await runQuerySingle<{ id: string }>(
    `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})
     RETURN d.id as id`,
    { userId, sourceId },
  );

  if (!record) {
    throw new NotFoundError('Data source');
  }
}

export async function createSourceFileRecord(input: SourceFileCreateInput): Promise<SourceFileRecord> {
  const fileId = uuidv4();

  const record = await runWriteSingle<SourceFileRecord>(
    `MATCH (d:DataSource {id: $sourceId})
     CREATE (f:SourceFile {
       id: $fileId,
       filename: $filename,
       originalPath: $originalPath,
       objectName: null,
       mimetype: $mimetype,
       sizeBytes: $sizeBytes,
       detectedSourceType: $detectedSourceType,
       status: 'pending',
       signalCount: 0,
       skipReason: null,
       error: null,
       processingDurationMs: null,
       createdAt: datetime(),
       startedAt: null,
       completedAt: null,
       updatedAt: datetime()
     })
     CREATE (d)-[:HAS_FILE]->(f)
     RETURN f.id as id,
            f.filename as filename,
            f.originalPath as originalPath,
            f.objectName as objectName,
            f.mimetype as mimetype,
            f.sizeBytes as sizeBytes,
            f.detectedSourceType as detectedSourceType,
            f.status as status,
            f.signalCount as signalCount,
            f.skipReason as skipReason,
            f.error as error,
            f.processingDurationMs as processingDurationMs,
            toString(f.createdAt) as createdAt,
            toString(f.startedAt) as startedAt,
            toString(f.completedAt) as completedAt`,
    {
      sourceId: input.sourceId,
      fileId,
      filename: input.filename,
      originalPath: input.originalPath ?? null,
      mimetype: input.mimetype,
      sizeBytes: input.sizeBytes,
      detectedSourceType: input.detectedSourceType,
    },
  );

  if (!record) {
    throw new NotFoundError('Data source');
  }

  await refreshDataSourceAggregate(input.sourceId);
  return record;
}

export async function attachSourceFileObject(fileId: string, objectName: string): Promise<void> {
  await runWriteSingle(
    `MATCH (f:SourceFile {id: $fileId})
     SET f.objectName = $objectName,
         f.updatedAt = datetime()
     RETURN f.id as id`,
    { fileId, objectName },
  );
}

export async function markSourceUploadComplete(sourceId: string): Promise<void> {
  await runWriteSingle(
    `MATCH (d:DataSource {id: $sourceId})
     SET d.uploadComplete = true,
         d.updatedAt = datetime()
     RETURN d.id as id`,
    { sourceId },
  );

  await refreshDataSourceAggregate(sourceId);
}

export async function getSourceFileJobRecord(userId: string, sourceId: string, fileId: string): Promise<IngestionJobFile> {
  const record = await runQuerySingle<IngestionJobFile>(
    `MATCH (u:User {id: $userId})-[:HAS_DATA_SOURCE]->(d:DataSource {id: $sourceId})-[:HAS_FILE]->(f:SourceFile {id: $fileId})
     RETURN d.id as sourceId,
            u.id as userId,
            f.id as fileId,
            f.filename as filename,
            f.originalPath as originalPath,
            f.objectName as objectName,
            f.mimetype as mimetype,
            f.sizeBytes as sizeBytes,
            f.detectedSourceType as detectedSourceType,
            f.status as status`,
    { userId, sourceId, fileId },
  );

  if (!record) {
    throw new NotFoundError('Source file');
  }

  return record;
}

export async function markSourceFileProcessing(fileId: string): Promise<void> {
  await runWriteSingle(
    `MATCH (f:SourceFile {id: $fileId})
     SET f.status = 'processing',
         f.startedAt = datetime(),
         f.error = null,
         f.skipReason = null,
         f.updatedAt = datetime()
     RETURN f.id as id`,
    { fileId },
  );
}

export async function markSourceFileCompleted(fileId: string, signalCount: number, processingDurationMs: number): Promise<void> {
  await runWriteSingle(
    `MATCH (f:SourceFile {id: $fileId})
     SET f.status = 'completed',
         f.signalCount = $signalCount,
         f.error = null,
         f.skipReason = null,
         f.processingDurationMs = $processingDurationMs,
         f.completedAt = datetime(),
         f.updatedAt = datetime()
     RETURN f.id as id`,
    { fileId, signalCount, processingDurationMs },
  );
}

export async function markSourceFileSkipped(fileId: string, reason: string, processingDurationMs: number): Promise<void> {
  await runWriteSingle(
    `MATCH (f:SourceFile {id: $fileId})
     SET f.status = 'skipped',
         f.signalCount = 0,
         f.skipReason = $reason,
         f.error = null,
         f.processingDurationMs = $processingDurationMs,
         f.completedAt = datetime(),
         f.updatedAt = datetime()
     RETURN f.id as id`,
    { fileId, reason, processingDurationMs },
  );
}

export async function markSourceFileFailed(fileId: string, error: string, processingDurationMs: number): Promise<void> {
  await runWriteSingle(
    `MATCH (f:SourceFile {id: $fileId})
     SET f.status = 'failed',
         f.signalCount = 0,
         f.error = $error,
         f.processingDurationMs = $processingDurationMs,
         f.completedAt = datetime(),
         f.updatedAt = datetime()
     RETURN f.id as id`,
    { fileId, error, processingDurationMs },
  );
}

export async function refreshDataSourceAggregate(sourceId: string): Promise<void> {
  const summary = await runQuerySingle<SourceAggregateSummary>(
    `MATCH (d:DataSource {id: $sourceId})
     OPTIONAL MATCH (d)-[:HAS_FILE]->(f:SourceFile)
     RETURN coalesce(d.expectedFileCount, 0) as expectedFileCount,
            coalesce(d.uploadComplete, false) as uploadComplete,
            count(f) as uploadedFileCount,
            sum(CASE WHEN f.status = 'pending' THEN 1 ELSE 0 END) as pendingFileCount,
            sum(CASE WHEN f.status = 'processing' THEN 1 ELSE 0 END) as processingFileCount,
            sum(CASE WHEN f.status = 'completed' THEN 1 ELSE 0 END) as completedFileCount,
            sum(CASE WHEN f.status = 'skipped' THEN 1 ELSE 0 END) as skippedFileCount,
            sum(CASE WHEN f.status = 'failed' THEN 1 ELSE 0 END) as failedFileCount`,
    { sourceId },
  );

  const counts: SourceAggregateSummary = {
    expectedFileCount: summary?.expectedFileCount ?? 0,
    uploadComplete: summary?.uploadComplete ?? false,
    uploadedFileCount: summary?.uploadedFileCount ?? 0,
    pendingFileCount: summary?.pendingFileCount ?? 0,
    processingFileCount: summary?.processingFileCount ?? 0,
    completedFileCount: summary?.completedFileCount ?? 0,
    skippedFileCount: summary?.skippedFileCount ?? 0,
    failedFileCount: summary?.failedFileCount ?? 0,
  };

  const status = deriveAggregateStatus(counts);

  await runWriteSingle(
    `MATCH (d:DataSource {id: $sourceId})
     OPTIONAL MATCH (d)-[:HAS_FILE]->(f:SourceFile)
     WITH d,
          $status as status,
          count(f) as fileCount,
          sum(coalesce(f.signalCount, 0)) as signalCount,
          sum(coalesce(f.sizeBytes, 0)) as totalBytes
     SET d.status = status,
         d.fileCount = fileCount,
         d.uploadedFileCount = fileCount,
         d.signalCount = coalesce(signalCount, 0),
         d.totalBytes = coalesce(totalBytes, 0),
         d.pendingFileCount = $pendingFileCount,
         d.processingFileCount = $processingFileCount,
         d.completedFileCount = $completedFileCount,
         d.skippedFileCount = $skippedFileCount,
         d.failedFileCount = $failedFileCount,
         d.updatedAt = datetime(),
         d.completedAt = CASE WHEN status IN ['completed', 'partial', 'failed'] THEN datetime() ELSE null END
     RETURN d.id as id`,
    {
      sourceId,
      status,
      pendingFileCount: counts.pendingFileCount,
      processingFileCount: counts.processingFileCount,
      completedFileCount: counts.completedFileCount,
      skippedFileCount: counts.skippedFileCount,
      failedFileCount: counts.failedFileCount,
    },
  );
}

export async function listSourceFiles(sourceId: string): Promise<SourceFileRecord[]> {
  return runQuery<SourceFileRecord>(
    `MATCH (:DataSource {id: $sourceId})-[:HAS_FILE]->(f:SourceFile)
     RETURN f.id as id,
            f.filename as filename,
            f.originalPath as originalPath,
            f.objectName as objectName,
            f.mimetype as mimetype,
            f.sizeBytes as sizeBytes,
            f.detectedSourceType as detectedSourceType,
            f.status as status,
            f.signalCount as signalCount,
            f.skipReason as skipReason,
            f.error as error,
            f.processingDurationMs as processingDurationMs,
            toString(f.createdAt) as createdAt,
            toString(f.startedAt) as startedAt,
            toString(f.completedAt) as completedAt
     ORDER BY f.createdAt ASC`,
    { sourceId },
  );
}
