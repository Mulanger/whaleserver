import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getLeaderboard, type LeaderboardSort } from '../../db/repos/leaderboard_repo.js';

const leaderboardQuerySchema = z.object({
  window: z.enum(['1d', '7d', '30d', '365d']).optional().default('1d'),
  sort: z.enum(['volume', 'profit']).optional().default('volume'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
  fresh: z.coerce.boolean().optional().default(false),
});

export async function registerLeaderboardRoutes(fastify: FastifyInstance) {
  fastify.get('/', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = leaderboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid query params' });
    }

    const { window, sort, limit, cursor, fresh } = parsed.data;
    const leaderboardSort: LeaderboardSort = sort === 'profit' ? 'profit' : 'volume';
    const result = await getLeaderboard(window, limit, cursor, fresh, leaderboardSort);

    return reply.send({
      window,
      sort: leaderboardSort,
      asOf: result.asOf,
      items: result.items,
      nextCursor: result.nextCursor,
    });
  });
}
