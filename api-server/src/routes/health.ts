import type { FastifyInstance } from 'fastify';
import { getDb } from '../db/mongo.js';
import { getSubscriber } from '../redis/subscriber.js';

export async function registerHealthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (_request, reply) => {
    let mongoOk = true;
    let mongoErr = '';
    let redisOk = true;
    let redisErr = '';

    try {
      const mongo = getDb();
      await mongo.command({ ping: 1 });
    } catch (err) {
      mongoOk = false;
      mongoErr = String(err);
    }

    try {
      const redis = getSubscriber();
      await redis.ping();
    } catch (err) {
      redisOk = false;
      redisErr = String(err);
    }

    if (!mongoOk || !redisOk) {
      fastify.log.error({ mongoOk, mongoErr, redisOk, redisErr }, 'Health check failed');
      return reply.status(503).send({ ok: false, mongo: mongoOk, redis: redisOk, mongoErr, redisErr });
    }

    return reply.send({ ok: true, mongo: true, redis: true });
  });

  fastify.get('/ready', async (_request, reply) => {
    const mongo = getDb();
    const redis = getSubscriber();

    try {
      await mongo.command({ ping: 1 });
    } catch {
      return reply.status(503).send({ ok: false, mongo: false, redis: true });
    }

    try {
      await redis.ping();
    } catch {
      return reply.status(503).send({ ok: false, mongo: true, redis: false });
    }

    return reply.send({ ok: true, mongo: true, redis: true });
  });
}