import { getDb } from '../mongo.js';
import { toWhaleDto } from './whales_repo.js';
import { isUserFollowing } from './follows_repo.js';

export type LeaderboardWindow = '7d' | '30d' | '365d';

interface TraderDailyStatsDoc {
  _id: string;
  proxyWallet: string;
  pseudonym: string | null;
  date: string;
  volume: number;
  tradeCount: number;
  whaleCount: number;
  buyVolume?: number;
  sellVolume?: number;
}

interface LeaderboardAggregateRow {
  _id: string;
  pseudonym: string | null;
  volume: number;
  tradeCount: number;
  whaleCount: number;
}

interface LeaderboardCacheEntry {
  asOf: number;
  expiresAt: number;
  items: LeaderboardItem[];
}

export interface LeaderboardItem {
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

export interface LeaderboardPage {
  asOf: number;
  items: LeaderboardItem[];
  nextCursor: string | null;
}

export interface TraderStatsWindow {
  volume: number;
  tradeCount: number;
  whaleCount: number;
  buyVolume: number;
  sellVolume: number;
}

interface RankBadge {
  window: LeaderboardWindow;
  rank: number;
}

export interface TraderProfile {
  proxyWallet: string;
  shortAddress: string;
  pseudonym: string | null;
  displayName: string | null;
  profileImage: string | null;
  bio: null;
  firstSeen: number;
  rankBadge: RankBadge | null;
  stats: Record<LeaderboardWindow, TraderStatsWindow>;
  dailyVolume: Array<{ date: string; volume: number }>;
  recentWhales: ReturnType<typeof toWhaleDto>[];
  isFollowing?: boolean;
}

const LEADERBOARD_CACHE_TTL_MS = 60_000;
const PROFILE_CACHE_TTL_MS = 30_000;
const MAX_CACHED_ROWS = 500;

const leaderboardCache = new Map<LeaderboardWindow, LeaderboardCacheEntry>();
const traderProfileCache = new Map<string, { expiresAt: number; data: TraderProfile }>();

const WINDOW_DAYS: Record<LeaderboardWindow, number> = {
  '7d': 7,
  '30d': 30,
  '365d': 365,
};

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startDateForWindow(days: number): string {
  const utcToday = new Date();
  utcToday.setUTCHours(0, 0, 0, 0);
  utcToday.setUTCDate(utcToday.getUTCDate() - (days - 1));
  return formatUtcDate(utcToday);
}

function encodeCursorOffset(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

function decodeCursorOffset(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf-8');
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function shortAddress(wallet: string): string {
  return `${wallet.slice(0, 6)}..${wallet.slice(-4)}`;
}

async function computeLeaderboard(window: LeaderboardWindow): Promise<LeaderboardCacheEntry> {
  const db = getDb();
  const startDate = startDateForWindow(WINDOW_DAYS[window]);

  const rows = await db.collection<TraderDailyStatsDoc>('trader_daily_stats').aggregate<LeaderboardAggregateRow>([
    { $match: { date: { $gte: startDate } } },
    { $sort: { date: 1 } },
    {
      $group: {
        _id: '$proxyWallet',
        pseudonym: { $last: '$pseudonym' },
        volume: { $sum: '$volume' },
        tradeCount: { $sum: '$tradeCount' },
        whaleCount: { $sum: '$whaleCount' },
      },
    },
    { $sort: { volume: -1 } },
    { $limit: MAX_CACHED_ROWS },
  ]).toArray();

  const items: LeaderboardItem[] = rows.map((row, index) => ({
    rank: index + 1,
    proxyWallet: row._id,
    pseudonym: row.pseudonym ?? null,
    displayName: null,
    profileImage: null,
    volume: row.volume,
    tradeCount: row.tradeCount,
    whaleCount: row.whaleCount,
    topCategory: null,
  }));

  return {
    asOf: Math.floor(Date.now() / 1000),
    expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS,
    items,
  };
}

async function getLeaderboardSnapshot(window: LeaderboardWindow, fresh = false): Promise<LeaderboardCacheEntry> {
  const cached = leaderboardCache.get(window);
  if (!fresh && cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const snapshot = await computeLeaderboard(window);
  leaderboardCache.set(window, snapshot);
  return snapshot;
}

function paginateLeaderboard(snapshot: LeaderboardCacheEntry, limit: number, cursor?: string): LeaderboardPage {
  const offset = decodeCursorOffset(cursor);
  const slice = snapshot.items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const nextCursor = nextOffset < snapshot.items.length ? encodeCursorOffset(nextOffset) : null;

  return {
    asOf: snapshot.asOf,
    items: slice,
    nextCursor,
  };
}

export async function getLeaderboard(window: LeaderboardWindow, limit: number, cursor?: string, fresh = false): Promise<LeaderboardPage> {
  const snapshot = await getLeaderboardSnapshot(window, fresh);
  return paginateLeaderboard(snapshot, limit, cursor);
}

function emptyStats(): TraderStatsWindow {
  return {
    volume: 0,
    tradeCount: 0,
    whaleCount: 0,
    buyVolume: 0,
    sellVolume: 0,
  };
}

async function aggregateWalletWindow(wallet: string, window: LeaderboardWindow): Promise<TraderStatsWindow> {
  const db = getDb();
  const startDate = startDateForWindow(WINDOW_DAYS[window]);
  const row = await db.collection<TraderDailyStatsDoc>('trader_daily_stats').aggregate<TraderStatsWindow>([
    { $match: { proxyWallet: wallet, date: { $gte: startDate } } },
    {
      $group: {
        _id: null,
        volume: { $sum: '$volume' },
        tradeCount: { $sum: '$tradeCount' },
        whaleCount: { $sum: '$whaleCount' },
        buyVolume: { $sum: '$buyVolume' },
        sellVolume: { $sum: '$sellVolume' },
      },
    },
    { $project: { _id: 0, volume: 1, tradeCount: 1, whaleCount: 1, buyVolume: 1, sellVolume: 1 } },
  ]).next();

  return row ?? emptyStats();
}

async function getRankBadge(wallet: string): Promise<RankBadge | null> {
  let best: RankBadge | null = null;

  for (const window of ['7d', '30d', '365d'] as const) {
    const snapshot = await getLeaderboardSnapshot(window);
    const found = snapshot.items.find((item) => item.proxyWallet === wallet);
    if (!found || found.rank > 100) continue;

    if (!best || found.rank < best.rank) {
      best = { window, rank: found.rank };
    }
  }

  return best;
}

async function loadTraderProfile(wallet: string, currentUserId?: string): Promise<TraderProfile | null> {
  const db = getDb();
  const dailyStartDate = startDateForWindow(30);

  const [stats7d, stats30d, stats365d, dailyVolumeRows, recentWhaleDocs, latestTradeDoc, firstTradeDoc, rankBadge, following] = await Promise.all([
    aggregateWalletWindow(wallet, '7d'),
    aggregateWalletWindow(wallet, '30d'),
    aggregateWalletWindow(wallet, '365d'),
    db.collection<TraderDailyStatsDoc>('trader_daily_stats')
      .find({ proxyWallet: wallet, date: { $gte: dailyStartDate } }, { projection: { _id: 0, date: 1, volume: 1 } })
      .sort({ date: 1 })
      .toArray(),
    db.collection('trades')
      .find({ 'trader.proxyWallet': wallet })
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray(),
    db.collection('trades').findOne(
      { 'trader.proxyWallet': wallet },
      { sort: { timestamp: -1 } },
    ),
    db.collection('trades').findOne(
      { 'trader.proxyWallet': wallet },
      { sort: { timestamp: 1 }, projection: { timestamp: 1 } },
    ),
    getRankBadge(wallet),
    currentUserId ? isUserFollowing(currentUserId, wallet) : Promise.resolve(undefined),
  ]);

  if (!latestTradeDoc) {
    return null;
  }

  return {
    proxyWallet: wallet,
    shortAddress: shortAddress(wallet),
    pseudonym: latestTradeDoc.trader?.pseudonym ?? null,
    displayName: latestTradeDoc.trader?.displayName ?? null,
    profileImage: latestTradeDoc.trader?.profileImage ?? null,
    bio: null,
    firstSeen: firstTradeDoc?.timestamp ?? latestTradeDoc.timestamp,
    rankBadge,
    stats: {
      '7d': stats7d,
      '30d': stats30d,
      '365d': stats365d,
    },
    dailyVolume: dailyVolumeRows.map((row) => ({ date: row.date, volume: row.volume })),
    recentWhales: recentWhaleDocs.map(toWhaleDto),
    ...(typeof following === 'boolean' ? { isFollowing: following } : {}),
  };
}

export async function getCachedTraderProfile(walletInput: string, currentUserId?: string): Promise<TraderProfile | null> {
  const wallet = walletInput.toLowerCase();
  const cacheKey = `${wallet}:${currentUserId ?? 'anon'}`;
  const cached = traderProfileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const profile = await loadTraderProfile(wallet, currentUserId);
  if (!profile) {
    return null;
  }

  traderProfileCache.set(cacheKey, { data: profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
  return profile;
}

export function invalidateTraderProfileCache(walletInput: string, userId: string): void {
  const wallet = walletInput.toLowerCase();
  const key = `${wallet}:${userId}`;
  traderProfileCache.delete(key);
}
