import { describe, expect, it } from 'vitest';
import { getCurrentNewYorkSession } from '../src/shared/ny_session.js';

describe('New York session helper', () => {
  it('uses EDT midnight boundaries for a summer trading day', () => {
    const session = getCurrentNewYorkSession(Date.parse('2026-05-02T15:00:00.000Z'));

    expect(session).toMatchObject({
      timezone: 'America/New_York',
      dateKey: '2026-05-02',
      startTs: Date.parse('2026-05-02T04:00:00.000Z') / 1000,
      endTs: Date.parse('2026-05-03T04:00:00.000Z') / 1000,
      nextResetTs: Date.parse('2026-05-03T04:00:00.000Z') / 1000,
    });
  });

  it('uses EST midnight boundaries for a winter trading day', () => {
    const session = getCurrentNewYorkSession(Date.parse('2026-01-15T15:00:00.000Z'));

    expect(session).toMatchObject({
      dateKey: '2026-01-15',
      startTs: Date.parse('2026-01-15T05:00:00.000Z') / 1000,
      endTs: Date.parse('2026-01-16T05:00:00.000Z') / 1000,
    });
  });

  it('keeps the local date correct on the spring DST transition day', () => {
    const session = getCurrentNewYorkSession(Date.parse('2026-03-08T16:00:00.000Z'));

    expect(session).toMatchObject({
      dateKey: '2026-03-08',
      startTs: Date.parse('2026-03-08T05:00:00.000Z') / 1000,
      endTs: Date.parse('2026-03-09T04:00:00.000Z') / 1000,
    });
  });
});
