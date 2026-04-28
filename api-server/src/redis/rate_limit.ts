import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const rateLimitRedis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 200, 5000),
  reconnectOnError: () => true,
});

rateLimitRedis.on('error', (err) => {
  logger.warn({ err: err.message }, 'rate limit redis error');
});

rateLimitRedis.on('reconnecting', () => {
  logger.info('rate limit redis reconnecting');
});