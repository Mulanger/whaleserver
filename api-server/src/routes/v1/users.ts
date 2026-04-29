import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getDb } from '../../db/mongo.js';
import {
  followTrader,
  unfollowTrader,
  listFollowsWithCreatedAt,
} from '../../db/repos/follows_repo.js';
import { invalidateTraderProfileCache } from '../../db/repos/leaderboard_repo.js';

const followBodySchema = z.object({
  proxyWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

const followParamSchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

function getRateLimitUserKey(request: FastifyRequest): string {
  const userId = (request as FastifyRequest & { user?: { sub?: string } }).user?.sub;
  return userId ?? request.ip ?? 'unknown';
}

function startDateForDays(days: number): string {
  const utcToday = new Date();
  utcToday.setUTCHours(0, 0, 0, 0);
  utcToday.setUTCDate(utcToday.getUTCDate() - (days - 1));
  const year = utcToday.getUTCFullYear();
  const month = String(utcToday.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utcToday.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function registerUsersRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });

  fastify.post('/me/follows', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: getRateLimitUserKey } },
  }, async (request, reply) => {
    const body = followBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid request body' });
    }

    const wallet = body.data.proxyWallet.toLowerCase();
    const userId = (request as FastifyRequest & { user: { sub: string } }).user.sub;
    const db = getDb();

    const exists = await db.collection('trades').countDocuments(
      { 'trader.proxyWallet': wallet },
      { limit: 1 },
    );
    if (exists === 0) {
      return reply.status(404).send({ error: 'trader not found' });
    }

    await followTrader(userId, wallet);
    invalidateTraderProfileCache(wallet, userId);
    return reply.status(204).send();
  });

  fastify.delete<{ Params: { wallet: string } }>('/me/follows/:wallet', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: getRateLimitUserKey } },
  }, async (request, reply) => {
    const parsed = followParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid wallet' });
    }

    const wallet = parsed.data.wallet.toLowerCase();
    const userId = (request as FastifyRequest & { user: { sub: string } }).user.sub;

    await unfollowTrader(userId, wallet);
    invalidateTraderProfileCache(wallet, userId);
    return reply.status(204).send();
  });

  fastify.get('/me/follows', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: getRateLimitUserKey } },
  }, async (request, reply) => {
    const userId = (request as FastifyRequest & { user: { sub: string } }).user.sub;
    const follows = await listFollowsWithCreatedAt(userId, 500);

    if (follows.length === 0) {
      return reply.send({ items: [] });
    }

    const wallets = follows.map((item) => item.proxyWallet);
    const db = getDb();
    const startDate = startDateForDays(7);

    const [profiles, volumes] = await Promise.all([
      db.collection('trades').aggregate<{ _id: string; pseudonym: string | null; profileImage: string | null }>([
        { $match: { 'trader.proxyWallet': { $in: wallets } } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$trader.proxyWallet',
            pseudonym: { $first: '$trader.pseudonym' },
            profileImage: { $first: '$trader.profileImage' },
          },
        },
      ]).toArray(),
      db.collection('trader_daily_stats').aggregate<{ _id: string; vol7d: number }>([
        { $match: { proxyWallet: { $in: wallets }, date: { $gte: startDate } } },
        { $group: { _id: '$proxyWallet', vol7d: { $sum: '$volume' } } },
      ]).toArray(),
    ]);

    const profileByWallet = new Map(profiles.map((item) => [item._id, item]));
    const volumeByWallet = new Map(volumes.map((item) => [item._id, item.vol7d]));

    return reply.send({
      items: follows.map((item) => ({
        proxyWallet: item.proxyWallet,
        pseudonym: profileByWallet.get(item.proxyWallet)?.pseudonym ?? null,
        profileImage: profileByWallet.get(item.proxyWallet)?.profileImage ?? null,
        vol7d: volumeByWallet.get(item.proxyWallet) ?? 0,
        followedAt: Math.floor(item.createdAt.getTime() / 1000),
      })),
    });
  });
}
