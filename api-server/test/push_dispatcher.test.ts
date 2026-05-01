import { EventEmitter } from 'node:events';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://localhost:27017';
process.env.JWT_SECRET = 'test-secret';
process.env.FIREBASE_PROJECT_ID = 'mock';

const findMatchingSubscriptionsMock = vi.fn();
const updateLastNotifiedMock = vi.fn();
const deleteSubscriptionMock = vi.fn();
const tryInsertNotificationLogMock = vi.fn();
const markNotificationFailedMock = vi.fn();
const sendPushMock = vi.fn();
const incrementPushCountMock = vi.fn();
const getPushCountMock = vi.fn();
const isUserFollowingMock = vi.fn();
let createDispatcher: typeof import('../src/push/dispatcher.js').createDispatcher;

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'sub-1',
    userId: 'user-1',
    fcmToken: 'fcm-token-1',
    platform: 'android',
    minUsd: 10000,
    megaOnly: false,
    followingOnly: false,
    categories: [],
    quietHours: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastNotifiedAt: null,
    ...overrides,
  };
}

function emitWhale(redisSub: EventEmitter) {
  redisSub.emit('message', 'whales', JSON.stringify({
    _id: 'real-whale-1',
    tier: 'mini',
    side: 'BUY',
    outcome: 'Yes',
    usdSize: 12500,
    shares: 25000,
    priceCents: 50,
    timestamp: 1777544540,
    market: {
      slug: 'market-slug',
      title: 'Market title',
      category: null,
      polymarketUrl: 'https://polymarket.com/event/foo/bar',
    },
    trader: { proxyWallet: '0xabc' },
    transactionHash: '0xtx',
    raw: { price: 0.5 },
  }));
}

vi.mock('../src/db/repos/alerts_repo.js', () => ({
  findMatchingSubscriptions: findMatchingSubscriptionsMock,
  updateLastNotified: updateLastNotifiedMock,
  deleteSubscription: deleteSubscriptionMock,
  tryInsertNotificationLog: tryInsertNotificationLogMock,
  markNotificationFailed: markNotificationFailedMock,
}));

vi.mock('../src/push/fcm.js', () => ({
  sendPush: sendPushMock,
  isInvalidTokenError: () => false,
}));

vi.mock('../src/redis/locks.js', () => ({
  incrementPushCount: incrementPushCountMock,
  getPushCount: getPushCountMock,
}));

vi.mock('../src/db/repos/follows_repo.js', () => ({
  isUserFollowing: isUserFollowingMock,
}));

describe('push dispatcher', () => {
  beforeAll(async () => {
    ({ createDispatcher } = await import('../src/push/dispatcher.js'));
  });

  beforeEach(() => {
    findMatchingSubscriptionsMock.mockReset();
    updateLastNotifiedMock.mockReset();
    deleteSubscriptionMock.mockReset();
    tryInsertNotificationLogMock.mockReset();
    markNotificationFailedMock.mockReset();
    sendPushMock.mockReset();
    incrementPushCountMock.mockReset();
    getPushCountMock.mockReset();
    isUserFollowingMock.mockReset();
  });

  it('normalizes watcher _id payloads before sending FCM data', async () => {
    const redisSub = new EventEmitter();

    findMatchingSubscriptionsMock.mockResolvedValue([makeSubscription()]);
    getPushCountMock.mockResolvedValue(0);
    tryInsertNotificationLogMock.mockResolvedValue(true);
    sendPushMock.mockResolvedValue(undefined);
    incrementPushCountMock.mockResolvedValue(1);
    updateLastNotifiedMock.mockResolvedValue(undefined);

    createDispatcher(redisSub as any, {} as any, {
      REDIS_CHANNEL: 'whales',
      MAX_PUSHES_PER_USER_PER_HOUR: 5,
    } as any).start();

    emitWhale(redisSub);

    await vi.waitFor(() => {
      expect(sendPushMock).toHaveBeenCalledOnce();
    });
    expect(tryInsertNotificationLogMock).toHaveBeenCalledWith('real-whale-1', 'fcm-token-1');
    expect(sendPushMock).toHaveBeenCalledWith(
      'fcm-token-1',
      expect.objectContaining({ title: expect.stringContaining('$13K') }),
      { type: 'whale', tradeId: 'real-whale-1' }
    );
  });

  it('skips sends after the hourly user push cap is reached', async () => {
    const redisSub = new EventEmitter();

    findMatchingSubscriptionsMock.mockResolvedValue([makeSubscription()]);
    getPushCountMock.mockResolvedValue(5);

    createDispatcher(redisSub as any, {} as any, {
      REDIS_CHANNEL: 'whales',
      MAX_PUSHES_PER_USER_PER_HOUR: 5,
    } as any).start();

    emitWhale(redisSub);

    await vi.waitFor(() => {
      expect(getPushCountMock).toHaveBeenCalledOnce();
    });
    expect(tryInsertNotificationLogMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it('skips sends during quiet hours before rate-limit checks', async () => {
    const redisSub = new EventEmitter();

    findMatchingSubscriptionsMock.mockResolvedValue([
      makeSubscription({
        quietHours: { start: '00:00', end: '00:00', tz: 'UTC' },
      }),
    ]);

    createDispatcher(redisSub as any, {} as any, {
      REDIS_CHANNEL: 'whales',
      MAX_PUSHES_PER_USER_PER_HOUR: 5,
    } as any).start();

    emitWhale(redisSub);

    await vi.waitFor(() => {
      expect(findMatchingSubscriptionsMock).toHaveBeenCalledOnce();
    });
    expect(getPushCountMock).not.toHaveBeenCalled();
    expect(tryInsertNotificationLogMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it('sends following-only alerts when the whale trader is followed', async () => {
    const redisSub = new EventEmitter();

    findMatchingSubscriptionsMock.mockResolvedValue([
      makeSubscription({ followingOnly: true }),
    ]);
    isUserFollowingMock.mockResolvedValue(true);
    getPushCountMock.mockResolvedValue(0);
    tryInsertNotificationLogMock.mockResolvedValue(true);
    sendPushMock.mockResolvedValue(undefined);
    incrementPushCountMock.mockResolvedValue(1);
    updateLastNotifiedMock.mockResolvedValue(undefined);

    createDispatcher(redisSub as any, {} as any, {
      REDIS_CHANNEL: 'whales',
      MAX_PUSHES_PER_USER_PER_HOUR: 5,
    } as any).start();

    emitWhale(redisSub);

    await vi.waitFor(() => {
      expect(sendPushMock).toHaveBeenCalledOnce();
    });
    expect(isUserFollowingMock).toHaveBeenCalledWith('user-1', '0xabc');
  });

  it('skips following-only alerts when the whale trader is not followed', async () => {
    const redisSub = new EventEmitter();

    findMatchingSubscriptionsMock.mockResolvedValue([
      makeSubscription({ followingOnly: true }),
    ]);
    isUserFollowingMock.mockResolvedValue(false);

    createDispatcher(redisSub as any, {} as any, {
      REDIS_CHANNEL: 'whales',
      MAX_PUSHES_PER_USER_PER_HOUR: 5,
    } as any).start();

    emitWhale(redisSub);

    await vi.waitFor(() => {
      expect(isUserFollowingMock).toHaveBeenCalledOnce();
    });
    expect(getPushCountMock).not.toHaveBeenCalled();
    expect(tryInsertNotificationLogMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });
});
