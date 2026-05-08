import { getDb } from '../mongo.js';
import type { TraderPageSitemapItemDto } from '../../shared/types.js';

export async function getTraderPageSitemap(opts: {
  limit?: number;
} = {}): Promise<{ items: TraderPageSitemapItemDto[] }> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);
  const docs = await db
    .collection('trader_page_index')
    .find({ indexable: true })
    .sort({ bestRank: 1, bestVolume: -1, lastSeenTs: -1, proxyWallet: 1 })
    .limit(limit)
    .toArray();

  return {
    items: docs.map((doc) => ({
      proxyWallet: String(doc.proxyWallet || doc._id).toLowerCase(),
      pseudonym: doc.pseudonym ?? null,
      displayName: doc.displayName ?? null,
      profileImage: doc.profileImage ?? null,
      firstSeenTs: Number(doc.firstSeenTs || 0),
      lastSeenTs: Number(doc.lastSeenTs || 0),
      firstLeaderboardAt: Number(doc.firstLeaderboardAt || 0),
      lastLeaderboardAt: Number(doc.lastLeaderboardAt || 0),
      bestRank: Number(doc.bestRank || 0),
      bestRankWindow: normalizeWindow(doc.bestRankWindow),
      bestVolume: Number(doc.bestVolume || 0),
      tradeCount: Number(doc.tradeCount || 0),
      whaleCount: Number(doc.whaleCount || 0),
      refreshedAt: doc.updatedAt ?? doc.refreshedAt ?? new Date(0),
    })),
  };
}

function normalizeWindow(value: unknown): TraderPageSitemapItemDto['bestRankWindow'] {
  return value === '1d' || value === '7d' || value === '30d' || value === '365d'
    ? value
    : '30d';
}
