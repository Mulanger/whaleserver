import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { logger } from './logger.js';
import { connectMongo, closeMongo } from './db/mongo.js';
import { ensureIndexes } from './db/indexes.js';
import { createRedisSubscriber, closeRedis } from './redis/subscriber.js';
import { rateLimitRedis } from './redis/rate_limit.js';
import { createHub } from './ws/hub.js';
import { registerWhalesRoutes } from './routes/v1/whales.js';
import { registerStreamRoute } from './routes/v1/stream.js';
import { registerMarketsRoutes } from './routes/v1/markets.js';
import { registerTradersRoutes } from './routes/v1/traders.js';
import { registerLeaderboardRoutes } from './routes/v1/leaderboard.js';
import { registerDashboardRoutes } from './routes/v1/dashboard.js';
import { registerMarketPagesRoutes } from './routes/v1/market_pages.js';
import { registerTraderPagesRoutes } from './routes/v1/trader_pages.js';
import { registerAlertsRoutes } from './routes/v1/alerts.js';
import { registerUsersRoutes } from './routes/v1/users.js';
import { registerAuthRoutes } from './routes/v1/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { createDispatcher } from './push/dispatcher.js';
import {
  initSentry,
  captureException,
  getMetrics,
  getContentType,
  httpRequestsTotal,
  httpRequestDurationMs,
} from './observability.js';

initSentry();

const fastify = Fastify({
  logger: { level: 'info' },
  bodyLimit: config.MAX_REQUEST_BODY_BYTES,
  ajv: {
    customOptions: { strict: 'reject' },
  },
});

fastify.addHook('onRequest', async (_request, reply) => {
  reply.startTime = Date.now();
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
});

fastify.addHook('onResponse', async (request, reply) => {
  const route = request.routeOptions?.url ?? request.url;
  const status = reply.statusCode;
  httpRequestsTotal.inc({ route, status: String(status) });
  if (reply.startTime) {
    httpRequestDurationMs.observe({ route }, Date.now() - reply.startTime);
  }
});

process.on('uncaughtException', (e) => captureException(e));
process.on('unhandledRejection', (e) => captureException(e));

await fastify.register(registerHealthRoutes);

await fastify.register(cors, {
  origin: config.CORS_ORIGINS,
  credentials: true,
});

const jwtSecret = config.JWT_PREVIOUS_SECRET
  ? [config.JWT_SECRET, config.JWT_PREVIOUS_SECRET]
  : config.JWT_SECRET;

await fastify.register(jwt, {
  secret: jwtSecret,
  sign: { expiresIn: config.JWT_TTL_SECONDS },
});

await fastify.register(rateLimit, {
  max: 60,
  timeWindow: '1 minute',
  redis: rateLimitRedis,
  skipOnError: true,
  keyGenerator: (request) => {
    return (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? request.ip
      ?? 'unknown';
  },
  errorResponseBuilder: (_request, context) => ({
    error: 'rate_limit_exceeded',
    message: `Rate limit exceeded, retry after ${context.after}`,
    retryAfter: context.after,
  }),
});

await fastify.register(websocket, {
  options: {
    maxPayload: 16 * 1024,
  },
});

const mongo = await connectMongo();
await ensureIndexes();
const redisSub = await createRedisSubscriber();
const hub = createHub(redisSub);

fastify.decorate('hub', hub);

fastify.get('/metrics', async (_request, reply) => {
  if (config.METRICS_TOKEN) {
    const auth = _request.headers.authorization;
    if (auth !== `Bearer ${config.METRICS_TOKEN}`) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  }

  const metrics = await getMetrics();
  reply.header('Content-Type', getContentType());
  return reply.send(metrics);
});

await fastify.register(registerAuthRoutes, { prefix: '/v1/auth' });
await fastify.register(registerWhalesRoutes, { prefix: '/v1/whales' });
await fastify.register(registerStreamRoute, { prefix: '/v1/whales/stream' });
await fastify.register(registerMarketsRoutes, { prefix: '/v1/markets' });
await fastify.register(registerTradersRoutes, { prefix: '/v1/traders' });
await fastify.register(registerLeaderboardRoutes, { prefix: '/v1/leaderboard' });
await fastify.register(registerDashboardRoutes, { prefix: '/v1/dashboard' });
await fastify.register(registerMarketPagesRoutes, { prefix: '/v1/market-pages' });
await fastify.register(registerTraderPagesRoutes, { prefix: '/v1/trader-pages' });
await fastify.register(registerUsersRoutes, { prefix: '/v1/users' });
await fastify.register(registerAlertsRoutes, { prefix: '/v1/alerts' });

if (config.FIREBASE_PROJECT_ID && config.FIREBASE_PROJECT_ID !== 'mock') {
  const dispatcher = createDispatcher(redisSub, mongo, config);
  dispatcher.start();
}

const shutdown = async () => {
  logger.info('shutting down');
  hub.closeAll(1001, 'server shutdown');
  await fastify.close();
  await closeMongo();
  await closeRedis();
  await rateLimitRedis.quit();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
logger.info(`API server listening on port ${config.PORT}`);
