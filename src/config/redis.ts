// @ts-nocheck
import { config } from './index.js';
import { logger } from '../utils/logger.js';

let redisClient: any | null = null;

export async function getRedisClient(): Promise<any> {
  if (!redisClient) {
    const { default: Redis } = await import('ioredis');
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('error', (err: unknown) => logger.error({ err }, 'Redis error'));
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis disconnected');
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = await getRedisClient();
  const value = await client.get(key);
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return value as T; }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const client = await getRedisClient();
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (ttlSeconds) {
    await client.setex(key, ttlSeconds, serialized);
  } else {
    await client.set(key, serialized);
  }
}
