import { describe, it, expect } from 'vitest';
import { matches } from '../src/ws/filters.js';
import type { WhaleDto, WhaleFilter } from '../src/shared/types.js';

describe('filters.matches', () => {
  const baseWhale: WhaleDto = {
    id: '123',
    tier: 'whale',
    side: 'BUY',
    outcome: 'YES',
    usdSize: 50000,
    shares: 100000,
    priceCents: 50,
    timestamp: 1735689600,
    market: {
      slug: 'BTC-yes',
      title: 'Bitcoin',
      category: 'Crypto',
    },
    trader: {
      proxyWallet: '0x123',
    },
    transactionHash: '0xabc',
    polymarketUrl: 'https://polymarket.com/event/abc',
  };

  it('returns true when no filters', () => {
    expect(matches(baseWhale, {})).toBe(true);
  });

  it('filters by minUsd', () => {
    expect(matches(baseWhale, { minUsd: 40000 })).toBe(true);
    expect(matches(baseWhale, { minUsd: 50000 })).toBe(true);
    expect(matches(baseWhale, { minUsd: 60000 })).toBe(false);
  });

  it('filters by maxUsd', () => {
    expect(matches(baseWhale, { maxUsd: 60000 })).toBe(true);
    expect(matches(baseWhale, { maxUsd: 50000 })).toBe(true);
    expect(matches(baseWhale, { maxUsd: 40000 })).toBe(false);
  });

  it('filters by side', () => {
    expect(matches(baseWhale, { side: 'BUY' })).toBe(true);
    expect(matches(baseWhale, { side: 'SELL' })).toBe(false);
  });

  it('filters by tier', () => {
    expect(matches(baseWhale, { tier: 'whale' })).toBe(true);
    expect(matches(baseWhale, { tier: 'mega' })).toBe(false);
  });

  it('filters by categories', () => {
    expect(matches(baseWhale, { categories: ['Crypto'] })).toBe(true);
    expect(matches(baseWhale, { categories: ['Politics'] })).toBe(false);
    expect(matches(baseWhale, { categories: ['Crypto', 'Politics'] })).toBe(true);
  });

  it('filters by marketSlug', () => {
    expect(matches(baseWhale, { marketSlug: 'BTC-yes' })).toBe(true);
    expect(matches(baseWhale, { marketSlug: 'ETH-yes' })).toBe(false);
  });

  it('handles missing market', () => {
    const whaleWithoutMarket = { ...baseWhale, market: undefined };
    expect(matches(whaleWithoutMarket, { categories: ['Crypto'] })).toBe(false);
  });

  it('combines multiple filters', () => {
    const filter: WhaleFilter = {
      minUsd: 40000,
      maxUsd: 60000,
      side: 'BUY',
      tier: 'whale',
    };
    expect(matches(baseWhale, filter)).toBe(true);
  });
});