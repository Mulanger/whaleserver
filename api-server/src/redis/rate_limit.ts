import Redis from 'ioredis';
import { config } from '../config.js';

export const rateLimitRedis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
});