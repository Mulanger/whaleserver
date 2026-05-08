import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getTraderPageSitemap } from '../../db/repos/trader_pages_repo.js';

const traderPagesQuerySchema = z.object({
  indexable: z.coerce.boolean().optional().default(true),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(500),
});

export async function registerTraderPagesRoutes(fastify: FastifyInstance) {
  fastify.get('/', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = traderPagesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid query params' });
    }

    if (!parsed.data.indexable) {
      return reply.status(400).send({ error: 'only indexable trader-page listing is supported' });
    }

    return reply.send(await getTraderPageSitemap({ limit: parsed.data.limit }));
  });
}
