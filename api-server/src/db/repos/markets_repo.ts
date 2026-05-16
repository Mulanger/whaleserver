import { getDb } from '../mongo.js';
import type { MarketDto, WhaleDto } from '../../shared/types.js';
import { toWhaleDto } from './whales_repo.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function getMarkets(opts: {
  search?: string;
  category?: string;
  active?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<{ items: MarketDto[]; nextCursor: string | null }> {
  const db = getDb();
  const q: Record<string, unknown> = {};

  if (opts.category) q['category'] = opts.category;
  if (opts.active !== false) q['active'] = true;
  if (opts.search) q['title'] = { $regex: `^${escapeRegex(opts.search)}`, $options: 'i' };

  const limit = Math.min(opts.limit ?? 50, 100);

  const docs = await db
    .collection('markets')
    .find(q)
    .sort({ volume24h: -1 })
    .limit(limit + 1)
    .toArray();

  const hasMore = docs.length > limit;
  const items = (hasMore ? docs.slice(0, limit) : docs).map((doc) => ({
    id: doc._id.toString(),
    slug: doc.slug,
    title: doc.title,
    category: doc.category,
    question: doc.question,
    description: doc.description,
    active: doc.active,
    volume24h: doc.volume24h,
    volume7d: doc.volume7d,
    prices: doc.prices,
    createdAt: doc.createdAt,
  }));

  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

  return { items, nextCursor };
}

export async function getMarketBySlug(slug: string): Promise<MarketDto | null> {
  const db = getDb();
  const doc = await db.collection('markets').findOne({ slug });
  if (!doc) return null;

  return {
    id: doc._id.toString(),
    slug: doc.slug,
    title: doc.title,
    category: doc.category,
    question: doc.question,
    description: doc.description,
    active: doc.active,
    volume24h: doc.volume24h,
    volume7d: doc.volume7d,
    prices: doc.prices,
    createdAt: doc.createdAt,
  };
}

export async function getRecentWhalesForMarket(
  slug: string,
  limit = 20
): Promise<WhaleDto[]> {
  const db = getDb();
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

  const docs = await db
    .collection('trades')
    .find({ 'market.slug': slug, timestamp: { $gte: weekAgo } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  return docs.map(toWhaleDto);
}
