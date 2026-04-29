import { describe, it, expect } from 'vitest';
import { isInQuietHours, isValidQuietHours } from '../src/alerts/quiet_hours.js';

describe('isInQuietHours', () => {
  it('returns false when quietHours is missing', () => {
    expect(isInQuietHours(undefined)).toBe(false);
    expect(isInQuietHours(null)).toBe(false);
  });

  it('handles same-day windows', () => {
    const now = new Date('2026-01-01T10:30:00.000Z');
    const result = isInQuietHours(
      { start: '10:00', end: '12:00', tz: 'UTC' },
      now
    );
    expect(result).toBe(true);
  });

  it('treats end boundary as exclusive', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const result = isInQuietHours(
      { start: '10:00', end: '12:00', tz: 'UTC' },
      now
    );
    expect(result).toBe(false);
  });

  it('handles overnight windows', () => {
    const lateNight = isInQuietHours(
      { start: '22:00', end: '07:00', tz: 'UTC' },
      new Date('2026-01-01T23:30:00.000Z')
    );
    const earlyMorning = isInQuietHours(
      { start: '22:00', end: '07:00', tz: 'UTC' },
      new Date('2026-01-01T06:59:00.000Z')
    );
    const daytime = isInQuietHours(
      { start: '22:00', end: '07:00', tz: 'UTC' },
      new Date('2026-01-01T12:00:00.000Z')
    );

    expect(lateNight).toBe(true);
    expect(earlyMorning).toBe(true);
    expect(daytime).toBe(false);
  });

  it('resolves timezone-aware windows', () => {
    const now = new Date('2026-01-01T21:30:00.000Z');
    const result = isInQuietHours(
      { start: '22:00', end: '23:00', tz: 'Europe/Berlin' },
      now
    );
    expect(result).toBe(true);
  });
});

describe('isValidQuietHours', () => {
  it('validates format and timezone', () => {
    expect(isValidQuietHours({ start: '22:00', end: '07:00', tz: 'UTC' })).toBe(true);
    expect(isValidQuietHours({ start: '25:00', end: '07:00', tz: 'UTC' })).toBe(false);
    expect(isValidQuietHours({ start: '22:00', end: '07:00', tz: 'Invalid/Zone' })).toBe(false);
  });
});
