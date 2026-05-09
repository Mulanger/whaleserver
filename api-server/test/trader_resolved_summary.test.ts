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

import { getTraderResolvedSummary } from '../src/db/repos/outcomes_repo.js';

describe('trader resolved summary', () => {
  beforeEach(() => {
    state.db = undefined;
    vi.clearAllMocks();
  });

  it('computes longest win streak from chronological resolved BUY outcomes', async () => {
    const docs = [
      { _id: 'a', status: 'resolved_win', pnlUsd: 10, usdSize: 100, resolvedAt: new Date('2026-01-01'), timestamp: 100 },
      { _id: 'b', status: 'resolved_win', pnlUsd: 20, usdSize: 200, resolvedAt: new Date('2026-01-02'), timestamp: 200 },
      { _id: 'c', status: 'resolved_loss', pnlUsd: -30, usdSize: 300, resolvedAt: new Date('2026-01-03'), timestamp: 300 },
      { _id: 'd', status: 'resolved_win', pnlUsd: 40, usdSize: 400, resolvedAt: new Date('2026-01-04'), timestamp: 400 },
      { _id: 'e', status: 'resolved_win', pnlUsd: 50, usdSize: 500, resolvedAt: new Date('2026-01-05'), timestamp: 500 },
      { _id: 'f', status: 'resolved_win', pnlUsd: 60, usdSize: 600, resolvedAt: new Date('2026-01-06'), timestamp: 600 },
    ];
    const toArray = vi.fn().mockResolvedValue(docs);
    const sort = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ sort });

    state.db = {
      collection: vi.fn((name: string) => {
        if (name === 'trade_outcomes') return { find };
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    const summary = await getTraderResolvedSummary('0xABC');

    expect(find).toHaveBeenCalledWith(
      {
        proxyWallet: '0xabc',
        side: 'BUY',
        status: { $in: ['resolved_win', 'resolved_loss'] },
      },
      expect.any(Object),
    );
    expect(sort).toHaveBeenCalledWith({ timestamp: 1, resolvedAt: 1, _id: 1 });
    expect(summary).toMatchObject({
      buyCount: 6,
      winCount: 5,
      lossCount: 1,
      longestWinStreak: 3,
      winRate: 5 / 6,
      realizedPnlUsd: 150,
      volumeUsd: 2100,
      lastResolvedAt: new Date('2026-01-06'),
    });
  });

  it('returns null when no resolved BUY outcomes exist', async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const sort = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ sort });

    state.db = {
      collection: vi.fn((name: string) => {
        if (name === 'trade_outcomes') return { find };
        throw new Error(`unexpected collection ${name}`);
      }),
    };

    await expect(getTraderResolvedSummary('0xabc')).resolves.toBeNull();
  });
});
