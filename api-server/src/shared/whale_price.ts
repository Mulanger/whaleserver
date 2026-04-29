interface WhalePriceSource {
  priceMillicents?: unknown;
  raw?: {
    price?: unknown;
  };
  usdSize?: unknown;
  shares?: unknown;
  priceCents?: unknown;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function resolvePriceMillicents(doc: WhalePriceSource): number {
  const storedMillicents = finiteNumber(doc.priceMillicents);
  if (storedMillicents != null) return storedMillicents;

  const rawPrice = finiteNumber(doc.raw?.price);
  if (rawPrice != null) return Math.round(rawPrice * 10000);

  const usdSize = finiteNumber(doc.usdSize);
  const shares = finiteNumber(doc.shares);
  if (usdSize != null && shares != null && shares > 0) {
    return Math.round((usdSize / shares) * 10000);
  }

  const priceCents = finiteNumber(doc.priceCents);
  return Math.round((priceCents ?? 0) * 100);
}

export function withPriceMillicents<T extends WhalePriceSource>(whale: T): T & { priceMillicents: number } {
  return {
    ...whale,
    priceMillicents: resolvePriceMillicents(whale),
  };
}
