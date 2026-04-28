import Redis from 'ioredis';
import { config } from '../config.js';

const lockClient = new Redis(config.REDIS_URL);

export async function acquireLock(
  key: string,
  ttlMs: number
): Promise<boolean> {
  const result = await lockClient.set(key, '1', 'PX', ttlMs, 'NX');
  return result === 'OK';
}

export async function releaseLock(key: string): Promise<void> {
  await lockClient.del(key);
}

export async function incrementPushCount(userId: string): Promise<number> {
  const bucket = Math.floor(Date.now() / 3600000);
  const key = `push_count:${userId}:${bucket}`;
  const count = await lockClient.incr(key);
  if (count === 1) {
    await lockClient.expire(key, 3600);
  }
  return count;
}

export async function getPushCount(userId: string): Promise<number> {
  const bucket = Math.floor(Date.now() / 3600000);
  const key = `push_count:${userId}:${bucket}`;
  const count = await lockClient.get(key);
  return count ? parseInt(count, 10) : 0;
}