import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getTodayDashboard } from '../../db/repos/dashboard_repo.js';

const dashboardTodayQuerySchema = z.object({
  minUsd: z.coerce.number().optional(),
  maxUsd: z.coerce.number().optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  category: z.string().optional(),
  categories: z.string().optional(),
  recentLimit: z.coerce.number().int().min(1).max(100).optional().default(100),
  leaderboardLimit: z.coerce.number().int().min(1).max(100).optional().default(50),
  fresh: z.coerce.boolean().optional().default(false),
});

function parseCategories(category?: string, categories?: string): string[] | undefined {
  const values = [
    ...(category ? [category] : []),
    ...(categories ? categories.split(',') : []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length ? values : undefined;
}

export async function registerDashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/today', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = dashboardTodayQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid query params' });
    }

    const q = parsed.data;
    const result = await getTodayDashboard(
      {
        minUsd: q.minUsd,
        maxUsd: q.maxUsd,
        side: q.side,
        categories: parseCategories(q.category, q.categories),
      },
      {
        recentLimit: q.recentLimit,
        leaderboardLimit: q.leaderboardLimit,
        fresh: q.fresh,
      }
    );

    return reply.send(result);
  });
}
