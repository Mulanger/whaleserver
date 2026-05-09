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

  const tradeOutcomes = db.collection('trade_outcomes');
  try {
    await tradeOutcomes.createIndexes([
      {
        key: { proxyWallet: 1, side: 1, status: 1, timestamp: 1, resolvedAt: 1, _id: 1 },
        name: 'idx_tradeOutcomes_wallet_resolved_chronological',
      },
      {
        key: { proxyWallet: 1, side: 1, status: 1, resolvedAt: -1, timestamp: -1 },
        name: 'idx_tradeOutcomes_wallet_resolved_recent',
      },
    ]);
    logger.info('created indexes on trade_outcomes resolved wallet reads');
  } catch (err) {
    logger.warn({ err }, 'trade_outcomes indexes failed; continuing startup');
  }

  const marketPageSnapshots = db.collection('market_page_snapshots');
  try {
    await marketPageSnapshots.createIndexes([
      {
        key: { slug: 1 },
        unique: true,
        name: 'slug_1',
      },
      { key: { indexable: 1, 'stats.whaleVolume': -1 }, name: 'idx_marketPageSnapshots_indexable_volume' },
      { key: { 'stats.latestTradeTs': -1 }, name: 'idx_marketPageSnapshots_latestTrade' },
      { key: { refreshedAt: 1 }, name: 'idx_marketPageSnapshots_refreshedAt' },
    ]);
    logger.info('created indexes on market_page_snapshots');
  } catch (err) {
    logger.warn({ err }, 'market_page_snapshots indexes failed; continuing startup');
  }

  const traderPageIndex = db.collection('trader_page_index');
  try {
    await traderPageIndex.createIndexes([
      { key: { proxyWallet: 1 }, unique: true, name: 'proxyWallet_1' },
      { key: { indexable: 1, bestRank: 1 }, name: 'idx_traderPageIndex_indexable_rank' },
      { key: { indexable: 1, bestVolume: -1 }, name: 'idx_traderPageIndex_indexable_volume' },
      { key: { lastSeenTs: -1 }, name: 'idx_traderPageIndex_lastSeen' },
    ]);
    logger.info('created indexes on trader_page_index');
  } catch (err) {
    logger.warn({ err }, 'trader_page_index indexes failed; continuing startup');
  }

  logger.info('all MongoDB indexes ensured');
}
