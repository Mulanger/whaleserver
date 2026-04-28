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
    { key: { minUsd: 1, categories: 1 }, name: 'idx_alertSubs_minUsd_categories' },
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

  logger.info('all MongoDB indexes ensured');
}