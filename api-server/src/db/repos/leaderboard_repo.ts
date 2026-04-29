import { getDb } from '../mongo.js';
import { toWhaleDto } from './whales_repo.js';

export type LeaderboardWindow = '7d' | '30d' | '365d';

interface TraderDailyStatsDoc {
  _id: string;
  proxyWallet: string;
  pseudonym: string | null;
  date: string;
  volume: number;
  tradeCount: number;
  whaleCount: number;
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

interface TraderStatsWindow {
  volume: number;
  tradeCount: number;
  whaleCount: number;
}

export interface TraderProfile {
  proxyWallet: string;
  pseudonym: string | null;
  displayName: null;
  profileImage: null;
  stats: Record<LeaderboardWindow, TraderStatsWindow>;
  recentWhales: ReturnType<typeof toWhaleDto>[];
  dailyVolume: Array<{ date: string; volume: number }>;
}

const CACHE_TTL_MS = 60_000;
const MAX_CACHED_ROWS = 500;

const leaderboardCache = new Map<LeaderboardWindow, LeaderboardCacheEntry>();

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
    expiresAt: Date.now() + CACHE_TTL_MS,
    items,
  };
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
  const cached = leaderboardCache.get(window);
  const hasValidCache = cached && cached.expiresAt > Date.now();

  const snapshot = !fresh && hasValidCache
    ? cached
    : await computeLeaderboard(window);

  if (!hasValidCache || fresh) {
    leaderboardCache.set(window, snapshot);
  }

  return paginateLeaderboard(snapshot, limit, cursor);
}

function emptyStats(): TraderStatsWindow {
  return { volume: 0, tradeCount: 0, whaleCount: 0 };
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
      },
    },
    { $project: { _id: 0, volume: 1, tradeCount: 1, whaleCount: 1 } },
  ]).next();

  return row ?? emptyStats();
}

export async function getTraderProfile(walletInput: string): Promise<TraderProfile | null> {
  const wallet = walletInput.toLowerCase();
  const db = getDb();
  const dailyStartDate = startDateForWindow(30);

  const [latestStats, stats7d, stats30d, stats365d, dailyVolumeRows, whaleDocs] = await Promise.all([
    db.collection<TraderDailyStatsDoc>('trader_daily_stats')
      .find({ proxyWallet: wallet })
      .sort({ date: -1 })
      .limit(1)
      .next(),
    aggregateWalletWindow(wallet, '7d'),
    aggregateWalletWindow(wallet, '30d'),
    aggregateWalletWindow(wallet, '365d'),
    db.collection<TraderDailyStatsDoc>('trader_daily_stats')
      .find(
        { proxyWallet: wallet, date: { $gte: dailyStartDate } },
        { projection: { _id: 0, date: 1, volume: 1 } },
      )
      .sort({ date: 1 })
      .toArray(),
    db.collection('trades')
      .find({ 'trader.proxyWallet': wallet })
      .sort({ timestamp: -1 })
      .limit(20)
      .toArray(),
  ]);

  if (!latestStats && whaleDocs.length === 0) {
    return null;
  }

  const whalePseudonym = whaleDocs.find((doc) => typeof doc?.trader?.pseudonym === 'string')?.trader?.pseudonym ?? null;

  return {
    proxyWallet: wallet,
    pseudonym: latestStats?.pseudonym ?? whalePseudonym,
    displayName: null,
    profileImage: null,
    stats: {
      '7d': stats7d,
      '30d': stats30d,
      '365d': stats365d,
    },
    recentWhales: whaleDocs.map(toWhaleDto),
    dailyVolume: dailyVolumeRows.map((row) => ({ date: row.date, volume: row.volume })),
  };
}
