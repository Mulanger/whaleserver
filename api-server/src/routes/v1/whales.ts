import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getWhales, getWhaleById, getWhaleDetailById } from '../../db/repos/whales_repo.js';
import type { WhaleFilter, Cursor } from '../../shared/types.js';
import { verifyToken, extractUserId } from '../../auth/jwt.js';
import { getFollowedWallets } from '../../db/repos/follows_repo.js';

const whaleQuerySchema = z.object({
  minUsd: z.coerce.number().finite().nonnegative().max(1_000_000_000).optional(),
  maxUsd: z.coerce.number().finite().nonnegative().max(1_000_000_000).optional(),
  tier: z.enum(['mega', 'large', 'whale', 'mini']).optional(),
  category: z.string().trim().max(100).optional(),
  categories: z.string().trim().max(2_000).optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  marketSlug: z.string().trim().max(250).optional(),
  traderWallet: z.union([z.string().regex(/^0x[0-9a-fA-F]{40}$/), z.literal('')]).optional(),
  following: z.coerce.boolean().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).refine((query) => {
  if (query.minUsd == null || query.maxUsd == null) return true;
  return query.minUsd <= query.maxUsd;
});

const cursorSchema = z.object({
  ts: z.number().int().nonnegative(),
  id: z.string().min(1).max(128),
}).strict();

function decodeCursor(cursor: string): Cursor | undefined {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = cursorSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : undefined;
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
