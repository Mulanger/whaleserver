import type { WhaleDto, WhaleFilter } from '../shared/types.js';

export function matches(whale: WhaleDto, f: WhaleFilter): boolean {
  if (f.minUsd != null && whale.usdSize < f.minUsd) return false;
  if (f.maxUsd != null && whale.usdSize > f.maxUsd) return false;
  if (f.side && whale.side !== f.side) return false;
  if (f.tier && whale.tier !== f.tier) return false;
  if (f.categories?.length && !f.categories.includes(whale.market?.category ?? '')) return false;
  if (f.marketSlug && whale.market?.slug !== f.marketSlug) return false;
  return true;
}