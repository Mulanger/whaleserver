import { ObjectId } from 'mongodb';
import { getDb } from '../mongo.js';
import type { WhaleDto, WhaleFilter, Cursor } from '../../shared/types.js';
import { resolvePriceMillicents } from '../../shared/whale_price.js';
import { getNewYorkWindow } from '../../shared/ny_session.js';

const WHALE_USD_FLOOR = 10_000;

export function toWhaleDto(doc: any): WhaleDto {
  return {
    id: doc._id.toString(),
    tier: doc.tier,
    side: doc.side,
    outcome: doc.outcome,
    usdSize: doc.usdSize,
    shares: doc.shares,
    priceCents: doc.priceCents,
    priceMillicents: resolvePriceMillicents(doc),
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
  if (filter.traderWallets?.length) {
    q['trader.proxyWallet'] = { $in: filter.traderWallets.map((wallet) => wallet.toLowerCase()) };
  }

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

function explorerUrl(transactionHash?: string): string | null {
  return transactionHash ? `https://polygonscan.com/tx/${transactionHash}` : null;
}

function otherOutcome(outcome?: string): string {
  const normalized = String(outcome || '').trim().toUpperCase();
  if (normalized === 'YES') return 'NO';
  if (normalized === 'NO') return 'YES';
  return normalized ? `NOT ${normalized}` : 'OTHER';
}

function buildScenario(doc: any) {
  const side = doc.side === 'SELL' ? 'SELL' : 'BUY';
  const outcome = String(doc.outcome || 'YES').trim() || 'YES';
  const usdSize = Number(doc.usdSize || 0);
  const shares = Number(doc.shares || 0);
  const priceMillicents = resolvePriceMillicents(doc);
  const impliedProbability = Number((priceMillicents / 100).toFixed(2));

  if (side === 'SELL') {
    return {
      mode: 'sell',
      payoutLabel: 'SALE PROCEEDS',
      payoutIfWin: usdSize,
      payoutDelta: 'Position reduced',
      lossLabel: 'SHARES SOLD',
      lossIfLose: shares,
      lossDelta: null,
      probabilityLabel: 'IMPLIED PROBABILITY',
      impliedProbability,
      probabilityDelta: null,
    };
  }

  const payout = shares;
  const profit = payout - usdSize;
  const profitPct = usdSize > 0 ? (profit / usdSize) * 100 : 0;

  return {
    mode: 'buy',
    payoutLabel: `IF ${outcome} PAYOUT`,
    payoutIfWin: payout,
    payoutDelta: `${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(0)} (${profitPct >= 0 ? '+' : '-'}${Math.abs(profitPct).toFixed(1)}%)`,
    lossLabel: `IF ${otherOutcome(outcome)} LOSS`,
    lossIfLose: usdSize,
    lossDelta: '-100%',
    probabilityLabel: 'IMPLIED PROBABILITY',
    impliedProbability,
    probabilityDelta: null,
  };
}

function marketMatchFor(doc: any): Record<string, unknown> | null {
  const conditionId = doc.market?.conditionId;
  const slug = doc.market?.slug;
  const title = doc.market?.title;
  if (conditionId) return { 'market.conditionId': conditionId };
  if (slug) return { 'market.slug': slug };
  if (title) return { 'market.title': title };
  return null;
}

function resolveDocPriceCents(doc: any): number {
  return Number((resolvePriceMillicents(doc) / 100).toFixed(2));
}

function buildPriceHistory(docs: any[], currentId: string) {
  const sorted = [...docs].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  const points = sorted
    .map((doc) => ({
      id: doc._id?.toString?.() ?? String(doc._id),
      timestamp: Number(doc.timestamp || 0),
      price: resolveDocPriceCents(doc),
      yesPrice: doc.market?.yesPriceCents ?? null,
      noPrice: doc.market?.noPriceCents ?? null,
    }))
    .filter((point) => Number.isFinite(point.price));

  const tradeIndex = Math.max(0, points.findIndex((point) => point.id === currentId));
  const first = points[0];
  const last = points[points.length - 1];

  return {
    source: 'same_market_trades',
    points,
    tradeIndex: tradeIndex === -1 ? 0 : tradeIndex,
    yesChange24hCents:
      first?.yesPrice != null && last?.yesPrice != null
        ? Number((Number(last.yesPrice) - Number(first.yesPrice)).toFixed(2))
        : null,
    noChange24hCents:
      first?.noPrice != null && last?.noPrice != null
        ? Number((Number(last.noPrice) - Number(first.noPrice)).toFixed(2))
        : null,
  };
}

async function getTraderOneDayStats(wallet: string | undefined) {
  if (!wallet) {
    return {
      volume1d: 0,
      rank1d: null,
      tradeCount1d: 0,
    };
  }

  const db = getDb();
  const session = getNewYorkWindow(1);
  const rows = await db.collection('trades').aggregate<{
    _id: string;
    volume: number;
    tradeCount: number;
  }>([
    {
      $match: {
        timestamp: { $gte: session.startTs, $lt: session.endTs },
        usdSize: { $gte: WHALE_USD_FLOOR },
        'trader.proxyWallet': { $type: 'string', $ne: '' },
      },
    },
    {
      $group: {
        _id: { $toLower: '$trader.proxyWallet' },
        volume: { $sum: '$usdSize' },
        tradeCount: { $sum: 1 },
      },
    },
    { $sort: { volume: -1, _id: 1 } },
    { $limit: 500 },
  ]).toArray();

  const normalizedWallet = wallet.toLowerCase();
  const index = rows.findIndex((row) => row._id === normalizedWallet);
  const row = index >= 0 ? rows[index] : null;

  return {
    volume1d: row?.volume ?? 0,
    rank1d: index >= 0 ? index + 1 : null,
    tradeCount1d: row?.tradeCount ?? 0,
  };
}

export async function getWhaleDetailById(id: string) {
  const db = getDb();
  if (!ObjectId.isValid(id)) return null;

  const doc = await db.collection('trades').findOne({ _id: new ObjectId(id) });
  if (!doc) return null;

  const trade = toWhaleDto(doc);
  const match = marketMatchFor(doc);
  const session = getNewYorkWindow(1);
  const wallet = trade.trader?.proxyWallet?.toLowerCase();

  const [relatedDocs, historyDocs, recentTraderDocs, traderStats] = await Promise.all([
    match
      ? db.collection('trades')
          .find({
            ...match,
            timestamp: { $gte: session.startTs, $lt: session.endTs },
            usdSize: { $gte: WHALE_USD_FLOOR },
            _id: { $ne: doc._id },
          })
          .sort({ timestamp: -1, _id: -1 })
          .limit(50)
          .toArray()
      : Promise.resolve([]),
    match
      ? db.collection('trades')
          .find({
            ...match,
            timestamp: { $gte: Math.max(session.startTs, trade.timestamp - 24 * 60 * 60), $lte: Math.floor(Date.now() / 1000) },
          })
          .sort({ timestamp: -1, _id: -1 })
          .limit(80)
          .toArray()
      : Promise.resolve([doc]),
    wallet
      ? db.collection('trades')
          .find({ 'trader.proxyWallet': wallet })
          .sort({ timestamp: -1, _id: -1 })
          .limit(5)
          .toArray()
      : Promise.resolve([]),
    getTraderOneDayStats(wallet),
  ]);

  const relatedTrades = [doc, ...relatedDocs].map(toWhaleDto);
  const historySource = historyDocs.some((historyDoc) => historyDoc._id?.toString?.() === id)
    ? historyDocs
    : [doc, ...historyDocs];

  return {
    trade,
    market: {
      ...(trade.market || {}),
      yesPriceCents: doc.market?.yesPriceCents ?? null,
      noPriceCents: doc.market?.noPriceCents ?? null,
      polymarketUrl: trade.polymarketUrl || doc.market?.polymarketUrl || null,
      priceHistory: buildPriceHistory(historySource, trade.id),
    },
    trader: {
      ...(trade.trader || {}),
      proxyWallet: wallet ?? trade.trader?.proxyWallet ?? null,
      volume1d: traderStats.volume1d,
      rank1d: traderStats.rank1d,
      tradeCount1d: traderStats.tradeCount1d,
      recentTrades: recentTraderDocs.map(toWhaleDto),
    },
    relatedTrades,
    scenario: buildScenario(doc),
    onChain: {
      transactionHash: trade.transactionHash,
      explorerUrl: explorerUrl(trade.transactionHash),
    },
  };
}
