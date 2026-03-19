import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { runQuerySingle, runWriteSingle, runQuery } from '../../config/neo4j.js';
import { cacheGet, cacheSet } from '../../config/redis.js';
import { config } from '../../config/index.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';

export interface APIKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  rateLimit: number;
  lastUsedAt?: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

const API_KEY_PREFIX = 'mk_';
const CACHE_TTL = 300; // 5 minutes

// Generate a new API key (plaintext - only shown once)
export function generateAPIKey(): { key: string; prefix: string } {
  const key = `${API_KEY_PREFIX}${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '')}`;
  const prefix = key.slice(0, 10);
  return { key, prefix };
}

// Hash API key for storage
export async function hashAPIKey(key: string): Promise<string> {
  return bcrypt.hash(key, 10);
}

// Verify API key
async function verifyAPIKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

// Extract API key from request
function extractAPIKey(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('ApiKey ')) {
    return authHeader.slice(7);
  }
  const apiKeyHeader = request.headers['x-api-key'] as string;
  if (apiKeyHeader) {
    return apiKeyHeader;
  }
  return null;
}

// Validate API key and return user info
async function validateAPIKey(key: string): Promise<{ userId: string; scopes: string[]; rateLimit: number } | null> {
  const prefix = key.slice(0, 10);

  // Check cache first
  const cached = await cacheGet<{ userId: string; scopes: string[]; rateLimit: number }>(`apikey:${prefix}`);
  if (cached) {
    return cached;
  }

  // Query database
  const apiKeyRecord = await runQuerySingle<APIKey>(
    `MATCH (k:ApiKey {keyPrefix: $prefix, revokedAt: null})
     WHERE k.expiresAt IS NULL OR k.expiresAt > datetime()
     RETURN k.id as id, k.userId as userId, k.keyHash as keyHash, k.scopes as scopes, k.rateLimit as rateLimit, k.lastUsedAt as lastUsedAt`,
    { prefix }
  );

  if (!apiKeyRecord) {
    return null;
  }

  // Verify key hash
  const valid = await verifyAPIKey(key, apiKeyRecord.keyHash);
  if (!valid) {
    return null;
  }

  // Update last used
  await runWriteSingle(
    `MATCH (k:ApiKey {id: $id})
     SET k.lastUsedAt = datetime()
     RETURN k.id as id`,
    { id: apiKeyRecord.id }
  );

  const result = {
    userId: apiKeyRecord.userId,
    scopes: JSON.parse(apiKeyRecord.scopes as unknown as string) as string[],
    rateLimit: apiKeyRecord.rateLimit,
  };

  // Cache result
  await cacheSet(`apikey:${prefix}`, result, CACHE_TTL);

  return result;
}

// Check rate limit
async function checkRateLimit(prefix: string, limit: number): Promise<boolean> {
  const key = `ratelimit:${prefix}`;
  const redis = await import('../../config/redis.js').then(m => m.getRedisClient());
  const client = await redis;

  const current = await client.incr(key);
  if (current === 1) {
    await client.expire(key, 60); // 1 minute window
  }

  return current <= limit;
}

// API Key plugin
const apiKeyPlugin: FastifyPluginAsync = async (fastify) => {
  // Add API key authentication decorator
  fastify.decorate('authenticateApiKey', async (request: FastifyRequest, reply: FastifyReply) => {
    const key = extractAPIKey(request);
    if (!key) {
      reply.status(401);
      throw new Error('API key required');
    }

    const validated = await validateAPIKey(key);
    if (!validated) {
      reply.status(401);
      throw new Error('Invalid or revoked API key');
    }

    // Check rate limit
    const allowed = await checkRateLimit(key.slice(0, 10), validated.rateLimit);
    if (!allowed) {
      reply.status(429);
      throw new Error('Rate limit exceeded');
    }

    // Attach user info to request
    request.user = {
      userId: validated.userId,
      email: '',  // API key auth doesn't have email
      scopes: validated.scopes,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    logger.debug({ userId: validated.userId, scopes: validated.scopes }, 'API key authenticated');
  });

  // Combined auth - JWT or API key
  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    // Try JWT first
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      // Let JWT auth handle it
      return;
    }

    // Fall back to API key
    await (fastify as any).authenticateApiKey(request, reply);
  });
};

export default fp(apiKeyPlugin, { name: 'apiKey' });

// API Key management functions
export async function createApiKey(
  userId: string,
  name: string,
  scopes: string[] = ['read', 'write'],
  rateLimit: number = 100,
  expiresInDays?: number
): Promise<{ id: string; key: string; name: string; scopes: string[] }> {
  const id = uuidv4();
  const { key, prefix } = generateAPIKey();
  const keyHash = await hashAPIKey(key);

  let expiresAt: string | null = null;
  if (expiresInDays) {
    const date = new Date();
    date.setDate(date.getDate() + expiresInDays);
    expiresAt = date.toISOString();
  }

  await runWriteSingle(
    `MATCH (u:User {id: $userId})
     CREATE (k:ApiKey {
       id: $id,
       name: $name,
       keyHash: $keyHash,
       keyPrefix: $prefix,
       scopes: $scopes,
       rateLimit: $rateLimit,
       createdAt: datetime(),
       expiresAt: $expiresAt
     })
     CREATE (u)-[:HAS_API_KEY]->(k)
     RETURN k.id as id`,
    {
      userId,
      id,
      name,
      keyHash,
      prefix,
      scopes: JSON.stringify(scopes),
      rateLimit,
      expiresAt,
    }
  );

  logger.info({ userId, name, scopes }, 'API key created');

  return { id, key, name, scopes };
}

export async function listApiKeys(userId: string): Promise<Array<Omit<APIKey, 'keyHash'>>> {
  const keys = await runQuery<APIKey>(
    `MATCH (u:User {id: $userId})-[:HAS_API_KEY]->(k:ApiKey)
     WHERE k.revokedAt IS NULL
     RETURN k.id as id, k.userId as userId, k.name as name, k.keyPrefix as keyPrefix, k.scopes as scopes, k.rateLimit as rateLimit, k.lastUsedAt as lastUsedAt, k.createdAt as createdAt, k.expiresAt as expiresAt`,
    { userId }
  );

  return keys.map(k => ({
    ...k,
    scopes: JSON.parse(k.scopes as unknown as string) as string[],
  }));
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const result = await runWriteSingle<{ id: string }>(
    `MATCH (u:User {id: $userId})-[:HAS_API_KEY]->(k:ApiKey {id: $keyId})
     SET k.revokedAt = datetime()
     RETURN k.id as id`,
    { userId, keyId }
  );

  if (result) {
    // Invalidate cache
    const key = await runQuerySingle<{ keyPrefix: string }>(
      `MATCH (k:ApiKey {id: $keyId}) RETURN k.keyPrefix as keyPrefix`,
      { keyId }
    );
    if (key) {
      const redis = await import('../../config/redis.js');
      const client = await redis.getRedisClient();
      await client.del(`apikey:${key.keyPrefix}`);
    }
  }

  return !!result;
}
