import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

let subscriber: Redis | null = null;

/**
 * Single ioredis subscriber connection that listens on both:
 *   - REDIS_CHANNEL ("whales")          — new whale trades from the watcher
 *   - RESOLUTION_CHANNEL ("market_resolutions") — resolution events from the
 *                                         trade-resolver (D:\Resolution-tracker)
 *
 * Consumers (createHub, createDispatcher) attach `.on('message', ...)` listeners
 * and dispatch on the channel argument.
 */
export async function createRedisSubscriber(): Promise<Redis> {
  subscriber = new Redis(config.REDIS_URL);
  await subscriber.subscribe(config.REDIS_CHANNEL, config.RESOLUTION_CHANNEL);
  logger.info(
    {
      whales: config.REDIS_CHANNEL,
      resolutions: config.RESOLUTION_CHANNEL,
    },
    'subscribed to Redis channels',
  );
  return subscriber;
}

export async function closeRedis(): Promise<void> {
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
    logger.info('Redis subscriber connection closed');
  }
}

export function getSubscriber(): Redis {
  if (!subscriber) throw new Error('Redis subscriber not initialized');
  return subscriber;
}