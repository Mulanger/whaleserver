import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({ ok: true }));
}
