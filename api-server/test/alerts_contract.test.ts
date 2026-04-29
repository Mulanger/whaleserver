import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface StoredSubscription {
  userId: string;
  fcmToken: string;
  minUsd: number;
  megaOnly: boolean;
  categories: string[];
  quietHours?: { start: string; end: string; tz: string } | null;
}

const subscriptionsByUser = new Map<string, Map<string, StoredSubscription>>();

const issueAnonymousTokenMock = vi.fn(async (
  fastify: FastifyInstance,
  deviceId: string,
  platform: 'ios' | 'android' | 'unknown'
) => ({
  token: fastify.jwt.sign({
    sub: `anon_${deviceId}`,
    platform,
    type: 'anonymous',
  }),
  userId: `anon_${deviceId}`,
}));

const subscribeToAlertsMock = vi.fn(async (input: StoredSubscription & { platform?: string }) => {
  const userSubs = subscriptionsByUser.get(input.userId) ?? new Map<string, StoredSubscription>();
  userSubs.set(input.fcmToken, {
    userId: input.userId,
    fcmToken: input.fcmToken,
    minUsd: input.minUsd,
    megaOnly: input.megaOnly,
    categories: input.categories,
    quietHours: input.quietHours ?? null,
  });
  subscriptionsByUser.set(input.userId, userSubs);
});

const unsubscribeFromAlertsMock = vi.fn(async (userId: string, fcmToken?: string) => {
  if (!subscriptionsByUser.has(userId)) return;
  if (fcmToken) {
    subscriptionsByUser.get(userId)?.delete(fcmToken);
    return;
  }
  subscriptionsByUser.delete(userId);
});

const getHydrationSubscriptionMock = vi.fn(async (userId: string) => {
  const userSubs = subscriptionsByUser.get(userId);
  if (!userSubs || userSubs.size === 0) return null;
  return userSubs.values().next().value ?? null;
});

vi.mock('../src/services/auth_service.js', () => ({
  issueAnonymousToken: issueAnonymousTokenMock,
}));

vi.mock('../src/services/alerts_service.js', () => ({
  subscribeToAlerts: subscribeToAlertsMock,
  unsubscribeFromAlerts: unsubscribeFromAlertsMock,
  getHydrationSubscription: getHydrationSubscriptionMock,
}));

async function createApp() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  process.env.MONGO_URI = 'mongodb://localhost:27017';

  const { registerAuthRoutes } = await import('../src/routes/v1/auth.js');
  const { registerAlertsRoutes } = await import('../src/routes/v1/alerts.js');

  const app = Fastify();
  await app.register(jwt, {
    secret: process.env.JWT_SECRET,
    sign: { expiresIn: 30 * 24 * 60 * 60 },
  });
  await app.register(registerAuthRoutes, { prefix: '/v1/auth' });
  await app.register(registerAlertsRoutes, { prefix: '/v1/alerts' });
  return app;
}

function authHeader(app: FastifyInstance, userId: string, ttlSeconds = 30 * 24 * 60 * 60) {
  const token = app.jwt.sign(
    { sub: userId, platform: 'ios', type: 'anonymous' },
    { expiresIn: ttlSeconds }
  );
  return { authorization: `Bearer ${token}` };
}

beforeEach(() => {
  subscriptionsByUser.clear();
  issueAnonymousTokenMock.mockClear();
  subscribeToAlertsMock.mockClear();
  unsubscribeFromAlertsMock.mockClear();
  getHydrationSubscriptionMock.mockClear();
});

describe('/v1/auth/anonymous', () => {
  it('accepts unknown platform and returns token + userId', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/anonymous',
      payload: {
        deviceId: '550e8400-e29b-41d4-a716-446655440000',
        platform: 'unknown',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      token: expect.any(String),
      userId: 'anon_550e8400-e29b-41d4-a716-446655440000',
    });
    expect(issueAnonymousTokenMock).toHaveBeenCalledOnce();
    await app.close();
  });
});

describe('/v1/alerts lifecycle', () => {
  it('requires bearer auth', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/alerts/subscribe',
      payload: {
        fcmToken: 'token-1',
        minUsd: 1000,
        megaOnly: false,
        categories: [],
      },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('supports subscribe -> me -> delete(token) -> me(404)', async () => {
    const app = await createApp();
    const headers = authHeader(app, 'anon_user_1');

    const subscribeResponse = await app.inject({
      method: 'POST',
      url: '/v1/alerts/subscribe',
      headers,
      payload: {
        fcmToken: 'token-1',
        minUsd: 25000,
        megaOnly: true,
        categories: ['Crypto'],
        quietHours: { start: '22:00', end: '07:00', tz: 'UTC' },
      },
    });

    expect(subscribeResponse.statusCode).toBe(204);

    const meResponse = await app.inject({
      method: 'GET',
      url: '/v1/alerts/me',
      headers,
    });
    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toEqual({
      subscription: {
        fcmToken: 'token-1',
        minUsd: 25000,
        megaOnly: true,
        categories: ['Crypto'],
        quietHours: { start: '22:00', end: '07:00', tz: 'UTC' },
      },
    });

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/alerts/subscribe',
      headers,
      payload: { fcmToken: 'token-1' },
    });
    expect(deleteResponse.statusCode).toBe(204);

    const meAfterDelete = await app.inject({
      method: 'GET',
      url: '/v1/alerts/me',
      headers,
    });
    expect(meAfterDelete.statusCode).toBe(404);
    await app.close();
  });

  it('deletes all subscriptions when DELETE body is empty', async () => {
    const app = await createApp();
    const headers = authHeader(app, 'anon_user_2');

    await app.inject({
      method: 'POST',
      url: '/v1/alerts/subscribe',
      headers,
      payload: {
        fcmToken: 'token-a',
        minUsd: 1000,
        megaOnly: false,
        categories: [],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/alerts/subscribe',
      headers,
      payload: {
        fcmToken: 'token-b',
        minUsd: 2000,
        megaOnly: false,
        categories: ['Tech'],
      },
    });

    const deleteAllResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/alerts/subscribe',
      headers,
    });

    expect(deleteAllResponse.statusCode).toBe(204);

    const meResponse = await app.inject({
      method: 'GET',
      url: '/v1/alerts/me',
      headers,
    });
    expect(meResponse.statusCode).toBe(404);
    await app.close();
  });

  it('returns x-new-token when token is near expiry', async () => {
    const app = await createApp();
    const headers = authHeader(app, 'anon_user_3', 60);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/alerts/me',
      headers,
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['x-new-token']).toEqual(expect.any(String));
    await app.close();
  });
});

