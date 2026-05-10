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
      allTimeWinRatePct: 80,
      recentFormResults: ['W', 'L', 'W', 'W', 'W'],
      recentFormWinRatePct: 80,
    });
  });

  it('ranks the profit leaderboard directly from all-time trade outcomes', async () => {
    const walletA = '0xaaa';
    const walletB = '0xbbb';
    const toArray = vi
      .fn()
      .mockResolvedValueOnce([
        {
          _id: walletB,
          allTimeProfitUsd: 125,
          allTimePnlTradeCount: 3,
          resolvedWinCount: 3,
          resolvedLossCount: 0,
        },
        {
          _id: walletA,
          allTimeProfitUsd: 50,
          allTimePnlTradeCount: 2,
          resolvedWinCount: 1,
          resolvedLossCount: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: walletB,
          allTimeProfitUsd: 125,
          allTimePnlTradeCount: 3,
          resolvedWinCount: 3,
          resolvedLossCount: 0,
        },
        {
          _id: walletA,
          allTimeProfitUsd: 50,
          allTimePnlTradeCount: 2,
          resolvedWinCount: 1,
          resolvedLossCount: 1,
        },
      ])
      .mockResolvedValueOnce([
        { _id: walletB, statuses: ['resolved_win', 'resolved_win', 'resolved_win'] },
        { _id: walletA, statuses: ['resolved_loss', 'resolved_win'] },
      ]);
    const outcomesAggregate = vi.fn().mockReturnValue({ toArray });

    state.db = {
      collection: vi.fn((name: string) => {
        if (name === 'trade_outcomes') return { aggregate: outcomesAggregate };
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    const page = await getLeaderboard('1d', 10, undefined, true, 'profit');

    expect(page.items.map((item) => item.proxyWallet)).toEqual([walletB, walletA]);
    expect(page.items.map((item) => item.rank)).toEqual([1, 2]);
    expect(page.items[0]).toMatchObject({
      allTimeProfitUsd: 125,
      allTimeProfitKnown: true,
      allTimePnlTradeCount: 3,
      allTimeWinRatePct: 100,
      recentFormResults: ['W', 'W', 'W'],
      recentFormWinRatePct: 100,
    });
    expect(state.db.collection).not.toHaveBeenCalledWith('trades');
  });

  it('keeps profit leaderboard rows independent of the requested window', async () => {
    const walletA = '0xaaa';
    const walletB = '0xbbb';
    const profitRows = [
      {
        _id: walletB,
        allTimeProfitUsd: 125,
        allTimePnlTradeCount: 3,
        resolvedWinCount: 3,
        resolvedLossCount: 0,
      },
      {
        _id: walletA,
        allTimeProfitUsd: 50,
        allTimePnlTradeCount: 2,
        resolvedWinCount: 1,
        resolvedLossCount: 1,
      },
    ];
    const recentRows = [
      { _id: walletB, statuses: ['resolved_win', 'resolved_win', 'resolved_win'] },
      { _id: walletA, statuses: ['resolved_loss', 'resolved_win'] },
    ];
    const toArray = vi
      .fn()
      .mockResolvedValueOnce(profitRows)
      .mockResolvedValueOnce(profitRows)
      .mockResolvedValueOnce(recentRows)
      .mockResolvedValueOnce(profitRows)
      .mockResolvedValueOnce(profitRows)
      .mockResolvedValueOnce(recentRows);
    const outcomesAggregate = vi.fn().mockReturnValue({ toArray });

    state.db = {
      collection: vi.fn((name: string) => {
        if (name === 'trade_outcomes') return { aggregate: outcomesAggregate };
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    const oneDay = await getLeaderboard('1d', 10, undefined, true, 'profit');
    const sevenDay = await getLeaderboard('7d', 10, undefined, true, 'profit');

    expect(oneDay.items.map((item) => [item.proxyWallet, item.allTimeProfitUsd])).toEqual(
      sevenDay.items.map((item) => [item.proxyWallet, item.allTimeProfitUsd]),
    );
  });

  it('separates all-time win rate from recent five-trade form', async () => {
    const wallet = '0xaaa';
    const profitRows = [
      {
        _id: wallet,
        allTimeProfitUsd: 1000000,
        allTimePnlTradeCount: 10,
        resolvedWinCount: 8,
        resolvedLossCount: 2,
      },
    ];
    const recentRows = [
      {
        _id: wallet,
        statuses: ['resolved_loss', 'resolved_loss', 'resolved_loss', 'resolved_loss', 'resolved_loss'],
      },
    ];
    const toArray = vi
      .fn()
      .mockResolvedValueOnce(profitRows)
      .mockResolvedValueOnce(profitRows)
      .mockResolvedValueOnce(recentRows);
    const outcomesAggregate = vi.fn().mockReturnValue({ toArray });

    state.db = {
      collection: vi.fn((name: string) => {
        if (name === 'trade_outcomes') return { aggregate: outcomesAggregate };
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    const page = await getLeaderboard('1d', 10, undefined, true, 'profit');

    expect(page.items[0]).toMatchObject({
      proxyWallet: wallet,
      allTimeProfitUsd: 1000000,
      allTimeWinRatePct: 80,
      recentFormResults: ['L', 'L', 'L', 'L', 'L'],
      recentFormWinRatePct: 0,
    });
  });
});
