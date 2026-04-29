import { getDb } from '../mongo.js';

interface TraderFollowDoc {
  userId: string;
  proxyWallet: string;
  createdAt: Date;
}

export async function isUserFollowing(userId: string, proxyWallet: string): Promise<boolean> {
  const db = getDb();
  const doc = await db.collection<TraderFollowDoc>('trader_follows').findOne(
    { userId, proxyWallet: proxyWallet.toLowerCase() },
    { projection: { _id: 1 } },
  );
  return doc != null;
}

export async function followTrader(userId: string, proxyWallet: string): Promise<void> {
  const db = getDb();
  const wallet = proxyWallet.toLowerCase();
  await db.collection<TraderFollowDoc>('trader_follows').updateOne(
    { userId, proxyWallet: wallet },
    { $setOnInsert: { userId, proxyWallet: wallet, createdAt: new Date() } },
    { upsert: true },
  );
}

export async function unfollowTrader(userId: string, proxyWallet: string): Promise<void> {
  const db = getDb();
  await db.collection<TraderFollowDoc>('trader_follows').deleteOne({
    userId,
    proxyWallet: proxyWallet.toLowerCase(),
  });
}

export async function getFollowedWallets(userId: string, limit = 500): Promise<string[]> {
  const db = getDb();
  const docs = await db.collection<TraderFollowDoc>('trader_follows')
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({ _id: 0, proxyWallet: 1 })
    .toArray();

  return docs.map((doc) => doc.proxyWallet);
}

export async function listFollowsWithCreatedAt(userId: string, limit = 500): Promise<Array<{ proxyWallet: string; createdAt: Date }>> {
  const db = getDb();
  const docs = await db.collection<TraderFollowDoc>('trader_follows')
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({ _id: 0, proxyWallet: 1, createdAt: 1 })
    .toArray();

  return docs.map((doc) => ({ proxyWallet: doc.proxyWallet, createdAt: doc.createdAt }));
}
