import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { handleSlidingExpiry } from '../../auth/sliding_expiry.js';
import { ALERT_CATEGORIES } from '../../alerts/categories.js';
import { isValidQuietHours } from '../../alerts/quiet_hours.js';
import {
  subscribeToAlerts,
  unsubscribeFromAlerts,
  getHydrationSubscription,
} from '../../services/alerts_service.js';
import type { JwtPayload } from '../../auth/jwt.js';

const subscribeSchema = z.object({
  fcmToken: z.string().min(1),
  minUsd: z.number(),
  megaOnly: z.boolean(),
  followingOnly: z.boolean().optional().default(false),
  categories: z.array(z.enum(ALERT_CATEGORIES)),
  quietHours: z
    .object({
      start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
      tz: z.string(),
    })
    .nullable()
    .optional()
    .superRefine((quietHours, ctx) => {
      if (!quietHours) return;
      if (!isValidQuietHours(quietHours)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'invalid quietHours',
        });
      }
    }),
});

const unsubscribeSchema = z
  .object({
    fcmToken: z.string().min(1).optional(),
  })
  .strict();

function authUser(request: FastifyRequest): JwtPayload {
  return (request as FastifyRequest & { user: JwtPayload }).user;
}

export async function registerAlertsRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });

  fastify.addHook('preHandler', async (request, reply) => {
    await handleSlidingExpiry(fastify, request, reply);
  });

  fastify.post('/subscribe', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = subscribeSchema.safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'invalid request body' });
    }

    const user = authUser(request);
    const { fcmToken, minUsd, megaOnly, followingOnly, categories, quietHours } = body.data;

    await subscribeToAlerts({
      userId: user.sub,
      fcmToken,
      minUsd,
      megaOnly,
      followingOnly,
      categories,
      quietHours,
      platform: user.platform,
    });

    return reply.status(204).send();
  });

  fastify.delete('/subscribe', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = unsubscribeSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid request body' });
    }

    const user = authUser(request);
    await unsubscribeFromAlerts(user.sub, parsed.data.fcmToken);
    return reply.status(204).send();
  });

  fastify.get('/me', async (request, reply) => {
    const user = authUser(request);
    const sub = await getHydrationSubscription(user.sub);

    if (!sub) {
      return reply.status(404).send({ error: 'subscription not found' });
    }

    return reply.send({
      subscription: {
        fcmToken: sub.fcmToken,
        minUsd: sub.minUsd,
        megaOnly: sub.megaOnly,
        followingOnly: sub.followingOnly,
        categories: sub.categories,
        quietHours: sub.quietHours ?? null,
      },
    });
  });
}
