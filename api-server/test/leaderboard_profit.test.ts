import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  db: undefined as any,
}));

vi.hoisted(() => {
  process.env['MONGO_URI'] = 'mongodb://localhost:27017/polywatch-test';
  process.env['JWT_SECRET'] = 'test-secret';
});

vi.mock('../src/db/mongo.js', () => ({
  getDb: () => state.db,
}));

import { getLeaderboard } from '../src/db/repos/leaderboard_repo.js';

describe('leaderboard profit enrichment', () => {
  beforeEach(() => {
    state.db = undefined;
    vi.clearAllMocks();
  });

  it('adds cached all-time P/L fields from trade outcomes', async () => {
    const wallet = '0xabc';
    const tradesAggregate = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: wallet,
          pseudonym: 'Intent-Noodle',
          volume: 12345,
          tradeCount: 2,
          whaleCount: 2,
        },
      ]),
    });
    const outcomesAggregate = vi
      .fn()
      .mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: wallet,
            allTimeProfitUsd: 321,
            allTimePnlTradeCount: 5,
            resolvedWinCount: 4,
            resolvedLossCount: 1,
          },
        ]),
      })
      .mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: wallet,
            statuses: ['resolved_win', 'resolved_loss', 'resolved_win', 'resolved_win', 'resolved_win'],
          },
        ]),
      });

    state.db = {
      collection: vi.fn((name: string) => {
        if (name === 'trades') return { aggregate: tradesAggregate };
        if (name === 'trade_outcomes') return { aggregate: outcomesAggregate };
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    const page = await getLeaderboard('7d', 10, undefined, true);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      proxyWallet: wallet,
      allTimeProfitUsd: 321,
      allTimeProfitKnown: true,
      allTimePnlTradeCount: 5,
      recentFormResults: ['W', 'L', 'W', 'W', 'W'],
      recentFormWinRatePct: 80,
    });
  });
});
