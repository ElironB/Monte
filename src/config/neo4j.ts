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

export async function runQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
  const session = await getSession();
  try {
    const result = await session.run(cypher, params);
    return result.records.map(record => {
      const obj: Record<string, unknown> = {};
      for (const key of record.keys) {
        obj[String(key)] = record.get(key);
      }
      return obj as T;
    });
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
      const queryResult = await tx.run(cypher, params);
      return queryResult.records.map(record => {
        const obj: Record<string, unknown> = {};
        for (const key of record.keys) {
          obj[String(key)] = record.get(key);
        }
        return obj as T;
      });
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
