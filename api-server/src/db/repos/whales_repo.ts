import { ObjectId } from 'mongodb';
import { getDb } from '../mongo.js';
import type { WhaleDto, WhaleFilter, Cursor } from '../../shared/types.js';

export function toWhaleDto(doc: any): WhaleDto {
  const { raw, ...rest } = doc;
  return {
    id: doc._id.toString(),
    tier: doc.tier,
    side: doc.side,
    outcome: doc.outcome,
    usdSize: doc.usdSize,
    shares: doc.shares,
    priceCents: doc.priceCents,
    timestamp: doc.timestamp,
    market: doc.market,
    trader: doc.trader,
    transactionHash: doc.transactionHash,
    polymarketUrl: doc.polymarketUrl,
  };
}

export async function getWhales(
  filter: WhaleFilter,
  cursor?: Cursor,
  limit = 50
): Promise<{ items: WhaleDto[]; nextCursor: string | null }> {
  const db = getDb();
  const q: Record<string, unknown> = {};

  if (filter.minUsd != null) q.usdSize = { $gte: filter.minUsd };
  if (filter.maxUsd != null) q.usdSize = { ...(q.usdSize as object), $lte: filter.maxUsd };
  if (filter.tier) q.tier = filter.tier;
  if (filter.categories?.length) q['market.category'] = { $in: filter.categories };
  if (filter.side) q.side = filter.side;
  if (filter.marketSlug) q['market.slug'] = filter.marketSlug;
  if (filter.traderWallet) q['trader.proxyWallet'] = filter.traderWallet.toLowerCase();

  if (cursor) {
    q.$or = [
      { timestamp: { $lt: cursor.ts } },
      { timestamp: cursor.ts, _id: { $lt: cursor.id } },
    ];
  }

  const docs = await db
    .collection('trades')
    .find(q)
    .sort({ timestamp: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();

  const hasMore = docs.length > limit;
  const items = (hasMore ? docs.slice(0, limit) : docs).map(toWhaleDto);
  const nextCursor = hasMore
    ? Buffer.from(
        JSON.stringify({
          ts: items[items.length - 1]?.timestamp,
          id: items[items.length - 1]?.id,
        })
      ).toString('base64url')
    : null;

  return { items, nextCursor };
}

export async function getWhaleById(id: string): Promise<WhaleDto | null> {
  const db = getDb();
  const doc = await db.collection('trades').findOne({ _id: new ObjectId(id) });
  if (!doc) return null;

  const dto = toWhaleDto(doc);

  if (!dto.trader?.vol30d && dto.trader?.proxyWallet) {
    const trader = await db
      .collection('traders')
      .findOne({ proxyWallet: dto.trader.proxyWallet.toLowerCase() });
    if (trader) {
      dto.trader = {
        ...dto.trader,
        vol30d: trader.vol30d,
        winRate: trader.winRate,
        tradeCount: trader.tradeCount,
      };
    }
  }

  return dto;
}