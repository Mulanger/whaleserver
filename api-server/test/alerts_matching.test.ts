import { describe, expect, it } from 'vitest';
import { matchesSubscription } from '../src/alerts/matching.js';

describe('matchesSubscription', () => {
  it('matches when usd size is above min and categories are empty', () => {
    const result = matchesSubscription(
      { usdSize: 50000, marketCategory: 'Politics' },
      { minUsd: 10000, megaOnly: false, categories: [] }
    );

    expect(result).toBe(true);
  });

  it('does not match when usd size is below minUsd', () => {
    const result = matchesSubscription(
      { usdSize: 9999, marketCategory: 'Crypto' },
      { minUsd: 10000, megaOnly: false, categories: [] }
    );

    expect(result).toBe(false);
  });

  it('enforces megaOnly threshold at 250000 usd', () => {
    const belowThreshold = matchesSubscription(
      { usdSize: 249999, marketCategory: 'Sports' },
      { minUsd: 1000, megaOnly: true, categories: [] }
    );
    const atThreshold = matchesSubscription(
      { usdSize: 250000, marketCategory: 'Sports' },
      { minUsd: 1000, megaOnly: true, categories: [] }
    );

    expect(belowThreshold).toBe(false);
    expect(atThreshold).toBe(true);
  });

  it('matches category only when categories are configured', () => {
    const matched = matchesSubscription(
      { usdSize: 80000, marketCategory: 'Tech' },
      { minUsd: 1000, megaOnly: false, categories: ['Tech', 'Crypto'] }
    );
    const unmatched = matchesSubscription(
      { usdSize: 80000, marketCategory: 'Culture' },
      { minUsd: 1000, megaOnly: false, categories: ['Tech', 'Crypto'] }
    );

    expect(matched).toBe(true);
    expect(unmatched).toBe(false);
  });
});

