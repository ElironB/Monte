import { logger } from './utils/logger.js';
import { startMonteServer } from './server.js';

try {
  await startMonteServer();
} catch (err) {
  logger.error({ err }, 'Failed to start');
  process.exit(1);
}
