import { getDb } from './mongo.js';
import { logger } from '../logger.js';

export async function ensureIndexes(): Promise<void> {
  const db = getDb();

  await db.collection('users').createIndex(
    { lastSeenAt: 1 },
    { name: 'idx_users_lastSeenAt' }
  );
  logger.info('created index on users.lastSeenAt');

  const alertSubs = db.collection('alert_subscriptions');
  await alertSubs.createIndexes([
    { key: { userId: 1, fcmToken: 1 }, unique: true, name: 'idx_alertSubs_userId_fcmToken' },
    { key: { fcmToken: 1 }, name: 'idx_alertSubs_fcmToken' },
    { key: { userId: 1, updatedAt: -1 }, name: 'idx_alertSubs_userId_updatedAt' },
    { key: { minUsd: 1, megaOnly: 1, categories: 1 }, name: 'idx_alertSubs_match' },
  ]);
  logger.info('created indexes on alert_subscriptions');

  const notifLog = db.collection('notification_log');
  await notifLog.createIndexes([
    { key: { whaleId: 1, fcmToken: 1 }, unique: true, name: 'idx_notifLog_whaleId_fcmToken' },
    {
      key: { sentAt: 1 },
      expireAfterSeconds: 7 * 24 * 60 * 60,
      name: 'idx_notifLog_ttl',
    },
  ]);
  logger.info('created indexes on notification_log with 7-day TTL');

  const traderFollows = db.collection('trader_follows');
  await traderFollows.createIndexes([
    { key: { userId: 1, proxyWallet: 1 }, unique: true, name: 'idx_follows_user_wallet' },
    { key: { userId: 1, createdAt: -1 }, name: 'idx_follows_user_recent' },
    { key: { proxyWallet: 1 }, name: 'idx_follows_wallet' },
  ]);
  logger.info('created indexes on trader_follows');

  const trades = db.collection('trades');
  await trades.createIndexes([
    { key: { 'market.conditionId': 1, timestamp: -1 }, name: 'idx_trades_marketCondition_time' },
    { key: { 'market.slug': 1, timestamp: -1 }, name: 'idx_trades_marketSlug_time' },
    { key: { 'market.title': 1, timestamp: -1 }, name: 'idx_trades_marketTitle_time' },
  ]);
  logger.info('created indexes on trades for market-related lookups');

  logger.info('all MongoDB indexes ensured');
}
