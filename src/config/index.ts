import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  neo4j: z.object({
    uri: z.string().default('bolt://localhost:7687'),
    user: z.string().default('neo4j'),
    password: z.string().min(1),
  }),
  redis: z.object({
    url: z.string().default('redis://localhost:6379'),
  }),
  minio: z.object({
    endpoint: z.string().default('localhost'),
    port: z.number().default(9000),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
    bucket: z.string().default('monte-data'),
    useSSL: z.boolean().default(false),
  }),
  auth: z.object({
    jwtSecret: z.string().min(32),
    refreshTokenSecret: z.string().min(32),
    jwtExpiryMinutes: z.number().default(15),
    refreshTokenExpiryDays: z.number().default(30),
  }),
  server: z.object({
    port: z.number().default(3000),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  }),
  groq: z.object({
    apiKey: z.string().optional(),
  }).optional(),
  anthropic: z.object({
    apiKey: z.string().optional(),
  }).optional(),
});

export const config = configSchema.parse({
  neo4j: {
    uri: process.env.NEO4J_URI,
    user: process.env.NEO4J_USER,
    password: process.env.NEO4J_PASSWORD,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT,
    port: process.env.MINIO_PORT ? parseInt(process.env.MINIO_PORT, 10) : undefined,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
    bucket: process.env.MINIO_BUCKET,
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET,
    jwtExpiryMinutes: process.env.JWT_EXPIRY_MINUTES ? parseInt(process.env.JWT_EXPIRY_MINUTES, 10) : undefined,
    refreshTokenExpiryDays: process.env.REFRESH_TOKEN_EXPIRY_DAYS ? parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS, 10) : undefined,
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
    nodeEnv: process.env.NODE_ENV,
    logLevel: process.env.LOG_LEVEL,
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});

export type Config = typeof config;
