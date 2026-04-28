import type { FastifyInstance } from 'fastify';
import { getTraderByWallet, getRecentWhalesForTrader } from '../../db/repos/traders_repo.js';

export async function registerTradersRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { wallet: string } }>('/:wallet', async (request, reply) => {
    const wallet = request.params.wallet;
    const trader = await getTraderByWallet(wallet);

    if (!trader) {
      return reply.status(404).send({ error: 'trader not found' });
    }

    const recentWhales = await getRecentWhalesForTrader(wallet, 20);
    return reply.send({ ...trader, recentWhales });
  });
}