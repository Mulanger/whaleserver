import type { FastifyInstance } from 'fastify';
import { findOrCreateUser } from '../auth/anonymous.js';
import { issueToken } from '../auth/jwt.js';
import type { MobilePlatform } from '../shared/types.js';

export async function issueAnonymousToken(
  fastify: FastifyInstance,
  deviceId: string,
  platform: MobilePlatform
): Promise<{ token: string; userId: string }> {
  const { user } = await findOrCreateUser(deviceId, platform);
  return {
    token: issueToken(fastify, user),
    userId: user._id,
  };
}

