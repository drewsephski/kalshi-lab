import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  KalshiPublicMarketDataClient,
  type PublicTrade,
} from "@kalshi-lab/kalshi";
import {
  createRecorderStore,
  createTradeStore,
  type FeeSnapshotInput,
  type TradeInput,
  type TradeStore,
} from "@kalshi-lab/db";
import type { createDatabase } from "@kalshi-lab/db";
import { readRecorderConfig } from "./config.ts";
import { marketInput } from "./snapshot.ts";
import { discoverMarkets } from "./universe.ts";
import { retry, errorCode } from "./retry.ts";

export const TRADE_COLLECTOR_VERSION = "trade-collector-v1";
export interface TradeCollectorOptions {
  reader: KalshiPublicMarketDataClient;
  db: ReturnType<typeof createDatabase>["db"];
  signal: AbortSignal;
  once: boolean;
  durationMs: number | null;
  gitCommit: string;
  gitDirty: boolean;
  log: (event: string, fields: Record<string, unknown>) => void;
  now?: () => Date;
}

export async function fetchTradeWindow(
  reader: KalshiPublicMarketDataClient,
  ticker: string,
  minTs: number,
  onPage?: () => void,
): Promise<PublicTrade[]> {
  const trades: PublicTrade[] = [];
  const ids = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | undefined;
  let oldestSeen = Infinity;
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const page = await retry(() =>
      reader.listTrades({
        ticker,
        limit: 1000,
        minTs,
        isBlockTrade: false,
        ...(cursor ? { cursor } : {}),
      }),
    );
    onPage?.();
    if (page.trades.length && page.trades[0]!.executedAt.getTime() > oldestSeen)
      throw new Error("Trade cursor page moved forward in time.");
    if (page.trades.length)
      oldestSeen = page.trades.at(-1)!.executedAt.getTime();
    for (const trade of page.trades) {
      if (trade.ticker !== ticker || trade.isBlockTrade)
        throw new Error("Trade filter mismatch.");
      if (ids.has(trade.tradeId)) continue;
      ids.add(trade.tradeId);
      trades.push(trade);
    }
    if (!page.cursor)
      return trades.sort(
        (a, b) =>
          a.executedAt.getTime() - b.executedAt.getTime() ||
          a.tradeId.localeCompare(b.tradeId),
      );
    if (cursors.has(page.cursor)) throw new Error("Repeated trade cursor.");
    cursors.add(page.cursor);
    cursor = page.cursor;
  }
  throw new Error("Trade pagination exceeded 20 pages; continuity unknown.");
}

function feeSnapshot(
  runId: string,
  observedAt: Date,
  sourceType: string,
  sourceUrl: string,
  eventTicker: string | null,
  seriesTicker: string,
  fee: {
    feeType: string | null;
    feeMultiplier: string | null;
    rawMetadata: Record<string, unknown>;
  },
  effectiveFrom: Date | null = null,
): FeeSnapshotInput {
  return {
    eventTicker,
    seriesTicker,
    observedAt,
    effectiveFrom,
    effectiveTo: null,
    feeType: fee.feeType,
    feeMultiplier: fee.feeMultiplier,
    makerMultiplier: null,
    takerMultiplier: null,
    sourceUrl,
    sourceType,
    rawMetadata: fee.rawMetadata,
    collectionRunId: runId,
  };
}

export async function collectTrades(
  options: TradeCollectorOptions,
): Promise<string> {
  const { reader, db, signal, log } = options;
  const now = options.now ?? (() => new Date());
  const config = readRecorderConfig({
    ...process.env,
    KALSHI_RECORDER_SOURCE: "production_public",
  });
  const recorderStore = createRecorderStore(db);
  const store: TradeStore = createTradeStore(db);
  const candidates = await retry(() => discoverMarkets(reader, config));
  if (!candidates.length)
    throw new Error("No public markets in bounded universe.");
  const selectedAt = now();
  const persisted = await recorderStore.upsertMarkets(
    candidates.map((m) => marketInput(m, reader.source, selectedAt)),
  );
  const marketIds = new Map(persisted.map((row) => [row.ticker, row.id]));
  if (marketIds.size !== candidates.length)
    throw new Error("Incomplete selected market persistence.");
  const runId = randomUUID();
  await store.startRun({
    id: runId,
    startedAt: selectedAt,
    heartbeatAt: selectedAt,
    status: "running",
    gitCommit: options.gitCommit,
    gitDirty: options.gitDirty,
    config: {
      version: TRADE_COLLECTOR_VERSION,
      tickers: candidates.map((m) => m.ticker),
      pollIntervalMs: 10_000,
      overlapMs: 1_000,
      once: options.once,
      durationMs: options.durationMs,
    },
  });
  log("trade_collector_started", {
    runId,
    tickers: candidates.map((m) => m.ticker),
    selectedAt: selectedAt.toISOString(),
  });
  let status: "completed" | "stopped" | "failed" = "stopped",
    error: string | null = null;
  let written = 0,
    duplicates = 0,
    paginationPages = 0;
  const watermark = new Map<string, Date>();
  try {
    const events = new Set(
      candidates
        .map((m) => m.eventTicker)
        .filter((e): e is string => Boolean(e)),
    );
    for (const eventTicker of events) {
      if (signal.aborted) break;
      const event = await retry(() => reader.getEvent(eventTicker));
      const seriesTicker = event.seriesTicker;
      const series = await retry(() => reader.getSeries(seriesTicker));
      const observedAt = now();
      const feeRows: FeeSnapshotInput[] = [
        feeSnapshot(
          runId,
          observedAt,
          "official_event_api",
          `https://external-api.kalshi.com/trade-api/v2/events/${eventTicker}`,
          eventTicker,
          seriesTicker,
          event,
        ),
        feeSnapshot(
          runId,
          observedAt,
          "official_series_api",
          `https://external-api.kalshi.com/trade-api/v2/series/${seriesTicker}`,
          null,
          seriesTicker,
          series,
        ),
        {
          eventTicker: null,
          seriesTicker,
          observedAt,
          effectiveFrom: new Date("2026-07-07T00:00:00Z"),
          effectiveTo: null,
          feeType: "quadratic",
          feeMultiplier: null,
          makerMultiplier: null,
          takerMultiplier: null,
          sourceUrl: "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
          sourceType: "official_fee_schedule",
          rawMetadata: {
            checkedAt: observedAt.toISOString(),
            effectiveDate: "2026-07-07",
            generalTakerFactor: "0.07",
            generalMakerFactor: "0.0175",
            exceptionStatus: "not_determined",
            historicalApplicability: "unknown",
          },
          collectionRunId: runId,
        },
      ];
      const feeCursors = new Set<string>();
      let feeCursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const changes = await retry(() =>
          reader.listEventFeeChanges(eventTicker, feeCursor),
        );
        for (const change of changes.changes) {
          if (
            change.eventTicker !== eventTicker ||
            change.seriesTicker !== seriesTicker
          )
            throw new Error("Event fee change ticker mismatch.");
          feeRows.push(
            feeSnapshot(
              runId,
              observedAt,
              "official_event_fee_change_api",
              `https://external-api.kalshi.com/trade-api/v2/events/fee_changes?event_ticker=${encodeURIComponent(eventTicker)}`,
              eventTicker,
              seriesTicker,
              change,
              change.scheduledAt,
            ),
          );
        }
        if (!changes.cursor) break;
        if (feeCursors.has(changes.cursor) || page === 19)
          throw new Error("Fee-change pagination incomplete.");
        feeCursors.add(changes.cursor);
        feeCursor = changes.cursor;
      }
      const datedChanges = feeRows
        .filter(
          (row) =>
            row.sourceType === "official_event_fee_change_api" &&
            row.effectiveFrom,
        )
        .sort(
          (a, b) => a.effectiveFrom!.getTime() - b.effectiveFrom!.getTime(),
        );
      for (let i = 0; i < datedChanges.length; i++) {
        const next = datedChanges
          .slice(i + 1)
          .find((row) => row.effectiveFrom! > datedChanges[i]!.effectiveFrom!);
        if (next) datedChanges[i]!.effectiveTo = next.effectiveFrom;
      }
      await store.writeFeeSnapshots(feeRows);
    }
    for (const market of candidates)
      watermark.set(
        market.ticker,
        (await store.lastExecutedAt(market.ticker)) ?? selectedAt,
      );
    while (!signal.aborted) {
      const cycleStart = now().getTime();
      for (
        let offset = 0;
        offset < candidates.length && !signal.aborted;
        offset += 2
      ) {
        const results = await Promise.all(
          candidates.slice(offset, offset + 2).map(async (market) => {
            const prior = watermark.get(market.ticker)!;
            const minTs = Math.max(
              0,
              Math.floor((prior.getTime() - 1000) / 1000),
            );
            const trades = await fetchTradeWindow(
              reader,
              market.ticker,
              minTs,
              () => paginationPages++,
            );
            const rows: TradeInput[] = trades.map((trade) => ({
              source: reader.source,
              providerTradeId: trade.tradeId,
              marketId: marketIds.get(market.ticker)!,
              ticker: trade.ticker,
              eventTicker: market.eventTicker,
              executedAt: trade.executedAt,
              receivedAt: now(),
              yesPrice: trade.yesPrice,
              noPrice: trade.noPrice,
              quantity: trade.quantity,
              takerOutcomeSide: trade.takerOutcomeSide,
              takerBookSide: trade.takerBookSide,
              aggressorSide: trade.aggressorSide,
              sideProvenance: trade.aggressorProvenance,
              isBlockTrade: trade.isBlockTrade,
              rawMetadata: trade.rawMetadata,
              collectionRunId: runId,
            }));
            let inserted = 0,
              seen = 0;
            for (let i = 0; i < rows.length; i += 100) {
              const result = await retry(() =>
                store.writeTrades(runId, rows.slice(i, i + 100)),
              );
              inserted += result.inserted;
              seen += result.duplicates;
            }
            if (trades.length)
              watermark.set(market.ticker, trades.at(-1)!.executedAt);
            return { inserted, duplicates: seen };
          }),
        );
        for (const result of results) {
          written += result.inserted;
          duplicates += result.duplicates;
        }
      }
      await store.heartbeat(runId);
      log("trade_collector_health", {
        runId,
        written,
        duplicates,
        paginationPages,
        elapsedMs: now().getTime() - selectedAt.getTime(),
      });
      if (
        options.once ||
        (options.durationMs !== null &&
          now().getTime() - selectedAt.getTime() >= options.durationMs)
      ) {
        status = "completed";
        break;
      }
      await sleep(
        Math.max(0, cycleStart + 10_000 - now().getTime()),
        undefined,
        { signal },
      ).catch(() => undefined);
    }
  } catch (cause) {
    status = "failed";
    error = errorCode(cause);
    throw cause;
  } finally {
    try {
      await store.updateCollectionMetrics(runId, { paginationPages });
    } catch {
      status = "failed";
      error = "collection_metrics_persist_failed";
    }
    await store.finishRun(runId, status, error);
    log("trade_collector_stopped", {
      runId,
      status,
      written,
      duplicates,
      paginationPages,
      error,
    });
  }
  return runId;
}
