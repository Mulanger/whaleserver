import { getDb } from '../db/mongo.js';
import type { User } from '../shared/types.js';

export async function findOrCreateUser(
  deviceId: string,
  platform: 'ios' | 'android'
): Promise<{ user: User; created: boolean }> {
  const db = getDb();
  const userId = `anon_${deviceId}`;
  const existing = await db.collection('users').findOne({ _id: userId });

  if (existing) {
    await db
      .collection('users')
      .updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } });
    return {
      user: {
        _id: existing._id,
        type: existing.type,
        platform: existing.platform,
        createdAt: existing.createdAt,
        lastSeenAt: new Date(),
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