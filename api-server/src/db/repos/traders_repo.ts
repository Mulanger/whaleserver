import { getDb } from '../mongo.js';
import type { TraderDto, WhaleDto } from '../../shared/types.js';
import { toWhaleDto, mergeOutcomesIntoDtos } from './whales_repo.js';
import { toTraderResolvedBlock, type TraderResolvedFields } from './outcomes_repo.js';

export async function getTraderByWallet(wallet: string): Promise<TraderDto | null> {
  const db = getDb();
  // The trader doc lives in `traders` and is keyed by lowercase wallet (this is
  // the same shape the resolver writes its `resolved*` fields into).
  const doc = await db
    .collection('traders')
    .findOne({ proxyWallet: wallet.toLowerCase() });
  if (!doc) return null;

  const resolvedDoc = doc as unknown as TraderResolvedFields;
  const resolved = toTraderResolvedBlock(resolvedDoc);

  return {
    wallet: doc.proxyWallet,
    vol30d: doc.vol30d,
    winRate: doc.winRate,
    tradeCount: doc.tradeCount,
    lastActiveAt: doc.lastActiveAt,
    ...(resolved ? { resolved } : {}),
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

  return mergeOutcomesIntoDtos(docs.map(toWhaleDto));
}
