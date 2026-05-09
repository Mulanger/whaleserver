/**
 * outcomes_repo — read-only access to the trade-resolver's collections.
 *
 * The trade-resolver service (D:\Resolution-tracker) is the SINGLE WRITER for:
 *   - market_resolutions  (1 doc per tracked market)
 *   - trade_outcomes      (1 doc per materialized trade; _id matches trades._id)
 *
 * The API server only reads these collections and joins them into the existing
 * WhaleDto / TraderDto shapes. Never write to them from this process.
 *
 * See trade-resolver spec §14 for the contract.
 */
import { getDb } from '../mongo.js';

// ---------------------------------------------------------------------------
// Types (mirror trade-resolver's db/outcomes.ts shape)
// ---------------------------------------------------------------------------

export type MarketResolutionStatus = 'tracking' | 'closed' | 'resolved' | 'invalid';
export type TradeOutcomeStatus = 'open' | 'resolved_win' | 'resolved_loss' | 'invalid';

export interface MarketResolutionDoc {
  _id: string;
  slug: string;
  title: string;
  status: MarketResolutionStatus;
  endDate: Date | null;
  closedAt: Date | null;
  resolvedAt: Date | null;
  winningOutcome: 'YES' | 'NO' | null;
  winningOutcomeIndex: number | null;
  finalYesPriceCents: number | null;
  finalNoPriceCents: number | null;
  umaResolutionStatus: string | null;
  negRisk: boolean;
  clobTokenIds: string[] | null;
  lastCheckedAt: Date;
  checkCount: number;
  nextCheckAt: Date;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TradeOutcomeDoc {
  _id: string;
  conditionId: string;
  proxyWallet: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  outcomeIndex: number;
  shares: number;
  usdSize: number;
  entryPriceCents: number;
  timestamp: number;
  status: TradeOutcomeStatus;
  winningOutcome: 'YES' | 'NO' | null;
  winningOutcomeIndex: number | null;
  payoutUsd: number | null;
  pnlUsd: number | null;
  resolvedAt: Date | null;
  firstMaterializedAt: Date;
  frozenAt: Date | null;
}

/** Shape exposed on WhaleDto.outcome — what clients see. */
export type OutcomeBlockStatus =
  | TradeOutcomeStatus
  | Exclude<MarketResolutionStatus, 'tracking'>;

export interface OutcomeBlock {
  status: OutcomeBlockStatus;
  winningOutcome: 'YES' | 'NO' | null;
  payoutUsd: number | null;
  pnlUsd: number | null;
  /** Unix seconds (client-friendly) */
  resolvedAt: number | null;
  /** Convenience flag: status !== 'open' */
  closed: boolean;
}

/** Shape exposed on TraderDto.resolved — what clients see. */
export interface TraderResolvedBlock {
  buyCount: number;
  winCount: number;
  lossCount: number;
  longestWinStreak: number;
  /** 0..1 */
  winRate: number | null;
  realizedPnlUsd: number;
  volumeUsd: number;
  lastUpdatedAt: Date;
  lastResolvedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Batch-fetch outcome rows for a page of trade IDs.
 * Returns a Map keyed by trade ID for O(1) merge into DTOs.
 *
 * Empty input → empty map. Missing IDs are simply absent from the map.
 */
export async function getOutcomesByTradeIds(
  ids: string[],
): Promise<Map<string, TradeOutcomeDoc>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const docs = await db
    .collection<TradeOutcomeDoc>('trade_outcomes')
    .find({ _id: { $in: ids } })
    .toArray();
  return new Map(docs.map((d) => [d._id, d]));
}

export async function getResolutionByConditionId(
  conditionId: string,
): Promise<MarketResolutionDoc | null> {
  const db = getDb();
  return db
    .collection<MarketResolutionDoc>('market_resolutions')
    .findOne({ _id: conditionId.toLowerCase() });
}

export async function getResolutionsByConditionIds(
  conditionIds: string[],
): Promise<Map<string, MarketResolutionDoc>> {
  const ids = Array.from(
    new Set(
      conditionIds
        .map((id) => id?.toLowerCase?.())
        .filter((id): id is string => Boolean(id)),
    ),
  );
  if (ids.length === 0) return new Map();

  const db = getDb();
  const docs = await db
    .collection<MarketResolutionDoc>('market_resolutions')
    .find({ _id: { $in: ids } })
    .toArray();
  return new Map(docs.map((d) => [d._id, d]));
}

export async function getRecentResolved(
  limit = 20,
): Promise<MarketResolutionDoc[]> {
  const db = getDb();
  return db
    .collection<MarketResolutionDoc>('market_resolutions')
    .find({ status: 'resolved' })
    .sort({ resolvedAt: -1 })
    .limit(Math.min(Math.max(1, limit), 100))
    .toArray();
}

// ---------------------------------------------------------------------------
// Mappers — TradeOutcomeDoc → OutcomeBlock (client-friendly shape)
// ---------------------------------------------------------------------------

export function toOutcomeBlock(doc: TradeOutcomeDoc): OutcomeBlock {
  return {
    status: doc.status,
    winningOutcome: doc.winningOutcome,
    payoutUsd: doc.payoutUsd,
    pnlUsd: doc.pnlUsd,
    resolvedAt: doc.resolvedAt
      ? Math.floor(doc.resolvedAt.getTime() / 1000)
      : null,
    closed: doc.status !== 'open',
  };
}

export function toMarketResolutionBlock(doc: MarketResolutionDoc): OutcomeBlock {
  const closed = doc.status === 'closed' || doc.status === 'resolved' || doc.status === 'invalid';
  return {
    status: closed ? doc.status : 'open',
    winningOutcome: doc.winningOutcome,
    payoutUsd: null,
    pnlUsd: null,
    resolvedAt: doc.resolvedAt
      ? Math.floor(doc.resolvedAt.getTime() / 1000)
      : null,
    closed,
  };
}

/**
 * Look up resolved-stats fields on a single trader doc and project to the
 * TraderDto.resolved shape. Returns null if no resolved* fields are present
 * (i.e. the trader has no resolved BUY trades yet).
 */
export interface TraderResolvedFields {
  resolvedBuyCount?: number;
  resolvedWinCount?: number;
  resolvedLossCount?: number;
  resolvedLongestWinStreak?: number;
  resolvedWinRate?: number | null;
  resolvedRealizedPnlUsd?: number;
  resolvedVolumeUsd?: number;
  resolvedLastUpdatedAt?: Date;
  resolvedLastResolvedAt?: Date | null;
}

export function toTraderResolvedBlock(
  doc: TraderResolvedFields,
): TraderResolvedBlock | null {
  if (
    doc.resolvedBuyCount == null &&
    doc.resolvedWinCount == null &&
    doc.resolvedLossCount == null
  ) {
    return null;
  }

  return {
    buyCount: doc.resolvedBuyCount ?? 0,
    winCount: doc.resolvedWinCount ?? 0,
    lossCount: doc.resolvedLossCount ?? 0,
    longestWinStreak: doc.resolvedLongestWinStreak ?? 0,
    winRate: doc.resolvedWinRate ?? null,
    realizedPnlUsd: doc.resolvedRealizedPnlUsd ?? 0,
    volumeUsd: doc.resolvedVolumeUsd ?? 0,
    lastUpdatedAt: doc.resolvedLastUpdatedAt ?? new Date(0),
    lastResolvedAt: doc.resolvedLastResolvedAt ?? null,
  };
}

function tradeOutcomeResult(status: TradeOutcomeStatus): 'W' | 'L' | null {
  if (status === 'resolved_win') return 'W';
  if (status === 'resolved_loss') return 'L';
  return null;
}

function computeLongestWinStreak(docs: Pick<TradeOutcomeDoc, 'status'>[]): number {
  let current = 0;
  let longest = 0;

  for (const doc of docs) {
    if (tradeOutcomeResult(doc.status) === 'W') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

/**
 * Compute authoritative resolved BUY stats directly from trade_outcomes.
 * The streak is ordered by trade timestamp, matching "consecutive trades
 * without a loss in between" instead of leaderboard or sitemap ordering.
 */
export async function getTraderResolvedSummary(
  wallet: string,
): Promise<TraderResolvedBlock | null> {
  const normalizedWallet = wallet.toLowerCase();
  const db = getDb();
  const docs = await db
    .collection<TradeOutcomeDoc>('trade_outcomes')
    .find(
      {
        proxyWallet: normalizedWallet,
        side: 'BUY',
        status: { $in: ['resolved_win', 'resolved_loss'] },
      },
      {
        projection: {
          _id: 1,
          status: 1,
          pnlUsd: 1,
          usdSize: 1,
          timestamp: 1,
          resolvedAt: 1,
        },
      },
    )
    .sort({ timestamp: 1, resolvedAt: 1, _id: 1 })
    .toArray();

  if (docs.length === 0) return null;

  let winCount = 0;
  let lossCount = 0;
  let realizedPnlUsd = 0;
  let volumeUsd = 0;
  let lastResolvedAt: Date | null = null;

  for (const doc of docs) {
    if (doc.status === 'resolved_win') winCount += 1;
    if (doc.status === 'resolved_loss') lossCount += 1;
    realizedPnlUsd += doc.pnlUsd ?? 0;
    volumeUsd += doc.usdSize ?? 0;
    if (doc.resolvedAt && (!lastResolvedAt || doc.resolvedAt > lastResolvedAt)) {
      lastResolvedAt = doc.resolvedAt;
    }
  }

  const buyCount = winCount + lossCount;

  return {
    buyCount,
    winCount,
    lossCount,
    longestWinStreak: computeLongestWinStreak(docs),
    winRate: buyCount > 0 ? winCount / buyCount : null,
    realizedPnlUsd,
    volumeUsd,
    lastUpdatedAt: new Date(),
    lastResolvedAt,
  };
}
