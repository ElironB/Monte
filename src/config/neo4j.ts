import neo4j, { Driver, Session } from 'neo4j-driver';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

let driver: Driver | null = null;

export async function getNeo4jDriver(): Promise<Driver> {
  if (!driver) {
    driver = neo4j.driver(
      config.neo4j.uri,
      neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
      {
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 30000,
      }
    );
    await driver.verifyConnectivity();
    logger.info('Neo4j connected');
  }
  return driver;
}

export async function getSession(): Promise<Session> {
  const driver = await getNeo4jDriver();
  return driver.session();
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
    logger.info('Neo4j disconnected');
  }
}

function normalizeNeo4jValue(value: unknown): unknown {
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeNeo4jValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === 'object') {
    if ('toStandardDate' in value && typeof (value as { toStandardDate: () => Date }).toStandardDate === 'function') {
      return (value as { toStandardDate: () => Date }).toStandardDate().toISOString();
    }

    if ('year' in value && 'month' in value && 'day' in value && 'hour' in value) {
      const maybeDateTime = value as {
        year: unknown;
        month: unknown;
        day: unknown;
        hour: unknown;
        minute?: unknown;
        second?: unknown;
        nanosecond?: unknown;
        timeZoneOffsetSeconds?: unknown;
      };
      const offsetSeconds = Number(normalizeNeo4jValue(maybeDateTime.timeZoneOffsetSeconds ?? 0));
      const offsetSign = offsetSeconds >= 0 ? '+' : '-';
      const absoluteOffset = Math.abs(offsetSeconds);
      const offsetHours = String(Math.floor(absoluteOffset / 3600)).padStart(2, '0');
      const offsetMinutes = String(Math.floor((absoluteOffset % 3600) / 60)).padStart(2, '0');
      const nanos = Number(normalizeNeo4jValue(maybeDateTime.nanosecond ?? 0));
      const millis = String(Math.floor(nanos / 1_000_000)).padStart(3, '0');
      return `${String(normalizeNeo4jValue(maybeDateTime.year)).padStart(4, '0')}-${String(normalizeNeo4jValue(maybeDateTime.month)).padStart(2, '0')}-${String(normalizeNeo4jValue(maybeDateTime.day)).padStart(2, '0')}T${String(normalizeNeo4jValue(maybeDateTime.hour)).padStart(2, '0')}:${String(normalizeNeo4jValue(maybeDateTime.minute ?? 0)).padStart(2, '0')}:${String(normalizeNeo4jValue(maybeDateTime.second ?? 0)).padStart(2, '0')}.${millis}${offsetSign}${offsetHours}:${offsetMinutes}`;
    }

    if ('year' in value && 'month' in value && 'day' in value && !('hour' in value)) {
      const maybeDate = value as { year: unknown; month: unknown; day: unknown };
      return `${String(normalizeNeo4jValue(maybeDate.year)).padStart(4, '0')}-${String(normalizeNeo4jValue(maybeDate.month)).padStart(2, '0')}-${String(normalizeNeo4jValue(maybeDate.day)).padStart(2, '0')}`;
    }

    if ('low' in value && 'high' in value && 'unsigned' in value) {
      return neo4j.integer.inSafeRange(value as never)
        ? neo4j.integer.toNumber(value as never)
        : neo4j.integer.toString(value as never);
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, normalizeNeo4jValue(nestedValue)])
    );
  }

  return value;
}

function mapRecord<T>(record: neo4j.Record): T {
  const obj: Record<string, unknown> = {};
  for (const key of record.keys) {
    obj[String(key)] = normalizeNeo4jValue(record.get(key));
  }
  return obj as T;
}

const INTEGER_PARAM_NAMES = new Set([
  'skip',
  'limit',
  'page',
  'cloneCount',
  'cloneBatchIndex',
  'totalBatches',
  'completedBatches',
  'batchSize',
  'startIndex',
  'endIndex',
  'version',
]);

function normalizeParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return params;

  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      if (INTEGER_PARAM_NAMES.has(key) && typeof value === 'number' && Number.isFinite(value)) {
        return [key, neo4j.int(Math.trunc(value))];
      }
      return [key, value];
    })
  );
}

export async function runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
  const session = await getSession();
  try {
    const result = await session.run(cypher, normalizeParams(params));
    return result.records.map(record => mapRecord<T>(record));
  } finally {
    await session.close();
  }
}

export async function runQuerySingle<T>(cypher: string, params?: Record<string, unknown>): Promise<T | null> {
  const results = await runQuery<T>(cypher, params);
  return results[0] ?? null;
}

export async function runWrite<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
  const session = await getSession();
  try {
    const result = await session.executeWrite(async (tx) => {
      const queryResult = await tx.run(cypher, normalizeParams(params));
      return queryResult.records.map(record => mapRecord<T>(record));
    });
    return result;
  } finally {
    await session.close();
  }
}

export async function runWriteSingle<T>(cypher: string, params?: Record<string, unknown>): Promise<T | null> {
  const results = await runWrite<T>(cypher, params);
  return results[0] ?? null;
}
