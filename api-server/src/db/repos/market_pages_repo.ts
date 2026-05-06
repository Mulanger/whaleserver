import { getDb } from '../mongo.js';
import type {
  MarketPageDto,
  MarketPageSitemapItemDto,
  WhaleDto,
} from '../../shared/types.js';
import { toWhaleDto, mergeOutcomesIntoDtos } from './whales_repo.js';

const WHALE_USD_FLOOR = 10_000;

export async function getMarketPageBySlug(slug: string): Promise<MarketPageDto | null> {
  const db = getDb();
  const doc = await db.collection('market_page_snapshots').findOne({ slug });
  if (!doc) return null;

  const recentDocs = await db
    .collection('trades')
    .find({
      'market.slug': slug,
      usdSize: { $gte: WHALE_USD_FLOOR },
    })
    .sort({ timestamp: -1, _id: -1 })
    .limit(50)
    .toArray();

  const recentTrades = await mergeOutcomesIntoDtos(recentDocs.map(toWhaleDto));
  return toMarketPageDto(doc, recentTrades);
}

export async function getMarketPageSitemap(opts: {
  limit?: number;
} = {}): Promise<{ items: MarketPageSitemapItemDto[] }> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 250, 1), 500);
  const docs = await db
    .collection('market_page_snapshots')
    .find({ indexable: true })
    .sort({ 'stats.whaleVolume': -1, 'stats.latestTradeTs': -1 })
    .limit(limit)
    .toArray();

  return {
    items: docs.map((doc) => ({
      slug: String(doc.slug || doc._id),
      title: String(doc.market?.title || doc.slug || doc._id),
      whaleVolume: Number(doc.stats?.whaleVolume || 0),
      whaleTradeCount: Number(doc.stats?.whaleTradeCount || 0),
      latestTradeTs: Number(doc.stats?.latestTradeTs || 0),
      refreshedAt: doc.refreshedAt,
    })),
  };
}

function toMarketPageDto(doc: any, recentTrades: WhaleDto[]): MarketPageDto {
  return {
    market: {
      slug: String(doc.market?.slug || doc.slug || doc._id),
      conditionId: doc.market?.conditionId ?? null,
      title: String(doc.market?.title || doc.slug || doc._id),
      icon: doc.market?.icon ?? null,
      category: doc.market?.category ?? null,
      eventSlug: doc.market?.eventSlug ?? null,
      polymarketUrl: doc.market?.polymarketUrl ?? null,
      endDate: doc.market?.endDate ?? null,
      active: doc.market?.active ?? null,
      yesPriceCents: doc.market?.yesPriceCents ?? null,
      noPriceCents: doc.market?.noPriceCents ?? null,
      volume24h: doc.market?.volume24h ?? null,
      liquidity: doc.market?.liquidity ?? null,
    },
    stats: {
      whaleVolume: Number(doc.stats?.whaleVolume || 0),
      whaleTradeCount: Number(doc.stats?.whaleTradeCount || 0),
      uniqueWhales: Number(doc.stats?.uniqueWhales || 0),
      biggestTradeUsd: Number(doc.stats?.biggestTradeUsd || 0),
      latestTradeTs: Number(doc.stats?.latestTradeTs || 0),
      firstTradeTs: Number(doc.stats?.firstTradeTs || 0),
    },
    topWallets: Array.isArray(doc.topWallets) ? doc.topWallets : [],
    relatedMarkets: Array.isArray(doc.relatedMarkets) ? doc.relatedMarkets : [],
    recentTrades,
    seo: {
      indexable: Boolean(doc.indexable),
      reason: String(doc.indexingReason || ''),
      source: 'market_page_worker',
      lookbackDays: Number(doc.lookbackDays || 0),
      refreshedAt: doc.refreshedAt,
      lastQualifiedAt: doc.lastQualifiedAt ?? null,
      staleAt: doc.staleAt ?? null,
    },
  };
}
