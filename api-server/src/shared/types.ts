export interface WhaleDto {
  id: string;
  tier: 'mega' | 'large' | 'whale' | 'mini';
  side: 'BUY' | 'SELL';
  outcome: string;
  usdSize: number;
  shares: number;
  priceCents: number;
  timestamp: number;
  market?: {
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

export interface TraderDto {
  wallet: string;
  vol30d?: number;
  winRate?: number;
  tradeCount?: number;
  lastActiveAt?: Date;
}

export interface AlertSubscription {
  _id: string;
  userId: string;
  fcmToken: string;
  platform: 'ios' | 'android';
  minUsd: number;
  megaOnly: boolean;
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
  platform: 'ios' | 'android';
  createdAt: Date;
  lastSeenAt: Date;
}
