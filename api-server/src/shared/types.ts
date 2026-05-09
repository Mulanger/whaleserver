export type MobilePlatform = 'ios' | 'android' | 'web' | 'unknown';

/**
 * Trade-outcome fields populated by the trade-resolver service when a market
 * has resolved. Absent when status is 'open' or when the resolver hasn't
 * materialised this trade yet (e.g. the resolver is freshly deployed and
 * still backfilling, or the OUTCOMES_IN_DTO feature flag is off).
 *
 * See trade-resolver spec §14.2 and §5.3 for the SELL-side rendering nuance.
 */
export interface WhaleOutcome {
  status: 'open' | 'closed' | 'resolved' | 'resolved_win' | 'resolved_loss' | 'invalid';
  winningOutcome: 'YES' | 'NO' | null;
  /** BUY: shares if win, 0 if loss; SELL: usdSize (proceeds) */
  payoutUsd: number | null;
  /** BUY: payoutUsd - usdSize; SELL: null (no FIFO basis in v1) */
  pnlUsd: number | null;
  /** Unix seconds for client friendliness */
  resolvedAt: number | null;
  /** Convenience: status !== 'open' */
  closed: boolean;
}

export interface WhaleDto {
  id: string;
  tier: 'mega' | 'large' | 'whale' | 'mini';
  side: 'BUY' | 'SELL';
  outcome: string;
  usdSize: number;
  shares: number;
  priceCents: number;
  priceMillicents: number;
  timestamp: number;
  market?: {
    conditionId?: string;
    slug: string;
    title: string;
    category: string;
  };
  trader?: {
    proxyWallet: string;
    pseudonym?: string;
    displayName?: string;
    profileImage?: string;
    vol30d?: number;
    winRate?: number;
    tradeCount?: number;
  };
  transactionHash: string;
  polymarketUrl: string;
  /**
   * Set when the underlying market has resolved (trade-resolver §14.2).
   * Note: named `resolution` (not `outcome`) because WhaleDto.outcome is
   * already taken by the YES/NO position string.
   */
  resolution?: WhaleOutcome;
}

export interface WhaleFilter {
  minUsd?: number;
  maxUsd?: number;
  tier?: string;
  categories?: string[];
  side?: 'BUY' | 'SELL';
  marketSlug?: string;
  traderWallet?: string;
  traderWallets?: string[];
  following?: boolean;
}

export interface Cursor {
  ts: number;
  id: string;
}

export interface MarketDto {
  id: string;
  slug: string;
  title: string;
  category: string;
  question: string;
  description: string;
  active: boolean;
  volume24h: number;
  volume7d: number;
  prices?: { yes: number; no: number };
  createdAt: Date;
}

export interface MarketPageWalletDto {
  rank: number;
  proxyWallet: string;
  pseudonym?: string | null;
  displayName?: string | null;
  profileImage?: string | null;
  volume: number;
  tradeCount: number;
  avgTrade: number;
}

export interface MarketPageRelatedDto {
  slug: string;
  title: string;
  icon?: string | null;
  eventSlug?: string | null;
  whaleVolume: number;
  whaleTradeCount: number;
  score: number;
}

export interface MarketPageDto {
  market: {
    slug: string;
    conditionId?: string | null;
    title: string;
    icon?: string | null;
    category?: string | null;
    eventSlug?: string | null;
    polymarketUrl?: string | null;
    endDate?: Date | null;
    active?: boolean | null;
    yesPriceCents?: number | null;
    noPriceCents?: number | null;
    volume24h?: number | null;
    liquidity?: number | null;
  };
  stats: {
    whaleVolume: number;
    whaleTradeCount: number;
    uniqueWhales: number;
    biggestTradeUsd: number;
    latestTradeTs: number;
    firstTradeTs?: number;
  };
  topWallets: MarketPageWalletDto[];
  relatedMarkets: MarketPageRelatedDto[];
  recentTrades: WhaleDto[];
  seo: {
    indexable: boolean;
    reason: string;
    source: 'market_page_worker';
    lookbackDays: number;
    refreshedAt: Date;
    lastQualifiedAt?: Date | null;
    staleAt?: Date | null;
  };
}

export interface MarketPageSitemapItemDto {
  slug: string;
  title: string;
  whaleVolume: number;
  whaleTradeCount: number;
  latestTradeTs: number;
  refreshedAt: Date;
}

export interface TraderPageSitemapItemDto {
  proxyWallet: string;
  pseudonym?: string | null;
  displayName?: string | null;
  profileImage?: string | null;
  firstSeenTs: number;
  lastSeenTs: number;
  firstLeaderboardAt: number;
  lastLeaderboardAt: number;
  bestRank: number;
  bestRankWindow: '1d' | '7d' | '30d' | '365d';
  bestVolume: number;
  tradeCount: number;
  whaleCount: number;
  refreshedAt: Date;
}

/**
 * Resolved-stats summary from the trade-resolver. The two `winRate`s on the
 * same TraderDto need clear UI labelling: existing `winRate` is the watcher's
 * live Polymarket-positions number, while `resolved.winRate` is locked-in
 * resolved BUY trades. See trade-resolver spec §14.3.
 */
export interface TraderResolved {
  buyCount: number;
  winCount: number;
  lossCount: number;
  longestWinStreak: number;
  /** 0..1; null when buyCount === 0 */
  winRate: number | null;
  realizedPnlUsd: number;
  volumeUsd: number;
  lastUpdatedAt: Date;
  lastResolvedAt: Date | null;
}

export interface TraderDto {
  wallet: string;
  vol30d?: number;
  winRate?: number;
  tradeCount?: number;
  lastActiveAt?: Date;
  /** Set when the resolver has aggregated at least one resolved BUY trade. */
  resolved?: TraderResolved;
}

/**
 * Payload published on the `market_resolutions` Redis channel by the
 * trade-resolver. Consumed by the WS hub and broadcast to clients as
 * { type: "resolution_update", data: ResolutionEventPayload }.
 */
export interface ResolutionEventPayload {
  type: 'resolved' | 'invalid';
  conditionId: string;
  slug: string;
  winningOutcome: 'YES' | 'NO' | null;
  resolvedAt: number | null;
  finalYesPriceCents: number | null;
  finalNoPriceCents: number | null;
}

export interface AlertSubscription {
  _id: string;
  userId: string;
  fcmToken: string;
  platform: MobilePlatform;
  minUsd: number;
  megaOnly: boolean;
  followingOnly: boolean;
  categories: string[];
  quietHours?: {
    start: string;
    end: string;
    tz: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  lastNotifiedAt: Date | null;
}

export interface User {
  _id: string;
  type: 'anonymous' | 'user';
  platform: MobilePlatform;
  createdAt: Date;
  lastSeenAt: Date;
}
