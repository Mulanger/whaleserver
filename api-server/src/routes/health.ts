import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    return { status: 'ok', time: new Date().toISOString() };
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