import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getMarkets, getMarketBySlug, getRecentWhalesForMarket } from '../../db/repos/markets_repo.js';

const marketsQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  active: z.coerce.boolean().optional().default(true),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export async function registerMarketsRoutes(fastify: FastifyInstance) {
  fastify.get('/', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = marketsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid query params' });
    }

    const result = await getMarkets({
      search: parsed.data.search,
      category: parsed.data.category,
      active: parsed.data.active,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });
    return reply.send(result);
  });

  fastify.get<{ Params: { slug: string } }>('/:slug', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const market = await getMarketBySlug(request.params.slug);
    if (!market) {
      return reply.status(404).send({ error: 'market not found' });
    }

    const recentWhales = await getRecentWhalesForMarket(request.params.slug, 20);
    return reply.send({ ...market, recentWhales });
  });
}