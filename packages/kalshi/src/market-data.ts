import { complement, count, price } from "./decimal.ts";

export type MarketDataSource = "kalshi_demo" | "kalshi_production_public";
export type Level = readonly [price: string, quantity: string];
export interface Orderbook {
  yes: Level[];
  no: Level[];
}
export interface MarketQuote {
  yesBid: string | null;
  yesAsk: string | null;
  noBid: string | null;
  noAsk: string | null;
  yesBidSize: string | null;
  yesAskSize: string | null;
  lastPrice: string | null;
  volume: string | null;
  openInterest: string | null;
}
export interface MarketMetadata extends MarketQuote {
  ticker: string;
  eventTicker: string | null;
  title: string;
  subtitle: string | null;
  status: string;
  openTime: Date | null;
  closeTime: Date | null;
  expirationTime: Date | null;
  volume24h: string | null;
  metadata: Record<string, unknown>;
}
export interface MarketDataReader {
  readonly source: MarketDataSource;
  listMarkets(options?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ markets: MarketMetadata[]; cursor: string | null }>;
  getMarket(ticker: string): Promise<MarketMetadata>;
  getOrderbook(ticker: string): Promise<Orderbook>;
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Expected a nonempty string.");
  return value;
}
function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function date(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const result = new Date(text(value));
  if (!Number.isFinite(result.getTime()))
    throw new Error("Invalid market timestamp.");
  return result;
}
function optionalDecimal(
  value: unknown,
  parser: (value: unknown) => string,
): string | null {
  return value === undefined || value === null || value === ""
    ? null
    : parser(value);
}

export function normalizeQuote(
  value: unknown,
  tickerUpdate = false,
): MarketQuote {
  const raw = record(value);
  const yesBid = optionalDecimal(raw.yes_bid_dollars, price);
  const yesAsk = optionalDecimal(raw.yes_ask_dollars, price);
  return {
    yesBid,
    yesAsk,
    noBid: optionalDecimal(raw.no_bid_dollars, price) ?? complement(yesAsk),
    noAsk: optionalDecimal(raw.no_ask_dollars, price) ?? complement(yesBid),
    yesBidSize: optionalDecimal(raw.yes_bid_size_fp, count),
    yesAskSize: optionalDecimal(raw.yes_ask_size_fp, count),
    lastPrice: optionalDecimal(
      tickerUpdate ? raw.price_dollars : raw.last_price_dollars,
      price,
    ),
    volume: optionalDecimal(raw.volume_fp, count),
    openInterest: optionalDecimal(raw.open_interest_fp, count),
  };
}

export function normalizeMarket(value: unknown): MarketMetadata {
  const raw = record(value);
  const ticker = text(raw.ticker);
  // title/subtitle are deprecated in the current API; retain a useful fallback.
  const metadata: Record<string, unknown> = {};
  for (const key of [
    "market_type",
    "notional_value_dollars",
    "yes_sub_title",
    "no_sub_title",
    "rules_primary",
    "rules_secondary",
    "price_level_structure",
    "price_ranges",
    "strike_type",
    "floor_strike",
    "cap_strike",
    "result",
    "updated_time",
  ]) {
    if (raw[key] !== undefined) metadata[key] = raw[key];
  }
  return {
    ticker,
    eventTicker: optionalText(raw.event_ticker),
    title: optionalText(raw.title) ?? optionalText(raw.yes_sub_title) ?? ticker,
    subtitle: optionalText(raw.subtitle),
    status: text(raw.status),
    openTime: date(raw.open_time),
    closeTime: date(raw.close_time),
    expirationTime: date(
      raw.latest_expiration_time ??
        raw.expected_expiration_time ??
        raw.expiration_time,
    ),
    volume24h: optionalDecimal(raw.volume_24h_fp, count),
    metadata,
    ...normalizeQuote(raw),
  };
}

export function normalizeLevels(value: unknown): Level[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10_001)
    throw new Error("Invalid orderbook levels.");
  const levels = new Map<string, string>();
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2)
      throw new Error("Invalid orderbook level.");
    const p = price(item[0]);
    const size = count(item[1]);
    if (size !== "0.00") levels.set(p, size);
  }
  return [...levels.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}
export function normalizeOrderbook(value: unknown): Orderbook {
  const raw = record(record(value).orderbook_fp);
  return {
    yes: normalizeLevels(raw.yes_dollars),
    no: normalizeLevels(raw.no_dollars),
  };
}

export async function listMarkets(
  request: (path: string) => Promise<unknown>,
  options: { limit?: number; cursor?: string } = {},
): Promise<{ markets: MarketMetadata[]; cursor: string | null }> {
  const limit = options.limit ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid discovery page size.");
  const query = new URLSearchParams({
    status: "open",
    limit: String(limit),
    mve_filter: "exclude",
  });
  if (options.cursor) query.set("cursor", options.cursor);
  const raw = record(await request(`/trade-api/v2/markets?${query}`));
  if (!Array.isArray(raw.markets)) throw new Error("Missing markets list.");
  return {
    markets: raw.markets.map(normalizeMarket),
    cursor: optionalText(raw.cursor),
  };
}
