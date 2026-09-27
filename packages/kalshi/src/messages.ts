import { count, price, units } from "./decimal.ts";
import {
  normalizeLevels,
  normalizeQuote,
  record,
  text,
  type Orderbook,
  type MarketQuote,
} from "./market-data.ts";

export type MarketMessage =
  | { type: "ticker"; ticker: string; quote: MarketQuote; eventAt: Date | null }
  | {
      type: "orderbook_snapshot";
      ticker: string;
      book: Orderbook;
      sid: number;
      seq: number;
    }
  | {
      type: "orderbook_delta";
      ticker: string;
      price: string;
      delta: bigint;
      side: "yes" | "no";
      eventAt: Date | null;
      sid: number;
      seq: number;
    }
  | {
      type: "trade";
      ticker: string;
      tradeId: string;
      price: string;
      quantity: string;
      takerSide: string | null;
      eventAt: Date | null;
      sid: number;
      seq: number;
    };
export type ParsedMessage =
  | { kind: "event"; event: MarketMessage }
  | { kind: "subscribed"; channel: string; sid: number }
  | { kind: "error"; code: string }
  | { kind: "ignored" }
  | { kind: "malformed"; bookUnsafe: boolean };
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid stream sequence.");
  return value;
}
function timestamp(raw: Record<string, unknown>): Date | null {
  if (raw.ts_ms === undefined) return null;
  const result = new Date(integer(raw.ts_ms));
  if (!Number.isFinite(result.getTime()))
    throw new Error("Invalid stream timestamp.");
  return result;
}

/** Unknown/control payloads are harmless; malformed book packets require a resync. */
export function parseMarketMessage(payload: string): ParsedMessage {
  let bookUnsafe = false;
  try {
    const envelope = record(JSON.parse(payload) as unknown);
    const type = envelope.type;
    bookUnsafe = type === "orderbook_delta" || type === "orderbook_snapshot";
    if (type === "subscribed") {
      const msg = record(envelope.msg);
      return {
        kind: "subscribed",
        channel: text(msg.channel),
        sid: integer(msg.sid),
      };
    }
    if (type === "error")
      return {
        kind: "error",
        code: String(record(envelope.msg).code ?? "unknown"),
      };
    if (
      !["ticker", "orderbook_snapshot", "orderbook_delta", "trade"].includes(
        String(type),
      )
    )
      return { kind: "ignored" };
    const msg = record(envelope.msg);
    const ticker = text(msg.market_ticker);
    if (type === "ticker")
      return {
        kind: "event",
        event: {
          type,
          ticker,
          quote: normalizeQuote(msg, true),
          eventAt: timestamp(msg),
        },
      };
    const sid = integer(envelope.sid);
    const seq = integer(envelope.seq);
    if (type === "orderbook_snapshot") {
      return {
        kind: "event",
        event: {
          type,
          ticker,
          sid,
          seq,
          book: {
            yes: normalizeLevels(msg.yes_dollars_fp),
            no: normalizeLevels(msg.no_dollars_fp),
          },
        },
      };
    }
    if (type === "orderbook_delta") {
      if (msg.side !== "yes" && msg.side !== "no")
        throw new Error("Invalid book side.");
      const delta = units(msg.delta_fp, 2, true);
      if (delta <= -(10n ** 24n) || delta >= 10n ** 24n)
        throw new Error("Delta exceeds storage precision.");
      return {
        kind: "event",
        event: {
          type,
          ticker,
          sid,
          seq,
          price: price(msg.price_dollars),
          delta,
          side: msg.side,
          eventAt: timestamp(msg),
        },
      };
    }
    return {
      kind: "event",
      event: {
        type: "trade",
        ticker,
        sid,
        seq,
        tradeId: text(msg.trade_id),
        price: price(msg.yes_price_dollars),
        quantity: count(msg.count_fp),
        takerSide:
          typeof msg.taker_outcome_side === "string"
            ? msg.taker_outcome_side
            : null,
        eventAt: timestamp(msg),
      },
    };
  } catch {
    return { kind: "malformed", bookUnsafe };
  }
}

/** Kalshi sequence numbers are scoped to subscription IDs, not individual markets. */
export class SequenceTracker {
  private readonly sequences = new Map<number, number>();
  accept(sid: number, seq: number): "accept" | "duplicate" | "gap" {
    const previous = this.sequences.get(sid);
    if (previous !== undefined && seq <= previous) return "duplicate";
    if (previous !== undefined && seq !== previous + 1) return "gap";
    this.sequences.set(sid, seq);
    return "accept";
  }
}
