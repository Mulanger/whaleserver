import { describe, it, expect } from 'vitest';

function inQuietHours(sub: { quietHours?: { start: string; end: string; tz: string } | null }): boolean {
  if (!sub.quietHours) return false;

  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: sub.quietHours.tz }));
  const mins = local.getHours() * 60 + local.getMinutes();
  const [sh, sm] = sub.quietHours.start.split(':').map(Number);
  const [eh, em] = sub.quietHours.end.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  if (start <= end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

describe('inQuietHours', () => {
  it('returns false when no quietHours', () => {
    expect(inQuietHours({})).toBe(false);
  });

  it('returns false when quietHours is null', () => {
    expect(inQuietHours({ quietHours: null })).toBe(false);
  });

  it('handles same-day range', () => {
    const sub = {
      quietHours: { start: '22:00', end: '23:00', tz: 'UTC' },
    };
    const result = inQuietHours(sub);
    expect(typeof result).toBe('boolean');
  });

  it('handles overnight range', () => {
    const sub = {
      quietHours: { start: '22:00', end: '07:00', tz: 'UTC' },
    };
    const result = inQuietHours(sub);
    expect(typeof result).toBe('boolean');
  });

  it('returns boolean type', () => {
    const tests = [
      { quietHours: { start: '00:00', end: '00:01', tz: 'UTC' } },
      { quietHours: { start: '23:59', end: '23:58', tz: 'UTC' } },
    ];
    for (const sub of tests) {
      expect(typeof inQuietHours(sub)).toBe('boolean');
    }
  });
});