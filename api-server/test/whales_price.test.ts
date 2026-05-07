import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';

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

import { getWhaleById, getWhales, toWhaleDto } from '../src/db/repos/whales_repo.js';

function tradeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    tier: 'whale',
    side: 'BUY',
    outcome: 'YES',
    usdSize: 998,
    shares: 1000,
    priceCents: 100,
    timestamp: 1735689600,
    market: {
      slug: 'test-market',
      title: 'Test Market',
      category: 'Test',
    },
    trader: {
      proxyWallet: '0x123',
      vol30d: 1,
    },
    transactionHash: '0xabc',
    polymarketUrl: 'https://polymarket.com/event/test-market',
    ...overrides,
  };
}

function mockDbWithTrades(docs: any[], detailDoc?: any) {
  const findChain = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs),
  };

  const trades = {
    find: vi.fn().mockReturnValue(findChain),
    findOne: vi.fn().mockResolvedValue(detailDoc ?? null),
  };

  const traders = {
    findOne: vi.fn().mockResolvedValue(null),
  };

  state.db = {
    collection: vi.fn((name: string) => {
      if (name === 'trades') return trades;
      if (name === 'traders') return traders;
      throw new Error(`unexpected collection ${name}`);
    }),
  };

  return { findChain, trades, traders };
}

describe('whale price response mapping', () => {
  beforeEach(() => {
    state.db = undefined;
    vi.clearAllMocks();
  });

  it('uses stored millicents while leaving rounded cents unchanged', () => {
    const dto = toWhaleDto(tradeDoc({
      priceCents: 100,
      priceMillicents: 9980,
      raw: { price: 0.5 },
    }));

    expect(dto.priceCents).toBe(100);
    expect(dto.priceMillicents).toBe(9980);
  });

  it('falls back from raw price for old docs without priceMillicents', () => {
    const dto = toWhaleDto(tradeDoc({
      priceCents: 100,
      raw: { price: 0.998 },
    }));

    expect(dto.priceCents).toBe(100);
    expect(dto.priceMillicents).toBe(9980);
  });

  it('falls back from usdSize divided by shares when raw price is missing', () => {
    const dto = toWhaleDto(tradeDoc({
      usdSize: 499,
      shares: 500,
      priceCents: 100,
    }));

    expect(dto.priceMillicents).toBe(9980);
  });

  it('returns priceMillicents for old docs that only have priceCents', () => {
    const dto = toWhaleDto(tradeDoc({
      usdSize: undefined,
      shares: 0,
      priceCents: 100,
    }));

    expect(dto.priceMillicents).toBe(10000);
  });

  it('includes priceMillicents in the whale list response mapping', async () => {
    mockDbWithTrades([
      tradeDoc({
        priceCents: 100,
        priceMillicents: 9980,
      }),
    ]);

    const result = await getWhales({}, undefined, 50);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      priceCents: 100,
      priceMillicents: 9980,
    });
  });

  it('includes priceMillicents in the whale detail response mapping', async () => {
    const id = new ObjectId();
    mockDbWithTrades([], tradeDoc({
      _id: id,
      priceCents: 100,
      raw: { price: 0.998 },
    }));

    const result = await getWhaleById(id.toHexString());

    expect(result).toMatchObject({
      id: id.toHexString(),
      priceCents: 100,
      priceMillicents: 9980,
    });
  });

  it('looks up string trade ids used by whale feed rows', async () => {
    const id = 'ccc5c94b2dbfce03b84854fe';
    const { trades } = mockDbWithTrades([], tradeDoc({ _id: id }));

    const result = await getWhaleById(id);

    expect(result?.id).toBe(id);
    const query = trades.findOne.mock.calls[0][0];
    expect(query._id.$in[0]).toBe(id);
    expect(query._id.$in[1].toHexString()).toBe(id);
  });
});
