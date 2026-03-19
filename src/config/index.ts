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
  server: z.object({
    port: z.number().default(3000),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  }),
  llm: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().url().default('https://api.groq.com/openai/v1'),
    model: z.string().default('llama-3.1-70b-versatile'),
    reasoningModel: z.string().optional(),
  }).optional(),
  composio: z.object({
    apiKey: z.string().optional(),
  }).optional(),
  tracing: z.object({
    enabled: z.boolean().default(false),
    serviceName: z.string().default('monte-engine'),
    jaegerEndpoint: z.string().default('http://localhost:14268/api/traces'),
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
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
    nodeEnv: process.env.NODE_ENV,
    logLevel: process.env.LOG_LEVEL,
  },
  llm: {
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
    reasoningModel: process.env.LLM_REASONING_MODEL,
  },
  composio: {
    apiKey: process.env.COMPOSIO_API_KEY,
  },
  tracing: {
    enabled: process.env.OTEL_ENABLED === 'true',
    serviceName: process.env.OTEL_SERVICE_NAME,
    jaegerEndpoint: process.env.OTEL_EXPORTER_JAEGER_ENDPOINT,
  },
});

export type Config = typeof config;
