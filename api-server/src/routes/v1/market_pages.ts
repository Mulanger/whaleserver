import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  getMarketPageBySlug,
  getMarketPageSitemap,
} from '../../db/repos/market_pages_repo.js';

const marketPagesQuerySchema = z.object({
  indexable: z.coerce.boolean().optional().default(true),
  limit: z.coerce.number().int().min(1).max(500).optional().default(250),
});

export async function registerMarketPagesRoutes(fastify: FastifyInstance) {
  fastify.get('/', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = marketPagesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid query params' });
    }

    if (!parsed.data.indexable) {
      return reply.status(400).send({ error: 'only indexable market-page listing is supported' });
    }

    return reply.send(await getMarketPageSitemap({ limit: parsed.data.limit }));
  });

  fastify.get<{ Params: { slug: string } }>('/:slug', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const marketPage = await getMarketPageBySlug(request.params.slug);
    if (!marketPage) {
      return reply.status(404).send({ error: 'market page not found' });
    }

    return reply.send(marketPage);
  });
}
