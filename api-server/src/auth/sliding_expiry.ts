import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, shouldRefreshToken, issueTokenFromPayload } from './jwt.js';

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
      const newToken = issueTokenFromPayload(fastify, {
        sub: payload.sub,
        platform: payload.platform ?? 'unknown',
        type: payload.type,
      });
      reply.header('x-new-token', newToken);
    }
  } catch {
    // ignore auth errors for sliding expiry
  }
}
