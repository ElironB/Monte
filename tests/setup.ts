import { beforeAll, afterAll } from 'vitest';
import { getNeo4jDriver, closeNeo4j, runWrite } from '../src/config/neo4j.js';
import { getRedisClient, closeRedis } from '../src/config/redis.js';

beforeAll(async () => {
  await getNeo4jDriver();
  await (await getRedisClient()).ping();
});

afterAll(async () => {
  await runWrite('MATCH (n) WHERE n.id STARTS WITH "test-" DETACH DELETE n');
  await closeNeo4j();
  await closeRedis();
});
