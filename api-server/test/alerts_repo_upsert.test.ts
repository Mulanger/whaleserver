import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateOneMock = vi.fn(async () => ({}));

vi.mock('../src/db/mongo.js', () => ({
  getDb: () => ({
    collection: () => ({
      updateOne: updateOneMock,
    }),
  }),
}));

import { upsertAlertSubscription } from '../src/db/repos/alerts_repo.js';

describe('upsertAlertSubscription', () => {
  beforeEach(() => {
    updateOneMock.mockClear();
  });

  it('avoids platform path conflicts for known platforms', async () => {
    await upsertAlertSubscription({
      userId: 'anon_user_1',
      fcmToken: 'token-1',
      platform: 'ios',
      minUsd: 50000,
      megaOnly: false,
      followingOnly: false,
      categories: ['Crypto'],
      quietHours: null,
    });

    expect(updateOneMock).toHaveBeenCalledOnce();
    const updateDoc = updateOneMock.mock.calls[0]?.[1] as {
      $set: Record<string, unknown>;
      $setOnInsert: Record<string, unknown>;
    };

    expect(updateDoc.$set.platform).toBe('ios');
    expect(updateDoc.$set.followingOnly).toBe(false);
    expect(updateDoc.$setOnInsert.platform).toBeUndefined();
  });

  it('stores unknown platform on insert when platform is unknown', async () => {
    await upsertAlertSubscription({
      userId: 'anon_user_2',
      fcmToken: 'token-2',
      platform: 'unknown',
      minUsd: 25000,
      megaOnly: true,
      followingOnly: true,
      categories: [],
      quietHours: null,
    });

    expect(updateOneMock).toHaveBeenCalledOnce();
    const updateDoc = updateOneMock.mock.calls[0]?.[1] as {
      $set: Record<string, unknown>;
      $setOnInsert: Record<string, unknown>;
    };

    expect(updateDoc.$set.platform).toBeUndefined();
    expect(updateDoc.$set.followingOnly).toBe(true);
    expect(updateDoc.$setOnInsert.platform).toBe('unknown');
  });
});
