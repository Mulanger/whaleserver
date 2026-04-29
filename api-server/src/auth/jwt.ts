import type { FastifyInstance } from 'fastify';
import type { User, MobilePlatform } from '../shared/types.js';
import { config } from '../config.js';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export interface JwtPayload {
  sub: string;
  platform: MobilePlatform;
  type: 'anonymous' | 'user';
  iat: number;
  exp: number;
}

export function issueToken(fastify: FastifyInstance, user: User): string {
  return fastify.jwt.sign({
    sub: user._id,
    platform: user.platform,
    type: user.type,
  });
}

export function issueTokenFromPayload(
  fastify: FastifyInstance,
  payload: Pick<JwtPayload, 'sub' | 'platform' | 'type'>
): string {
  return fastify.jwt.sign(payload);
}

export function verifyToken(fastify: FastifyInstance, token: string): JwtPayload {
  try {
    return fastify.jwt.verify<JwtPayload>(token);
  } catch (e) {
    if (config.JWT_PREVIOUS_SECRET) {
      return fastify.jwt.verify<JwtPayload>(token, {
        secret: config.JWT_PREVIOUS_SECRET,
      });
    }
    throw e;
  }
}

export function extractUserId(payload: JwtPayload): string {
  return payload.sub;
}

export function shouldRefreshToken(payload: JwtPayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = payload.exp - now;
  return timeUntilExpiry < SEVEN_DAYS_SECONDS && timeUntilExpiry > 0;
}
