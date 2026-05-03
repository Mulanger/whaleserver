import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { issueAnonymousToken } from '../../services/auth_service.js';

const anonymousSchema = z.object({
  deviceId: z.string().uuid(),
  platform: z.enum(['ios', 'android', 'web', 'unknown']),
});

export async function registerAuthRoutes(fastify: FastifyInstance) {
  fastify.post('/anonymous', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = anonymousSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'invalid request body' });
    }

    const { deviceId, platform } = body.data;
    const { token, userId } = await issueAnonymousToken(fastify, deviceId, platform);

    return reply.send({
      token,
      userId,
    });
  });
}
