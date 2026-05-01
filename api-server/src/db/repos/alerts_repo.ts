import { ObjectId } from 'mongodb';
import { getDb } from '../mongo.js';
import type { AlertSubscription, MobilePlatform } from '../../shared/types.js';
import { matchesSubscription } from '../../alerts/matching.js';

const MEGA_MIN_USD = 250_000;

function mapAlertSubscription(doc: Record<string, any>): AlertSubscription {
  return {
    _id: doc._id.toString(),
    userId: doc.userId,
    fcmToken: doc.fcmToken,
    platform: (doc.platform as MobilePlatform | undefined) ?? 'unknown',
    minUsd: doc.minUsd,
    megaOnly: doc.megaOnly,
    followingOnly: doc.followingOnly ?? false,
    categories: doc.categories,
    quietHours: doc.quietHours,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastNotifiedAt: doc.lastNotifiedAt,
  };
}

export async function upsertAlertSubscription(sub: {
  userId: string;
  fcmToken: string;
  platform?: MobilePlatform;
  minUsd: number;
  megaOnly: boolean;
  followingOnly: boolean;
  categories: string[];
  quietHours?: { start: string; end: string; tz: string } | null;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  const setPayload: Record<string, any> = {
    minUsd: sub.minUsd,
    megaOnly: sub.megaOnly,
    followingOnly: sub.followingOnly,
    categories: sub.categories,
    quietHours: sub.quietHours ?? null,
    updatedAt: now,
  };
  const setOnInsert: Record<string, any> = {
    userId: sub.userId,
    fcmToken: sub.fcmToken,
    createdAt: now,
    lastNotifiedAt: null,
  };

  if (sub.platform && sub.platform !== 'unknown') {
    setPayload.platform = sub.platform;
  } else {
    setOnInsert.platform = 'unknown';
  }

  await db.collection('alert_subscriptions').updateOne(
    { userId: sub.userId, fcmToken: sub.fcmToken },
    {
      $set: setPayload,
      $setOnInsert: setOnInsert,
    },
    { upsert: true }
  );
}

export async function deleteAlertSubscriptionByToken(
  userId: string,
  fcmToken: string
): Promise<void> {
  const db = getDb();
  await db.collection('alert_subscriptions').deleteOne({ userId, fcmToken });
}

export async function deleteAllAlertSubscriptionsForUser(userId: string): Promise<void> {
  const db = getDb();
  await db.collection('alert_subscriptions').deleteMany({ userId });
}

export async function getLatestAlertSubscriptionForUser(userId: string): Promise<AlertSubscription | null> {
  const db = getDb();
  const doc = await db
    .collection('alert_subscriptions')
    .findOne({ userId }, { sort: { updatedAt: -1, createdAt: -1 } });
  if (!doc) return null;
  return mapAlertSubscription(doc);
}

export async function getAlertSubscriptionByToken(
  userId: string,
  fcmToken: string
): Promise<AlertSubscription | null> {
  const db = getDb();
  const doc = await db.collection('alert_subscriptions').findOne({ userId, fcmToken });
  if (!doc) return null;
  return mapAlertSubscription(doc);
}

export async function findMatchingSubscriptions(
  whaleUsdSize: number,
  category: string
): Promise<AlertSubscription[]> {
  const db = getDb();
  const query: Record<string, any> = {
    minUsd: { $lte: whaleUsdSize },
    $or: [{ categories: { $size: 0 } }, { categories: category }],
  };

  if (whaleUsdSize < MEGA_MIN_USD) {
    query.megaOnly = false;
  }

  const docs = await db
    .collection('alert_subscriptions')
    .find(query)
    .toArray();

  return docs
    .map((doc) => mapAlertSubscription(doc))
    .filter((sub) => matchesSubscription(
      { usdSize: whaleUsdSize, marketCategory: category },
      sub
    ));
}

export async function updateLastNotified(subId: string): Promise<void> {
  const db = getDb();
  await db
    .collection('alert_subscriptions')
    .updateOne({ _id: new ObjectId(subId) }, { $set: { lastNotifiedAt: new Date() } });
}

export async function deleteSubscription(subId: string): Promise<void> {
  const db = getDb();
  await db.collection('alert_subscriptions').deleteOne({ _id: new ObjectId(subId) });
}

export async function tryInsertNotificationLog(
  whaleId: string,
  fcmToken: string
): Promise<boolean> {
  const db = getDb();
  try {
    await db.collection('notification_log').insertOne({
      whaleId,
      fcmToken,
      sentAt: new Date(),
      result: 'sent',
    });
    return true;
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 11000) {
      return false;
    }
    throw e;
  }
}

export async function markNotificationFailed(
  whaleId: string,
  fcmToken: string,
  errorCode: string
): Promise<void> {
  const db = getDb();
  await db.collection('notification_log').updateOne(
    { whaleId, fcmToken },
    { $set: { result: 'failed', errorCode } }
  );
}
