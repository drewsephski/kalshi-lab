import { KalshiPublicMarketDataError } from "./errors.ts";
import {
  listMarkets,
  normalizeMarket,
  normalizeOrderbook,
  record,
  type MarketDataReader,
} from "./market-data.ts";
import { normalizeTradePage } from "./public-trades.ts";
import {
  normalizePublicEventFee,
  normalizePublicEventFeeChange,
  normalizePublicSeriesFee,
} from "./public-fees.ts";

function ticker(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,200}$/.test(value))
    throw new Error("Invalid public market ticker.");
  return value;
}

/** Credential-free GET-only transport; never shares the authenticated client. */
export class KalshiPublicMarketDataClient implements MarketDataReader {
  readonly source = "kalshi_production_public" as const;
  private readonly fetchImplementation: typeof globalThis.fetch;

  constructor(options: { fetch?: typeof globalThis.fetch } = {}) {
    if (Object.keys(options).some((key) => key !== "fetch")) {
      throw new Error(
        "Public market data accepts no credentials or custom origin.",
      );
    }
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }
  listMarkets(options: { limit?: number; cursor?: string } = {}) {
    return listMarkets((path) => this.request(path), options);
  }
  async getMarket(ticker: string) {
    const raw = record(await this.request(`/trade-api/v2/markets/${ticker}`));
    const market = normalizeMarket(raw.market);
    if (market.ticker !== ticker)
      throw new Error("Market response ticker mismatch.");
    return market;
  }
  async getOrderbook(ticker: string) {
    return normalizeOrderbook(
      await this.request(`/trade-api/v2/markets/${ticker}/orderbook`),
    );
  }
  async listTrades(options: {
    ticker: string;
    limit?: number;
    cursor?: string;
    minTs?: number;
    maxTs?: number;
    isBlockTrade?: boolean;
  }) {
    const limit = options.limit ?? 1000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("Invalid trade page size.");
    const query = new URLSearchParams({
      ticker: ticker(options.ticker),
      limit: String(limit),
    });
    if (options.cursor) query.set("cursor", options.cursor);
    for (const [name, value] of [
      ["min_ts", options.minTs],
      ["max_ts", options.maxTs],
    ] as const)
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 0)
          throw new Error("Invalid trade timestamp filter.");
        query.set(name, String(value));
      }
    if (options.isBlockTrade !== undefined)
      query.set("is_block_trade", String(options.isBlockTrade));
    return normalizeTradePage(
      await this.request(`/trade-api/v2/markets/trades?${query}`),
    );
  }
  async getEvent(eventTicker: string) {
    const raw = record(
      await this.request(`/trade-api/v2/events/${ticker(eventTicker)}`),
    );
    const event = normalizePublicEventFee(raw.event);
    if (event.eventTicker !== eventTicker)
      throw new Error("Event response ticker mismatch.");
    return event;
  }
  async getSeries(seriesTicker: string) {
    const raw = record(
      await this.request(`/trade-api/v2/series/${ticker(seriesTicker)}`),
    );
    const series = normalizePublicSeriesFee(raw.series);
    if (series.seriesTicker !== seriesTicker)
      throw new Error("Series response ticker mismatch.");
    return series;
  }
  async listEventFeeChanges(eventTicker: string, cursor?: string) {
    const query = new URLSearchParams({
      event_ticker: ticker(eventTicker),
      limit: "1000",
    });
    if (cursor) query.set("cursor", cursor);
    const raw = record(
      await this.request(`/trade-api/v2/events/fee_changes?${query}`),
    );
    if (
      !Array.isArray(raw.event_fee_changes) ||
      raw.event_fee_changes.length > 1000
    )
      throw new Error("Invalid event fee changes.");
    return {
      changes: raw.event_fee_changes.map(normalizePublicEventFeeChange),
      cursor: typeof raw.cursor === "string" && raw.cursor ? raw.cursor : null,
    };
  }
  private async request(path: string): Promise<unknown> {
    const url = new URL(path, "https://external-api.kalshi.com");
    if (
      url.origin !== "https://external-api.kalshi.com" ||
      !/^\/trade-api\/v2\/(?:markets(?:\/(?:trades|[A-Za-z0-9%._-]+(?:\/orderbook)?))?|events\/(?:fee_changes|[A-Za-z0-9%._-]+)|series\/[A-Za-z0-9%._-]+)$/.test(
        url.pathname,
      )
    ) {
      throw new Error("Blocked non-public market data request.");
    }
    const response = await this.fetchImplementation(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new KalshiPublicMarketDataError(response.status);
    return response.json();
  }
}
