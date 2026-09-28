import type { Observation } from "./microstructure.ts";
import { fixed } from "./spread.ts";

export interface EvidenceTrade {
  tradeId: string;
  ticker: string;
  executedAt: Date;
  yesPrice: string;
  quantity: string;
  aggressorSide: "yes_exposure" | "no_exposure" | "unknown";
  sideProvenance: "provider_explicit" | "unknown";
  isBlockTrade: boolean;
}
export interface EvidenceBook extends Observation {
  bookReceivedAt: Date | null;
  yesBidSize: string | null;
  yesAskSize: string | null;
}
export interface BookMatch {
  pre: EvidenceBook | null;
  post: EvidenceBook | null;
  preDelayMs: number | null;
  postDelayMs: number | null;
  relation:
    | "trade_at_pre_ask"
    | "trade_at_pre_bid"
    | "trade_above_pre_ask"
    | "trade_below_pre_bid"
    | "inside_spread"
    | "ambiguous"
    | "unmatched";
}

export function alignTrade(
  trade: EvidenceTrade,
  books: readonly EvidenceBook[],
  toleranceMs = 7500,
): BookMatch {
  if (!Number.isSafeInteger(toleranceMs) || toleranceMs < 0)
    throw new Error("Invalid book tolerance.");
  const time = trade.executedAt.getTime();
  let pre: EvidenceBook | null = null,
    post: EvidenceBook | null = null;
  for (const book of books) {
    const at = book.bookReceivedAt?.getTime();
    if (
      at === undefined ||
      !Number.isFinite(at) ||
      book.stale ||
      !book.connected ||
      !["open", "active"].includes(book.status) ||
      book.yesBid === null ||
      book.yesAsk === null ||
      book.yesBidSize === null ||
      book.yesAskSize === null
    )
      continue;
    if (
      at <= time &&
      time - at <= toleranceMs &&
      (!pre || at > pre.bookReceivedAt!.getTime())
    )
      pre = book;
    if (
      at >= time &&
      at - time <= toleranceMs &&
      (!post || at < post.bookReceivedAt!.getTime())
    )
      post = book;
  }
  if (pre && post && pre.id === post.id) post = null;
  let relation: BookMatch["relation"] = "unmatched";
  if (pre) {
    const price = fixed(trade.yesPrice, 4),
      bid = fixed(pre.yesBid!, 4),
      ask = fixed(pre.yesAsk!, 4);
    relation =
      bid > ask
        ? "ambiguous"
        : price === ask
          ? "trade_at_pre_ask"
          : price === bid
            ? "trade_at_pre_bid"
            : price > ask
              ? "trade_above_pre_ask"
              : price < bid
                ? "trade_below_pre_bid"
                : price > bid && price < ask
                  ? "inside_spread"
                  : "ambiguous";
  }
  return {
    pre,
    post,
    preDelayMs: pre ? time - pre.bookReceivedAt!.getTime() : null,
    postDelayMs: post ? post.bookReceivedAt!.getTime() - time : null,
    relation,
  };
}

export interface QueueEvidence {
  queueConsumed: string;
  queueFullyConsumed: boolean;
  ourFillReached: boolean;
  supportingTradeIds: string[];
  unknownReason: string | null;
}

export function queueConsumption(input: {
  queueAhead: string | null;
  orderedTrades: readonly EvidenceTrade[];
  limitPrice: string;
  side: "yes_buy" | "yes_sell";
  activationTime: Date;
  expiryTime: Date;
}): QueueEvidence {
  const { queueAhead, orderedTrades, side } = input;
  const limit = fixed(input.limitPrice, 4);
  if (input.expiryTime <= input.activationTime)
    throw new Error("Invalid order window.");
  if (queueAhead === null)
    return {
      queueConsumed: "0.00",
      queueFullyConsumed: false,
      ourFillReached: false,
      supportingTradeIds: [],
      unknownReason: "queue_ahead_unknown",
    };
  const ahead = fixed(queueAhead, 2);
  const ids = new Set<string>();
  let consumed = 0n,
    previous = -Infinity;
  for (const trade of orderedTrades) {
    const time = trade.executedAt.getTime();
    if (time < previous) throw new Error("Trades must be timestamp ordered.");
    previous = time;
    if (
      time < input.activationTime.getTime() ||
      time >= input.expiryTime.getTime() ||
      trade.isBlockTrade ||
      trade.sideProvenance !== "provider_explicit" ||
      ids.has(trade.tradeId)
    )
      continue;
    const price = fixed(trade.yesPrice, 4);
    if (
      (side === "yes_buy" && trade.aggressorSide !== "no_exposure") ||
      (side === "yes_sell" && trade.aggressorSide !== "yes_exposure") ||
      (side === "yes_buy" && price > limit) ||
      (side === "yes_sell" && price < limit)
    )
      continue;
    ids.add(trade.tradeId);
    consumed += fixed(trade.quantity, 2);
  }
  return {
    queueConsumed: `${consumed / 100n}.${(consumed % 100n).toString().padStart(2, "0")}`,
    queueFullyConsumed: ids.size > 0 && consumed >= ahead,
    ourFillReached: consumed >= ahead + 100n,
    supportingTradeIds: [...ids],
    unknownReason: ids.size ? null : "no_relevant_directed_executions",
  };
}

export interface FeeEvidence {
  eventTicker: string | null;
  seriesTicker: string;
  observedAt: Date;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  feeType: string | null;
  makerMultiplier: string | null;
  takerMultiplier: string | null;
  sourceType: string;
}
export function classifyFeeWindow(
  rules: readonly FeeEvidence[],
  eventTicker: string,
  from: Date,
  to: Date,
): "fee_known" | "fee_unknown" | "fee_conflicting" {
  if (to < from) throw new Error("Invalid fee context window.");
  const applicable = rules.filter(
    (r) =>
      r.eventTicker === eventTicker &&
      r.effectiveFrom &&
      r.effectiveFrom <= from &&
      r.effectiveTo &&
      r.effectiveTo > to &&
      r.makerMultiplier !== null &&
      r.takerMultiplier !== null,
  );
  if (!applicable.length) return "fee_unknown";
  const distinct = new Set(
    applicable.map(
      (r) => `${r.feeType}:${r.makerMultiplier}:${r.takerMultiplier}`,
    ),
  );
  return distinct.size === 1 ? "fee_known" : "fee_conflicting";
}
