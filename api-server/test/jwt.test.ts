import { describe, it, expect } from 'vitest';
import type { User } from '../src/shared/types.js';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

interface JwtPayload {
  sub: string;
  platform: 'ios' | 'android';
  type: 'anonymous';
  iat: number;
  exp: number;
}

function shouldRefreshToken(payload: JwtPayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = payload.exp - now;
  return timeUntilExpiry < SEVEN_DAYS_SECONDS && timeUntilExpiry > 0;
}

describe('shouldRefreshToken', () => {
  it('returns true when token is within 7 days of expiry', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: 'anon_123',
      platform: 'ios',
      type: 'anonymous',
      iat: now - 23 * 24 * 60 * 60,
      exp: now + 6 * 24 * 60 * 60,
    };

    expect(shouldRefreshToken(payload)).toBe(true);
  });

  it('returns false when token has more than 7 days until expiry', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: 'anon_123',
      platform: 'ios',
      type: 'anonymous',
      iat: now - 10 * 24 * 60 * 60,
      exp: now + 20 * 24 * 60 * 60,
    };

    expect(shouldRefreshToken(payload)).toBe(false);
  });

  it('returns false when token is already expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: 'anon_123',
      platform: 'ios',
      type: 'anonymous',
      iat: now - 40 * 24 * 60 * 60,
      exp: now - 10 * 24 * 60 * 60,
    };

    expect(shouldRefreshToken(payload)).toBe(false);
  });

  it('returns false when token expires in exactly 7 days', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: 'anon_123',
      platform: 'ios',
      type: 'anonymous',
      iat: now - 23 * 24 * 60 * 60,
      exp: now + 7 * 24 * 60 * 60,
    };

    expect(shouldRefreshToken(payload)).toBe(false);
  });

  it('returns true when token expires in 7 days minus 1 second', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: 'anon_123',
      platform: 'ios',
      type: 'anonymous',
      iat: now - 23 * 24 * 60 * 60,
      exp: now + 7 * 24 * 60 * 60 - 1,
    };

    expect(shouldRefreshToken(payload)).toBe(true);
  });
});

describe('User type', () => {
  it('accepts valid anonymous user', () => {
    const user: User = {
      _id: 'anon_123',
      type: 'anonymous',
      platform: 'ios',
      createdAt: new Date(),
      lastSeenAt: new Date(),
    };

    expect(user._id).toBe('anon_123');
    expect(user.type).toBe('anonymous');
  });

  it('accepts valid user type', () => {
    const user: User = {
      _id: 'user_456',
      type: 'user',
      platform: 'android',
      createdAt: new Date(),
      lastSeenAt: new Date(),
    };

    expect(user._id).toBe('user_456');
    expect(user.type).toBe('user');
  });
});