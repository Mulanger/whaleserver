import type { Document } from 'mongodb';
import { getDb } from '../mongo.js';
import { toWhaleDto } from './whales_repo.js';
import { getCurrentNewYorkSession, type NewYorkSession } from '../../shared/ny_session.js';
import type { WhaleDto } from '../../shared/types.js';

export interface DashboardFilter {
  minUsd?: number;
  maxUsd?: number;
  side?: 'BUY' | 'SELL';
  categories?: string[];
}

export interface DashboardLeaderboardItem {
  rank: number;
  proxyWallet: string;
  pseudonym: string | null;
  displayName: null;
  profileImage: null;
  volume: number;
  tradeCount: number;
  whaleCount: number;
  topCategory: null;
}

export interface DashboardTodayStats {
  volumeUsd: number;
  tradeCount: number;
  activeWhales: number;
  megaTrades: number;
  biggestTrade: WhaleDto | null;
}

export interface DashboardLast60mStats {
  volumeUsd: number;
  tradeCount: number;
  bucketCount: number;
  startTs: number;
  endTs: number;
  buckets: number[];
}

export interface DashboardTodaySnapshot {
  asOf: number;
  session: NewYorkSession;
  today: DashboardTodayStats;
  last60m: DashboardLast60mStats;
  leaderboard: DashboardLeaderboardItem[];
  items: WhaleDto[];
  nextCursor: string | null;
}

interface DashboardCacheEntry {
  expiresAt: number;
  data: DashboardTodaySnapshot;
}

const DASHBOARD_CACHE_TTL_MS = 15_000;
const MAX_RECENT_LIMIT = 100;
const DEFAULT_MIN_USD = 10_000;
const dashboardCache = new Map<string, DashboardCacheEntry>();

function buildMatch(filter: DashboardFilter, startTs: number, endTs: number): Document {
  const usdSize: Record<string, number> = { $gte: filter.minUsd ?? DEFAULT_MIN_USD };
  if (filter.maxUsd != null) usdSize.$lte = filter.maxUsd;

  const match: Document = {
    timestamp: { $gte: startTs, $lt: endTs },
    usdSize,
  };

  if (filter.side) match.side = filter.side;
  if (filter.categories?.length) match['market.category'] = { $in: filter.categories };

  return match;
}

function buildWalletMatch(filter: DashboardFilter, startTs: number, endTs: number): Document {
  return {
    ...buildMatch(filter, startTs, endTs),
    'trader.proxyWallet': { $type: 'string', $ne: '' },
  };
}

function encodeCursor(ts: number | undefined, id: string | undefined): string | null {
  if (!ts || !id) return null;
  return Buffer.from(JSON.stringify({ ts, id })).toString('base64url');
}

function cacheKey(filter: DashboardFilter, recentLimit: number, leaderboardLimit: number, dateKey: string): string {
  return JSON.stringify({
    dateKey,
    minUsd: filter.minUsd ?? DEFAULT_MIN_USD,
    maxUsd: filter.maxUsd ?? null,
    side: filter.side ?? null,
    categories: filter.categories ?? [],
    recentLimit,
    leaderboardLimit,
  });
}

function buildLast60Buckets(docs: Document[], nowTs: number, sessionStartTs: number): DashboardLast60mStats {
  const bucketCount = 14;
  const startTs = Math.max(sessionStartTs, nowTs - 3600);
  const endTs = nowTs;
  const duration = Math.max(1, endTs - startTs);
  const secondsPerBucket = duration / bucketCount;
  const buckets = Array.from({ length: bucketCount }, () => 0);
  let volumeUsd = 0;
  let tradeCount = 0;

  docs.forEach((doc) => {
    const timestamp = Number(doc.timestamp || 0);
    const usdSize = Number(doc.usdSize || 0);
    if (timestamp < startTs || timestamp > endTs) return;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((timestamp - startTs) / secondsPerBucket)));
    buckets[index] = (buckets[index] ?? 0) + usdSize;
    volumeUsd += usdSize;
    tradeCount += 1;
  });

  return {
    volumeUsd,
    tradeCount,
    bucketCount,
    startTs,
    endTs,
    buckets,
  };
}

export async function getTodayDashboard(
  filter: DashboardFilter,
  options: { recentLimit?: number; leaderboardLimit?: number; fresh?: boolean } = {}
): Promise<DashboardTodaySnapshot> {
  const recentLimit = Math.min(MAX_RECENT_LIMIT, Math.max(1, options.recentLimit ?? MAX_RECENT_LIMIT));
  const leaderboardLimit = Math.min(100, Math.max(1, options.leaderboardLimit ?? 50));
  const nowTs = Math.floor(Date.now() / 1000);
  const session = getCurrentNewYorkSession();
  const key = cacheKey(filter, recentLimit, leaderboardLimit, session.dateKey);
  const cached = dashboardCache.get(key);

  if (!options.fresh && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const db = getDb();
  const match = buildMatch(filter, session.startTs, session.endTs);
  const walletMatch = buildWalletMatch(filter, session.startTs, session.endTs);
  const last60Match = buildMatch(filter, Math.max(session.startTs, nowTs - 3600), nowTs + 1);

  const [todayRow, biggestTradeDoc, recentDocs, leaderboardRows, last60Docs] = await Promise.all([
    db.collection('trades').aggregate<{
      _id: null;
      volumeUsd: number;
      tradeCount: number;
      activeWallets: string[];
      megaTrades: number;
    }>([
      { $match: walletMatch },
      {
        $group: {
          _id: null,
          volumeUsd: { $sum: '$usdSize' },
          tradeCount: { $sum: 1 },
          activeWallets: { $addToSet: { $toLower: '$trader.proxyWallet' } },
          megaTrades: {
            $sum: {
              $cond: [
                { $or: [{ $eq: ['$tier', 'mega'] }, { $gte: ['$usdSize', 250000] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]).next(),
    db.collection('trades').findOne(match, { sort: { usdSize: -1, timestamp: -1 } }),
    db.collection('trades')
      .find(match)
      .sort({ timestamp: -1, _id: -1 })
      .limit(recentLimit + 1)
      .toArray(),
    db.collection('trades').aggregate<{
      _id: string;
      pseudonym: string | null;
      volume: number;
      tradeCount: number;
      whaleCount: number;
    }>([
      { $match: walletMatch },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: { $toLower: '$trader.proxyWallet' },
          pseudonym: { $last: '$trader.pseudonym' },
          volume: { $sum: '$usdSize' },
          tradeCount: { $sum: 1 },
          whaleCount: { $sum: 1 },
        },
      },
      { $sort: { volume: -1, _id: 1 } },
      { $limit: leaderboardLimit },
    ]).toArray(),
    db.collection('trades')
      .find(last60Match)
      .project({ timestamp: 1, usdSize: 1 })
      .toArray(),
  ]);

  const hasMore = recentDocs.length > recentLimit;
  const visibleRecentDocs = hasMore ? recentDocs.slice(0, recentLimit) : recentDocs;
  const items = visibleRecentDocs.map(toWhaleDto);
  const lastItem = items[items.length - 1];

  const data: DashboardTodaySnapshot = {
    asOf: nowTs,
    session,
    today: {
      volumeUsd: todayRow?.volumeUsd ?? 0,
      tradeCount: todayRow?.tradeCount ?? 0,
      activeWhales: todayRow?.activeWallets?.filter(Boolean).length ?? 0,
      megaTrades: todayRow?.megaTrades ?? 0,
      biggestTrade: biggestTradeDoc ? toWhaleDto(biggestTradeDoc) : null,
    },
    last60m: buildLast60Buckets(last60Docs, nowTs, session.startTs),
    leaderboard: leaderboardRows.map((row, index) => ({
      rank: index + 1,
      proxyWallet: row._id,
      pseudonym: row.pseudonym ?? null,
      displayName: null,
      profileImage: null,
      volume: row.volume,
      tradeCount: row.tradeCount,
      whaleCount: row.whaleCount,
      topCategory: null,
    })),
    items,
    nextCursor: hasMore ? encodeCursor(lastItem?.timestamp, lastItem?.id) : null,
  };

  dashboardCache.set(key, {
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
    data,
  });

  return data;
}
