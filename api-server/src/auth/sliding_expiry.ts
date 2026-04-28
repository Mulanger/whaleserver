import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, shouldRefreshToken, issueToken } from './jwt.js';
import type { User } from '../shared/types.js';
import { getDb } from '../db/mongo.js';

export async function handleSlidingExpiry(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return;

    const token = authHeader.slice(7);
    const payload = verifyToken(fastify, token);

    if (shouldRefreshToken(payload)) {
      const db = getDb();
      const user = await db.collection('users').findOne({ _id: payload.sub });
      if (user) {
        const newToken = issueToken(fastify, {
          _id: user._id,
          type: user.type as 'anonymous' | 'user',
          platform: user.platform as 'ios' | 'android',
          createdAt: user.createdAt,
          lastSeenAt: user.lastSeenAt,
        });
        reply.header('X-New-Token', newToken);
      }
    }
  } catch {
    // ignore auth errors for sliding expiry
  }
}