import { KalshiPublicMarketDataError } from "./errors.ts";
import {
  listMarkets,
  normalizeMarket,
  normalizeOrderbook,
  record,
  text,
  type MarketDataReader,
} from "./market-data.ts";

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
    const raw = record(
      await this.request(
        `/trade-api/v2/markets/${encodeURIComponent(text(ticker))}`,
      ),
    );
    return normalizeMarket(raw.market);
  }
  async getOrderbook(ticker: string) {
    return normalizeOrderbook(
      await this.request(
        `/trade-api/v2/markets/${encodeURIComponent(text(ticker))}/orderbook`,
      ),
    );
  }
  private async request(path: string): Promise<unknown> {
    const url = new URL(path, "https://external-api.kalshi.com");
    if (
      url.origin !== "https://external-api.kalshi.com" ||
      !/^\/trade-api\/v2\/markets(?:\/[A-Za-z0-9%._-]+(?:\/orderbook)?)?$/.test(
        url.pathname,
      )
    ) {
      throw new Error("Blocked non-market public request.");
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
