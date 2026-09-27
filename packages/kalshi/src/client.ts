import { randomUUID, type KeyObject } from "node:crypto";
import { signRequest } from "./auth.ts";
import { loadKalshiPrivateKey, parseKalshiConfig } from "./config.ts";
import { KalshiApiError, KalshiConfigError } from "./errors.ts";
import type {
  CreateOrderInput,
  CreatedOrder,
  KalshiBalance,
  KalshiConfig,
  KalshiMarket,
  KalshiOrder,
} from "./types.ts";

const DEMO_ORIGIN = "https://external-api.demo.kalshi.co";
const API_PREFIX = "/trade-api/v2/";
const REQUEST_TIMEOUT_MS = 15_000;

interface ClientOptions {
  fetch?: typeof globalThis.fetch;
  privateKey?: KeyObject;
  now?: () => number;
  newClientOrderId?: () => string;
}

interface BalanceResponse {
  balance: number;
  balance_dollars: string;
  portfolio_value: number;
  updated_ts: number;
}

interface MarketsResponse {
  markets: Array<{ ticker: string; title: string; status?: string }>;
}

interface CreateOrderResponse {
  order_id: string;
  client_order_id: string;
  fill_count: string;
  remaining_count: string;
}

interface GetOrderResponse {
  order: {
    order_id: string;
    client_order_id: string;
    ticker: string;
    status: string;
    remaining_count_fp?: string;
    fill_count_fp?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Kalshi response is missing a valid ${field}.`);
  }
  return value;
}

function requireDollarAmount(value: unknown, field: string): string {
  const amount = requireString(value, field);
  if (!/^\d+(?:\.\d+)?$/.test(amount) || !Number.isFinite(Number(amount))) {
    throw new Error(`Kalshi response contains an invalid ${field}.`);
  }
  return amount;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Kalshi response is missing a valid ${field}.`);
  }
  return value;
}

export function generateClientOrderId(): string {
  return randomUUID();
}

export class KalshiClient {
  private readonly apiKeyId: string;
  private readonly privateKey: KeyObject;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly newClientOrderId: () => string;

  constructor(config: KalshiConfig, options: ClientOptions = {}) {
    if (config.environment !== "demo") {
      throw new KalshiConfigError(
        "Only the Kalshi demo environment is supported.",
      );
    }
    this.apiKeyId = config.apiKeyId;
    this.privateKey =
      options.privateKey ?? loadKalshiPrivateKey(config.privateKeyPath);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.newClientOrderId = options.newClientOrderId ?? generateClientOrderId;
  }

  async getBalance(): Promise<KalshiBalance> {
    const response = await this.request<BalanceResponse>(
      "GET",
      `${API_PREFIX}portfolio/balance`,
    );
    return {
      balanceCents: requireFiniteNumber(response.balance, "balance"),
      balanceDollars: requireDollarAmount(
        response.balance_dollars,
        "balance_dollars",
      ),
      portfolioValueCents: requireFiniteNumber(
        response.portfolio_value,
        "portfolio_value",
      ),
      updatedAtMs: requireFiniteNumber(response.updated_ts, "updated_ts"),
    };
  }

  async getMarkets(options: { limit?: number } = {}): Promise<KalshiMarket[]> {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new RangeError(
        "Market limit must be an integer between 1 and 200.",
      );
    }
    const query = new URLSearchParams({ status: "open", limit: String(limit) });
    const response = await this.request<MarketsResponse>(
      "GET",
      `${API_PREFIX}markets?${query.toString()}`,
    );
    if (!Array.isArray(response.markets)) {
      throw new Error("Kalshi response is missing the markets list.");
    }
    return response.markets.map((market) => ({
      ticker: requireString(market.ticker, "market ticker"),
      title: requireString(market.title, "market title"),
      ...(typeof market.status === "string" ? { status: market.status } : {}),
    }));
  }

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    if (!input.ticker.trim()) throw new Error("Market ticker is required.");
    if (input.outcomeSide !== "yes" || input.action !== "buy") {
      throw new Error("The smoke client only supports buying YES contracts.");
    }
    if (input.quantity !== 1) {
      throw new Error("The smoke client is limited to exactly 1 contract.");
    }
    if (
      !Number.isInteger(input.limitPriceCents) ||
      input.limitPriceCents < 1 ||
      input.limitPriceCents > 99
    ) {
      throw new RangeError(
        "Limit price must be a whole number of cents from 1 to 99.",
      );
    }

    const clientOrderId = this.newClientOrderId();
    const price = (input.limitPriceCents / 100).toFixed(4);
    const response = await this.request<CreateOrderResponse>(
      "POST",
      `${API_PREFIX}portfolio/events/orders`,
      {
        ticker: input.ticker,
        client_order_id: clientOrderId,
        side: "bid",
        count: "1.00",
        price,
        time_in_force: "good_till_canceled",
        self_trade_prevention_type: "taker_at_cross",
        post_only: true,
        cancel_order_on_pause: true,
      },
    );
    return {
      orderId: requireString(response.order_id, "order_id"),
      clientOrderId: requireString(response.client_order_id, "client_order_id"),
      remainingCount: requireString(
        response.remaining_count,
        "remaining_count",
      ),
      filledCount: requireString(response.fill_count, "fill_count"),
    };
  }

  async getOrder(orderId: string): Promise<KalshiOrder> {
    const response = await this.request<GetOrderResponse>(
      "GET",
      `${API_PREFIX}portfolio/orders/${encodeURIComponent(orderId)}`,
    );
    if (!isRecord(response.order)) {
      throw new Error("Kalshi response is missing the order.");
    }
    return {
      orderId: requireString(response.order.order_id, "order_id"),
      clientOrderId: requireString(
        response.order.client_order_id,
        "client_order_id",
      ),
      ticker: requireString(response.order.ticker, "order ticker"),
      status: requireString(response.order.status, "order status"),
      remainingCount: requireString(
        response.order.remaining_count_fp,
        "remaining_count_fp",
      ),
      filledCount: requireString(response.order.fill_count_fp, "fill_count_fp"),
    };
  }

  async cancelOrder(orderId: string, marketTicker: string): Promise<void> {
    if (!marketTicker.trim()) {
      throw new Error(
        "Market ticker is required to safely route an order cancellation.",
      );
    }
    const query = new URLSearchParams({
      market_ticker: marketTicker,
      exchange_index: "-1",
    });
    await this.request(
      "DELETE",
      `${API_PREFIX}portfolio/events/orders/${encodeURIComponent(orderId)}?${query.toString()}`,
    );
  }

  private async request<T = unknown>(
    method: string,
    pathWithQuery: string,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(pathWithQuery, DEMO_ORIGIN);
    if (
      url.origin !== DEMO_ORIGIN ||
      !url.pathname.startsWith(API_PREFIX) ||
      !["GET", "POST", "DELETE"].includes(method)
    ) {
      throw new Error(
        "Blocked unsafe Kalshi request; demo API route validation failed.",
      );
    }

    const timestamp = String(this.now());
    const signature = signRequest(
      this.privateKey,
      timestamp,
      method,
      url.pathname,
    );
    const headers = new Headers({
      "KALSHI-ACCESS-KEY": this.apiKeyId,
      "KALSHI-ACCESS-TIMESTAMP": timestamp,
      "KALSHI-ACCESS-SIGNATURE": signature,
    });
    if (body !== undefined) headers.set("content-type", "application/json");

    const response = await this.fetchImplementation(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    const text = await response.text();
    if (!response.ok) {
      throw new KalshiApiError(response.status, text.slice(0, 2_000));
    }
    if (!text) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `Kalshi returned invalid JSON for ${method} ${url.pathname}.`,
      );
    }
  }
}

export function createKalshiClient(
  env: NodeJS.ProcessEnv = process.env,
  options: ClientOptions = {},
): KalshiClient {
  return new KalshiClient(parseKalshiConfig(env), options);
}
