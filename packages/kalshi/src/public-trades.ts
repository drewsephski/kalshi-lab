import { complement, count, price, units } from "./decimal.ts";
import { record, text } from "./market-data.ts";

export interface PublicTrade {
  tradeId: string;
  ticker: string;
  executedAt: Date;
  yesPrice: string;
  noPrice: string;
  quantity: string;
  takerOutcomeSide: "yes" | "no" | null;
  takerBookSide: "bid" | "ask" | null;
  aggressorSide: "yes_buy" | "no_buy" | "unknown";
  aggressorProvenance: "provider_explicit" | "unknown";
  isBlockTrade: boolean;
  rawMetadata: Record<string, unknown>;
}

export function normalizePublicTrade(value: unknown): PublicTrade {
  const raw = record(value);
  const yesPrice = price(raw.yes_price_dollars);
  const noPrice =
    raw.no_price_dollars === undefined
      ? complement(yesPrice)!
      : price(raw.no_price_dollars);
  if (units(yesPrice, 4) + units(noPrice, 4) !== 10_000n)
    throw new Error("Trade prices are not complements.");
  const quantity = count(raw.count_fp);
  if (units(quantity, 2) <= 0n)
    throw new Error("Trade quantity must be positive.");
  const executedAt = new Date(text(raw.created_time));
  if (!Number.isFinite(executedAt.getTime()))
    throw new Error("Invalid trade timestamp.");
  const outcome =
    raw.taker_outcome_side === "yes" || raw.taker_outcome_side === "no"
      ? raw.taker_outcome_side
      : null;
  const book =
    raw.taker_book_side === "bid" || raw.taker_book_side === "ask"
      ? raw.taker_book_side
      : null;
  // OpenAPI: bid == YES exposure; ask == NO exposure. Legacy taker_side is ignored.
  const explicit =
    outcome !== null &&
    book !== null &&
    ((outcome === "yes" && book === "bid") ||
      (outcome === "no" && book === "ask"));
  if (typeof raw.is_block_trade !== "boolean")
    throw new Error("Missing block flag.");
  return {
    tradeId: text(raw.trade_id),
    ticker: text(raw.ticker),
    executedAt,
    yesPrice,
    noPrice,
    quantity,
    takerOutcomeSide: outcome,
    takerBookSide: book,
    aggressorSide: explicit
      ? outcome === "yes"
        ? "yes_buy"
        : "no_buy"
      : "unknown",
    aggressorProvenance: explicit ? "provider_explicit" : "unknown",
    isBlockTrade: raw.is_block_trade,
    rawMetadata: raw,
  };
}

export function normalizeTradePage(value: unknown): {
  trades: PublicTrade[];
  cursor: string | null;
} {
  const raw = record(value);
  if (!Array.isArray(raw.trades) || raw.trades.length > 1000)
    throw new Error("Invalid trade page.");
  const trades = raw.trades.map(normalizePublicTrade);
  for (let i = 1; i < trades.length; i++)
    if (trades[i]!.executedAt > trades[i - 1]!.executedAt)
      throw new Error("Trade page is not newest first.");
  return {
    trades,
    cursor: typeof raw.cursor === "string" && raw.cursor ? raw.cursor : null,
  };
}

export interface PublicFeeMetadata {
  raw: Record<string, unknown>;
  observedAt: Date;
  sourceUrl: string;
}
