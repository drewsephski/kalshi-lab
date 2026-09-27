import {
  units,
  type MarketDataReader,
  type MarketMetadata,
} from "@kalshi-lab/kalshi";
import type { RecorderConfig } from "./config.ts";

export function isOpen(market: MarketMetadata, now: Date): boolean {
  return (
    ["active", "open"].includes(market.status) &&
    (!market.openTime || market.openTime <= now) &&
    (!market.closeTime || market.closeTime > now) &&
    (market.metadata.market_type === undefined ||
      market.metadata.market_type === "binary") &&
    (market.metadata.notional_value_dollars === undefined ||
      units(market.metadata.notional_value_dollars, 4) === 10_000n)
  );
}
export function selectMarkets(
  markets: MarketMetadata[],
  max: number,
  now: Date,
): MarketMetadata[] {
  const unique = new Map<string, MarketMetadata>();
  for (const market of markets)
    if (isOpen(market, now) && !unique.has(market.ticker))
      unique.set(market.ticker, market);
  return [...unique.values()]
    .sort((a, b) => {
      for (const metric of ["volume24h", "volume", "openInterest"] as const) {
        const left = units(a[metric] ?? "0.00", 2);
        const right = units(b[metric] ?? "0.00", 2);
        if (left !== right) return left > right ? -1 : 1;
      }
      return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
    })
    .slice(0, max);
}
export async function discoverMarkets(
  reader: MarketDataReader,
  config: RecorderConfig,
  now = new Date(),
): Promise<MarketMetadata[]> {
  if (config.tickers.length) {
    const markets: MarketMetadata[] = [];
    for (const ticker of config.tickers) {
      const market = await reader.getMarket(ticker);
      if (market.ticker !== ticker || !isOpen(market, now))
        throw new Error("Explicit market is not an open $1 binary market.");
      markets.push(market);
    }
    return markets;
  }
  const candidates: MarketMetadata[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  // Deliberate bounded candidate pool, not an exchange-wide liquidity ranking.
  for (let page = 0; page < 3; page++) {
    const result = await reader.listMarkets({
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    candidates.push(...result.markets);
    if (!result.cursor || cursors.has(result.cursor)) break;
    cursors.add(result.cursor);
    cursor = result.cursor;
  }
  return selectMarkets(candidates, config.maxMarkets, now);
}
