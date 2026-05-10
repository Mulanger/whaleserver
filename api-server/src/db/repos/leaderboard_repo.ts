import { getDb } from '../mongo.js';
import { toWhaleDto, mergeOutcomesIntoDtos } from './whales_repo.js';
import { isUserFollowing } from './follows_repo.js';
import { getNewYorkWindow } from '../../shared/ny_session.js';
import {
  getTraderResolvedSummary,
  toTraderResolvedBlock,
  type TradeOutcomeDoc,
  type TraderResolvedFields,
} from './outcomes_repo.js';
import type { TraderResolved } from '../../shared/types.js';

export type LeaderboardWindow = '1d' | '7d' | '30d' | '365d';
export type LeaderboardSort = 'volume' | 'profit';

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

interface ProfitAggregateRow {
  _id: string;
  allTimeProfitUsd: number;
  allTimePnlTradeCount: number;
  resolvedWinCount: number;
  resolvedLossCount: number;
}

interface RecentFormAggregateRow {
  _id: string;
  statuses: Array<'resolved_win' | 'resolved_loss'>;
}

interface LeaderboardProfitSummary {
  allTimeProfitUsd: number;
  allTimeProfitKnown: boolean;
  allTimePnlTradeCount: number;
  recentFormResults: Array<'W' | 'L'>;
  recentFormWinRatePct: number | null;
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
  allTimeProfitUsd?: number | null;
  allTimeProfitKnown?: boolean;
  allTimePnlTradeCount?: number | null;
  recentFormResults?: Array<'W' | 'L'>;
  recentFormWinRatePct?: number | null;
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
  /**
   * Locked-in resolved-market stats from trade-resolver. Distinct from the
   * watcher-owned `winRate` on traders — see trade-resolver spec §14.3 for
   * the labelling guidance ("Resolved markets (locked)" vs "Polymarket
   * positions (live)"). Absent when the trader has no resolved BUY trades.
   */
  resolved?: TraderResolved;
}

const LEADERBOARD_CACHE_TTL_MS = 60_000;
const PROFILE_CACHE_TTL_MS = 30_000;
const RESOLVED_PROFILE_CACHE_TTL_MS = 60_000;
const MAX_CACHED_ROWS = 500;
const WHALE_USD_FLOOR = 10_000;

const leaderboardCache = new Map<LeaderboardWindow, LeaderboardCacheEntry>();
let profitLeaderboardCache: LeaderboardCacheEntry | null = null;
const traderProfileCache = new Map<string, { expiresAt: number; data: TraderProfile }>();
const traderResolvedCache = new Map<string, { expiresAt: number; data: TraderResolved | null }>();

const WINDOW_DAYS: Record<LeaderboardWindow, number> = {
  '1d': 1,
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

async function getCachedTraderResolvedSummary(walletInput: string): Promise<TraderResolved | null> {
  const wallet = walletInput.toLowerCase();
  const cached = traderResolvedCache.get(wallet);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const summary = await getTraderResolvedSummary(wallet).catch(() => null);
  traderResolvedCache.set(wallet, {
    data: summary,
    expiresAt: Date.now() + RESOLVED_PROFILE_CACHE_TTL_MS,
  });
  return summary;
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

function statusToResult(status: string): 'W' | 'L' | null {
  if (status === 'resolved_win') return 'W';
  if (status === 'resolved_loss') return 'L';
  return null;
}

function recentWinRatePct(results: Array<'W' | 'L'>): number | null {
  if (results.length === 0) return null;
  const wins = results.filter((result) => result === 'W').length;
  return (wins / results.length) * 100;
}

async function getLeaderboardProfitSummaries(wallets: string[]): Promise<Map<string, LeaderboardProfitSummary>> {
  const db = getDb();
  const normalizedWallets = Array.from(
    new Set(wallets.map((wallet) => wallet.toLowerCase()).filter(Boolean)),
  );
  if (normalizedWallets.length === 0) return new Map();

  const match = {
    proxyWallet: { $in: normalizedWallets },
    side: 'BUY',
    status: { $in: ['resolved_win', 'resolved_loss'] },
  };

  const [profitRows, recentRows] = await Promise.all([
    db.collection<TradeOutcomeDoc>('trade_outcomes').aggregate<ProfitAggregateRow>([
      { $match: match },
      {
        $group: {
          _id: '$proxyWallet',
          allTimeProfitUsd: { $sum: { $ifNull: ['$pnlUsd', 0] } },
          allTimePnlTradeCount: { $sum: 1 },
          resolvedWinCount: { $sum: { $cond: [{ $eq: ['$status', 'resolved_win'] }, 1, 0] } },
          resolvedLossCount: { $sum: { $cond: [{ $eq: ['$status', 'resolved_loss'] }, 1, 0] } },
        },
      },
    ], { allowDiskUse: true }).toArray(),
    db.collection<TradeOutcomeDoc>('trade_outcomes').aggregate<RecentFormAggregateRow>([
      { $match: match },
      { $sort: { proxyWallet: 1, resolvedAt: -1, timestamp: -1 } },
      {
        $group: {
          _id: '$proxyWallet',
          statuses: { $push: '$status' },
        },
      },
      {
        $project: {
          statuses: { $slice: ['$statuses', 5] },
        },
      },
    ], { allowDiskUse: true }).toArray(),
  ]);

  const summaries = new Map<string, LeaderboardProfitSummary>();

  for (const row of profitRows) {
    const wallet = row._id.toLowerCase();
    summaries.set(wallet, {
      allTimeProfitUsd: row.allTimeProfitUsd,
      allTimeProfitKnown: row.allTimePnlTradeCount > 0,
      allTimePnlTradeCount: row.allTimePnlTradeCount,
      recentFormResults: [],
      recentFormWinRatePct: null,
    });
  }

  for (const row of recentRows) {
    const wallet = row._id.toLowerCase();
    const results = row.statuses
      .map(statusToResult)
      .filter((result): result is 'W' | 'L' => Boolean(result));
    const existing = summaries.get(wallet);

    summaries.set(wallet, {
      allTimeProfitUsd: existing?.allTimeProfitUsd ?? 0,
      allTimeProfitKnown: existing?.allTimeProfitKnown ?? results.length > 0,
      allTimePnlTradeCount: existing?.allTimePnlTradeCount ?? results.length,
      recentFormResults: results,
      recentFormWinRatePct: recentWinRatePct(results),
    });
  }

  return summaries;
}

async function computeLeaderboard(window: LeaderboardWindow): Promise<LeaderboardCacheEntry> {
  const db = getDb();
  const session = getNewYorkWindow(WINDOW_DAYS[window]);

  const rows = await db.collection('trades').aggregate<LeaderboardAggregateRow>([
    {
      $match: {
        timestamp: { $gte: session.startTs, $lt: session.endTs },
        usdSize: { $gte: WHALE_USD_FLOOR },
        'trader.proxyWallet': { $type: 'string', $ne: '' },
      },
    },
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
    { $limit: MAX_CACHED_ROWS },
  ], { allowDiskUse: true }).toArray();

  const profitSummaries = await getLeaderboardProfitSummaries(rows.map((row) => row._id));

  const items: LeaderboardItem[] = rows.map((row, index) => {
    const profit = profitSummaries.get(row._id);
    return {
      rank: index + 1,
      proxyWallet: row._id,
      pseudonym: row.pseudonym ?? null,
      displayName: null,
      profileImage: null,
      volume: row.volume,
      tradeCount: row.tradeCount,
      whaleCount: row.whaleCount,
      topCategory: null,
      allTimeProfitUsd: profit?.allTimeProfitUsd ?? null,
      allTimeProfitKnown: profit?.allTimeProfitKnown ?? false,
      allTimePnlTradeCount: profit?.allTimePnlTradeCount ?? null,
      recentFormResults: profit?.recentFormResults ?? [],
      recentFormWinRatePct: profit?.recentFormWinRatePct ?? null,
    };
  });

  return {
    asOf: Math.floor(Date.now() / 1000),
    expiresAt: Date.now() + LEADERBOARD_CACHE_TTL_MS,
    items,
  };
}

async function computeProfitLeaderboard(): Promise<LeaderboardCacheEntry> {
  const db = getDb();
  const rows = await db.collection<TradeOutcomeDoc>('trade_outcomes').aggregate<ProfitAggregateRow>([
    {
      $match: {
        proxyWallet: { $type: 'string', $ne: '' },
        side: 'BUY',
        status: { $in: ['resolved_win', 'resolved_loss'] },
      },
    },
    {
      $group: {
        _id: { $toLower: '$proxyWallet' },
        allTimeProfitUsd: { $sum: { $ifNull: ['$pnlUsd', 0] } },
        allTimePnlTradeCount: { $sum: 1 },
        resolvedWinCount: { $sum: { $cond: [{ $eq: ['$status', 'resolved_win'] }, 1, 0] } },
        resolvedLossCount: { $sum: { $cond: [{ $eq: ['$status', 'resolved_loss'] }, 1, 0] } },
      },
    },
    { $sort: { allTimeProfitUsd: -1, _id: 1 } },
    { $limit: MAX_CACHED_ROWS },
  ], { allowDiskUse: true }).toArray();

  const profitSummaries = await getLeaderboardProfitSummaries(rows.map((row) => row._id));

  const items: LeaderboardItem[] = rows.map((row, index) => {
    const profit = profitSummaries.get(row._id);
    return {
      rank: index + 1,
      proxyWallet: row._id,
      pseudonym: null,
      displayName: null,
      profileImage: null,
      volume: 0,
      tradeCount: profit?.allTimePnlTradeCount ?? row.allTimePnlTradeCount,
      whaleCount: profit?.allTimePnlTradeCount ?? row.allTimePnlTradeCount,
      topCategory: null,
      allTimeProfitUsd: profit?.allTimeProfitUsd ?? row.allTimeProfitUsd,
      allTimeProfitKnown: profit?.allTimeProfitKnown ?? row.allTimePnlTradeCount > 0,
      allTimePnlTradeCount: profit?.allTimePnlTradeCount ?? row.allTimePnlTradeCount,
      recentFormResults: profit?.recentFormResults ?? [],
      recentFormWinRatePct: profit?.recentFormWinRatePct ?? null,
    };
  });

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

async function getProfitLeaderboardSnapshot(fresh = false): Promise<LeaderboardCacheEntry> {
  if (!fresh && profitLeaderboardCache && profitLeaderboardCache.expiresAt > Date.now()) {
    return profitLeaderboardCache;
  }

  const snapshot = await computeProfitLeaderboard();
  profitLeaderboardCache = snapshot;
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

export async function getLeaderboard(
  window: LeaderboardWindow,
  limit: number,
  cursor?: string,
  fresh = false,
  sort: LeaderboardSort = 'volume',
): Promise<LeaderboardPage> {
  const snapshot = sort === 'profit'
    ? await getProfitLeaderboardSnapshot(fresh)
    : await getLeaderboardSnapshot(window, fresh);
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
  const session = getNewYorkWindow(WINDOW_DAYS[window]);
  const row = await db.collection('trades').aggregate<TraderStatsWindow>([
    {
      $match: {
        timestamp: { $gte: session.startTs, $lt: session.endTs },
        usdSize: { $gte: WHALE_USD_FLOOR },
        $expr: { $eq: [{ $toLower: '$trader.proxyWallet' }, wallet] },
      },
    },
    {
      $group: {
        _id: null,
        volume: { $sum: '$usdSize' },
        tradeCount: { $sum: 1 },
        whaleCount: { $sum: 1 },
        buyVolume: { $sum: { $cond: [{ $eq: ['$side', 'BUY'] }, '$usdSize', 0] } },
        sellVolume: { $sum: { $cond: [{ $eq: ['$side', 'SELL'] }, '$usdSize', 0] } },
      },
    },
    { $project: { _id: 0, volume: 1, tradeCount: 1, whaleCount: 1, buyVolume: 1, sellVolume: 1 } },
  ]).next();

  return row ?? emptyStats();
}

async function getRankBadge(wallet: string): Promise<RankBadge | null> {
  let best: RankBadge | null = null;

  for (const window of ['1d', '7d', '30d', '365d'] as const) {
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

  const [stats1d, stats7d, stats30d, stats365d, dailyVolumeRows, recentWhaleDocs, latestTradeDoc, firstTradeDoc, rankBadge, following, traderDoc, resolvedSummary] = await Promise.all([
    aggregateWalletWindow(wallet, '1d'),
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
    // Resolver writes traders.resolved* fields keyed by _id = lowercase wallet.
    db.collection<TraderResolvedFields & { _id: string }>('traders').findOne({ _id: wallet }),
    getCachedTraderResolvedSummary(wallet),
  ]);

  if (!latestTradeDoc) {
    return null;
  }

  const recentWhales = await mergeOutcomesIntoDtos(recentWhaleDocs.map(toWhaleDto));
  const resolved = resolvedSummary ?? (traderDoc ? toTraderResolvedBlock(traderDoc) : null);

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
      '1d': stats1d,
      '7d': stats7d,
      '30d': stats30d,
      '365d': stats365d,
    },
    dailyVolume: dailyVolumeRows.map((row) => ({ date: row.date, volume: row.volume })),
    recentWhales,
    ...(typeof following === 'boolean' ? { isFollowing: following } : {}),
    ...(resolved ? { resolved } : {}),
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
