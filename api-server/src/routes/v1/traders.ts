import type { FastifyInstance } from 'fastify';
import { verifyToken, extractUserId } from '../../auth/jwt.js';
import { getCachedTraderProfile } from '../../db/repos/leaderboard_repo.js';

const WALLET_REGEX = /^0x[0-9a-f]{40}$/;

export async function registerTradersRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { wallet: string } }>('/:wallet', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const wallet = request.params.wallet.toLowerCase();
    if (!WALLET_REGEX.test(wallet)) {
      return reply.status(400).send({ error: 'invalid wallet' });
    }

    let currentUserId: string | undefined;
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = verifyToken(fastify, authHeader.slice(7));
        currentUserId = extractUserId(payload);
      } catch {
        return reply.status(401).send({ error: 'unauthorized' });
      }
    }

    const trader = await getCachedTraderProfile(wallet, currentUserId);

    if (!trader) {
      return reply.status(404).send({ error: 'trader not found' });
    }

    return reply.send(trader);
  });
}
