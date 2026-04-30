import type { WhaleDto } from './types.js';
import { withPriceMillicents } from './whale_price.js';

type RedisWhaleMessage = Partial<WhaleDto> & {
  _id?: unknown;
  market?: Partial<NonNullable<WhaleDto['market']>> & {
    polymarketUrl?: unknown;
  };
};

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && 'toString' in value) {
    const stringValue = value.toString();
    return stringValue.length > 0 ? stringValue : undefined;
  }
  return undefined;
}

export function normalizeWhaleMessage(raw: unknown): WhaleDto | null {
  if (!raw || typeof raw !== 'object') return null;

  const message = raw as RedisWhaleMessage;
  const id = asString(message.id ?? message._id);
  if (!id) return null;

  return withPriceMillicents({
    ...message,
    id,
    market: message.market
      ? {
          slug: message.market.slug ?? '',
          title: message.market.title ?? 'Unknown',
          category: message.market.category ?? '',
        }
      : undefined,
    polymarketUrl: message.polymarketUrl ?? asString(message.market?.polymarketUrl) ?? '',
  } as WhaleDto);
}
