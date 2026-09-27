import { randomUUID } from "node:crypto";
import {
  decimal,
  units,
  type MarketDataSource,
  type MarketState,
  type MarketMetadata,
} from "@kalshi-lab/kalshi";
import type { MarketInput, SnapshotInput } from "@kalshi-lab/db";

export function marketInput(
  market: MarketMetadata,
  source: MarketDataSource,
  observedAt: Date,
): MarketInput {
  return {
    source,
    ticker: market.ticker,
    eventTicker: market.eventTicker,
    title: market.title,
    subtitle: market.subtitle,
    status: market.status,
    openTime: market.openTime,
    closeTime: market.closeTime,
    expirationTime: market.expirationTime,
    metadata: market.metadata,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
  };
}
export function buildSnapshot(
  state: MarketState,
  context: {
    marketId: string;
    runId: string;
    source: MarketDataSource;
    observedAt: Date;
    staleMs: number;
    connected: boolean;
    transport: "websocket" | "rest";
  },
): SnapshotInput {
  const { marketId, runId, source, observedAt, staleMs, connected, transport } =
    context;
  const book = state.currentBook();
  const yes = book?.yes.slice(0, 10) ?? [];
  const no = book?.no.slice(0, 10) ?? [];
  const stale =
    !connected ||
    !state.bookVerifiedAt ||
    observedAt.getTime() - state.bookVerifiedAt.getTime() > staleMs ||
    observedAt.getTime() - state.tickerReceivedAt.getTime() > staleMs;
  const quote = state.executableQuote();
  // A late known close must not be mislabeled as an active executable market.
  const status =
    state.market.closeTime &&
    state.market.closeTime <= observedAt &&
    ["open", "active"].includes(state.market.status)
      ? "closed"
      : state.market.status;
  return {
    id: randomUUID(),
    marketId,
    workerRunId: runId,
    source,
    observedAt,
    tickerReceivedAt: state.tickerReceivedAt,
    bookReceivedAt: state.bookReceivedAt,
    bookVerifiedAt: state.bookVerifiedAt,
    exchangeTimestamp: state.eventAt,
    status,
    transport,
    connected,
    stale,
    yesBid: quote.yesBid,
    yesAsk: quote.yesAsk,
    noBid: quote.noBid,
    noAsk: quote.noAsk,
    lastPrice: quote.lastPrice,
    yesBidSize: quote.yesBidSize,
    yesAskSize: quote.yesAskSize,
    noBidSize: quote.noBidSize,
    noAskSize: quote.noAskSize,
    volume: quote.volume,
    openInterest: quote.openInterest,
    supplemental: {
      depth: {
        yesTop10: yes,
        noTop10: no,
        yesLevelCount: book?.yes.length ?? null,
        noLevelCount: book?.no.length ?? null,
        yesTop10Quantity: decimal(
          yes.reduce((sum, level) => sum + units(level[1], 2), 0n),
          2,
        ),
        noTop10Quantity: decimal(
          no.reduce((sum, level) => sum + units(level[1], 2), 0n),
          2,
        ),
      },
      tickerQuote: {
        yesBid: state.quote.yesBid,
        yesAsk: state.quote.yesAsk,
        yesBidSize: state.quote.yesBidSize,
        yesAskSize: state.quote.yesAskSize,
      },
      lastTrade: state.lastTrade,
    },
  };
}
