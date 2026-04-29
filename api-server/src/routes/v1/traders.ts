import type { FastifyInstance } from 'fastify';
import { getTraderProfile } from '../../db/repos/leaderboard_repo.js';

export async function registerTradersRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { wallet: string } }>('/:wallet', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const wallet = request.params.wallet;
    const trader = await getTraderProfile(wallet);

    if (!trader) {
      return reply.status(404).send({ error: 'trader not found' });
    }

    return reply.send(trader);
  });
}
