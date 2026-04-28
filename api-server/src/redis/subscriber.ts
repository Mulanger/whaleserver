import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

let subscriber: Redis | null = null;

export async function createRedisSubscriber(): Promise<Redis> {
  subscriber = new Redis(config.REDIS_URL);
  await subscriber.subscribe(config.REDIS_CHANNEL);
  logger.info({ channel: config.REDIS_CHANNEL }, 'subscribed to Redis channel');
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