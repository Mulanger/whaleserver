import { getDb } from '../mongo.js';
import type { TraderDto, WhaleDto } from '../../shared/types.js';
import { toWhaleDto } from './whales_repo.js';

export async function getTraderByWallet(wallet: string): Promise<TraderDto | null> {
  const db = getDb();
  const doc = await db
    .collection('traders')
    .findOne({ proxyWallet: wallet.toLowerCase() });
  if (!doc) return null;

  return {
    wallet: doc.proxyWallet,
    vol30d: doc.vol30d,
    winRate: doc.winRate,
    tradeCount: doc.tradeCount,
    lastActiveAt: doc.lastActiveAt,
  };
}

export async function getRecentWhalesForTrader(
  wallet: string,
  limit = 20
): Promise<WhaleDto[]> {
  const db = getDb();

  const docs = await db
    .collection('trades')
    .find({ 'trader.proxyWallet': wallet.toLowerCase() })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  return docs.map(toWhaleDto);
}
