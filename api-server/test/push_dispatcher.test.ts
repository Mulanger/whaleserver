import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('push dispatcher', () => {
  beforeEach(() => {
    findMatchingSubscriptionsMock.mockReset();
    updateLastNotifiedMock.mockReset();
    deleteSubscriptionMock.mockReset();
    tryInsertNotificationLogMock.mockReset();
    markNotificationFailedMock.mockReset();
    sendPushMock.mockReset();
    incrementPushCountMock.mockReset();
    getPushCountMock.mockReset();
  });

  it('normalizes watcher _id payloads before sending FCM data', async () => {
    const { createDispatcher } = await import('../src/push/dispatcher.js');
    const redisSub = new EventEmitter();
    const subscription = {
      _id: 'sub-1',
      userId: 'user-1',
      fcmToken: 'fcm-token-1',
      platform: 'android',
      minUsd: 10000,
      megaOnly: false,
      categories: [],
      quietHours: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastNotifiedAt: null,
    };

    findMatchingSubscriptionsMock.mockResolvedValue([subscription]);
    getPushCountMock.mockResolvedValue(0);
    tryInsertNotificationLogMock.mockResolvedValue(true);
    sendPushMock.mockResolvedValue(undefined);
    incrementPushCountMock.mockResolvedValue(1);
    updateLastNotifiedMock.mockResolvedValue(undefined);

    createDispatcher(redisSub as any, {} as any, {
      REDIS_CHANNEL: 'whales',
      MAX_PUSHES_PER_USER_PER_HOUR: 5,
    } as any).start();

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
});
