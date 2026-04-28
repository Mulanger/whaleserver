import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  upsertAlertSubscription,
  deleteAlertSubscription,
  getAlertSubscription,
} from '../../db/repos/alerts_repo.js';
import { extractUserId, verifyToken, shouldRefreshToken } from '../../auth/jwt.js';
import { getDb } from '../../db/mongo.js';

const subscribeSchema = z.object({
  fcmToken: z.string().min(1),
  minUsd: z.number().optional().default(25000),
  megaOnly: z.boolean().optional().default(false),
  categories: z.array(z.string()).optional().default([]),
  quietHours: z
    .object({
      start: z.string(),
      end: z.string(),
      tz: z.string(),
    })
    .nullable()
    .optional(),
});

const fcmTokenQuerySchema = z.object({
  fcmToken: z.string().min(1),
});

async function addSlidingExpiryHeader(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return;

    const token = authHeader.slice(7);
    const payload = verifyToken(fastify, token);

    if (shouldRefreshToken(payload)) {
      const db = getDb();
      const user = await db.collection('users').findOne({ _id: payload.sub });
      if (user) {
        const newToken = fastify.jwt.sign({
          sub: user._id,
          platform: user.platform,
          type: user.type,
        });
        reply.header('X-New-Token', newToken);
      }
    }
  } catch {
    // ignore auth errors for sliding expiry
  }
}

export async function registerAlertsRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });

  fastify.addHook('preHandler', addSlidingExpiryHeader);

  fastify.post('/subscribe', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const payload = verifyToken(fastify, request.headers.authorization!.replace('Bearer ', ''));
    const body = subscribeSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'invalid request body' });
    }

    const userId = extractUserId(payload);
    const { fcmToken, ...rest } = body.data;

    await upsertAlertSubscription({
      userId,
      fcmToken,
      platform: payload.platform,
      ...rest,
    });

    return reply.status(204).send();
  });

  fastify.delete('/subscribe', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const payload = verifyToken(fastify, request.headers.authorization!.replace('Bearer ', ''));
    const parsed = fcmTokenQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'fcmToken required' });
    }

    const userId = extractUserId(payload);
    await deleteAlertSubscription(userId, parsed.data.fcmToken);
    return reply.status(204).send();
  });

  fastify.get('/me', async (request, reply) => {
    const payload = verifyToken(fastify, request.headers.authorization!.replace('Bearer ', ''));
    const parsed = fcmTokenQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'fcmToken required' });
    }

    const userId = extractUserId(payload);
    const sub = await getAlertSubscription(userId, parsed.data.fcmToken);

    if (!sub) {
      return reply.status(404).send({ error: 'subscription not found' });
    }

    return reply.send(sub);
  });
}