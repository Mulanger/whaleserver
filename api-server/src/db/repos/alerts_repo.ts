import { ObjectId } from 'mongodb';
import { getDb } from '../mongo.js';
import type { AlertSubscription } from '../../shared/types.js';

export async function upsertAlertSubscription(sub: {
  userId: string;
  fcmToken: string;
  platform: 'ios' | 'android';
  minUsd: number;
  megaOnly: boolean;
  categories: string[];
  quietHours?: { start: string; end: string; tz: string } | null;
}): Promise<void> {
  const db = getDb();
  await db.collection('alert_subscriptions').updateOne(
    { userId: sub.userId, fcmToken: sub.fcmToken },
    {
      $set: {
        platform: sub.platform,
        minUsd: sub.minUsd,
        megaOnly: sub.megaOnly,
        categories: sub.categories,
        quietHours: sub.quietHours ?? null,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

export async function deleteAlertSubscription(
  userId: string,
  fcmToken: string
): Promise<void> {
  const db = getDb();
  await db.collection('alert_subscriptions').deleteOne({ userId, fcmToken });
}

export async function getAlertSubscription(
  userId: string,
  fcmToken: string
): Promise<AlertSubscription | null> {
  const db = getDb();
  const doc = await db
    .collection('alert_subscriptions')
    .findOne({ userId, fcmToken });
  if (!doc) return null;

  return {
    _id: doc._id.toString(),
    userId: doc.userId,
    fcmToken: doc.fcmToken,
    platform: doc.platform,
    minUsd: doc.minUsd,
    megaOnly: doc.megaOnly,
    categories: doc.categories,
    quietHours: doc.quietHours,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastNotifiedAt: doc.lastNotifiedAt,
  };
}

export async function findMatchingSubscriptions(whaleUsdSize: number, category: string, tier: string): Promise<AlertSubscription[]> {
  const db = getDb();
  const docs = await db
    .collection('alert_subscriptions')
    .find({
      minUsd: { $lte: whaleUsdSize },
      $or: [
        { categories: { $size: 0 } },
        { categories: category },
      ],
    })
    .toArray();

  return docs
    .filter((s) => !s.megaOnly || tier === 'mega')
    .map((doc) => ({
      _id: doc._id.toString(),
      userId: doc.userId,
      fcmToken: doc.fcmToken,
      platform: doc.platform,
      minUsd: doc.minUsd,
      megaOnly: doc.megaOnly,
      categories: doc.categories,
      quietHours: doc.quietHours,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      lastNotifiedAt: doc.lastNotifiedAt,
    }));
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