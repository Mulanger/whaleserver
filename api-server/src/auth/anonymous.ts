import { getDb } from '../db/mongo.js';
import type { User, MobilePlatform } from '../shared/types.js';

export async function findOrCreateUser(
  deviceId: string,
  platform: MobilePlatform
): Promise<{ user: User; created: boolean }> {
  const db = getDb();
  const userId = `anon_${deviceId}`;
  const existing = await db.collection('users').findOne({ _id: userId });

  if (existing) {
    const existingPlatform = (existing.platform as MobilePlatform | undefined) ?? 'unknown';
    const nextPlatform: MobilePlatform =
      platform !== 'unknown' ? platform : existingPlatform;
    const lastSeenAt = new Date();
    await db
      .collection('users')
      .updateOne({ _id: userId }, { $set: { lastSeenAt, platform: nextPlatform } });
    return {
      user: {
        _id: existing._id,
        type: existing.type,
        platform: nextPlatform,
        createdAt: existing.createdAt,
        lastSeenAt,
      },
      created: false,
    };
  }

  const now = new Date();
  const user: User = {
    _id: userId,
    type: 'anonymous',
    platform,
    createdAt: now,
    lastSeenAt: now,
  };

  await db.collection('users').insertOne(user);
  return { user, created: true };
}
