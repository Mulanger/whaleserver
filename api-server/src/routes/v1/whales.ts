import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getWhales, getWhaleById, getWhaleDetailById } from '../../db/repos/whales_repo.js';
import type { WhaleFilter, Cursor } from '../../shared/types.js';
import { verifyToken, extractUserId } from '../../auth/jwt.js';
import { getFollowedWallets } from '../../db/repos/follows_repo.js';

const whaleQuerySchema = z.object({
  minUsd: z.coerce.number().optional(),
  maxUsd: z.coerce.number().optional(),
  tier: z.enum(['mega', 'large', 'whale', 'mini']).optional(),
  category: z.string().optional(),
  categories: z.string().optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  marketSlug: z.string().optional(),
  traderWallet: z.string().optional(),
  following: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function decodeCursor(cursor: string): Cursor | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as Cursor;
  } catch {
    return undefined;
  }
}

export async function registerWhalesRoutes(fastify: FastifyInstance) {
  fastify.get('/', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = whaleQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid query params' });
    }

    const q = parsed.data;
    let followedWallets: string[] | undefined;
    if (q.following === true) {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'auth required for following filter' });
      }

      let userId: string;
      try {
        const payload = verifyToken(fastify, authHeader.slice(7));
        userId = extractUserId(payload);
      } catch {
        return reply.status(401).send({ error: 'unauthorized' });
      }

      followedWallets = await getFollowedWallets(userId, 500);
      if (followedWallets.length === 0) {
        return reply.send({ items: [], nextCursor: null });
      }
    }

    const filter: WhaleFilter = {
      minUsd: q.minUsd,
      maxUsd: q.maxUsd,
      tier: q.tier,
      categories: q.categories?.split(',').filter(Boolean),
      side: q.side,
      marketSlug: q.marketSlug,
      traderWallet: q.traderWallet,
      traderWallets: followedWallets,
      following: q.following,
    };

    const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
    const result = await getWhales(filter, cursor, q.limit);

    return reply.send(result);
  });

  fastify.get<{ Params: { id: string } }>('/:id/detail', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const detail = await getWhaleDetailById(request.params.id);
    if (!detail) {
      return reply.status(404).send({ error: 'whale not found' });
    }
    return reply.send(detail);
  });

  fastify.get<{ Params: { id: string } }>('/:id', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const whale = await getWhaleById(request.params.id);
    if (!whale) {
      return reply.status(404).send({ error: 'whale not found' });
    }
    return reply.send(whale);
  });
}
