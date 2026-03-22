import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.server.logLevel,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  transport: config.server.nodeEnv === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
