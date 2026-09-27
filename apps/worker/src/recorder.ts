import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import {
  MarketState,
  createDemoMarketStream,
  type MarketDataReader,
} from "@kalshi-lab/kalshi";
import type { RecorderStore, RunHealth } from "@kalshi-lab/db";
import type { RecorderConfig } from "./config.ts";
import { observeInitialMarkets } from "./observe.ts";
import { discoverMarkets } from "./universe.ts";
import { buildSnapshot, marketInput } from "./snapshot.ts";
import { SnapshotQueue } from "./persistence.ts";
import { errorCode, retry } from "./retry.ts";

export const RECORDER_VERSION = "market-recorder-v1";
export type Log = (event: string, fields: Record<string, unknown>) => void;
export interface RecorderOptions {
  reader: MarketDataReader;
  store: RecorderStore;
  config: RecorderConfig;
  signal: AbortSignal;
  once: boolean;
  gitCommit: string;
  gitDirty: boolean;
  log: Log;
  // Read-only stream injection enables lifecycle tests without live credentials.
  streamFactory?: typeof createDemoMarketStream;
}

export async function recordMarkets(options: RecorderOptions): Promise<void> {
  const { reader, store, config, signal, once, log } = options;
  const expectedSource =
    config.source === "demo" ? "kalshi_demo" : "kalshi_production_public";
  if (reader.source !== expectedSource)
    throw new Error("Recorder source mismatch.");
  await retry(() => store.ping());
  const runInput = {
    id: randomUUID(),
    source: reader.source,
    gitCommit: options.gitCommit,
    gitDirty: options.gitDirty,
    recorderVersion: RECORDER_VERSION,
    config: { ...config, once },
  };
  const runId = await retry(() => store.startRun(runInput));
  let stream: ReturnType<typeof createDemoMarketStream> | undefined;
  let connected = false;
  let connectedAt = 0;
  let lastError: string | null = null;
  let status: "completed" | "stopped" | "failed" = "stopped";
  let finalFlushFailed = false;
  const states = new Map<string, MarketState>();
  const ids = new Map<string, string>();
  const queue = new SnapshotQueue();
  const health = (): RunHealth => ({
    error: lastError,
    reconnectCount: stream?.health().reconnects ?? 0,
    malformedMessages: stream?.health().malformedMessages ?? 0,
    droppedSnapshots: queue.droppedSnapshots,
  });
  const capture = (observedAt: Date, transport: "rest" | "websocket") =>
    queue.enqueue(
      [...states.values()].map((state) =>
        buildSnapshot(state, {
          marketId: ids.get(state.market.ticker)!,
          runId,
          source: reader.source,
          observedAt,
          staleMs: config.staleMs,
          connected,
          transport,
        }),
      ),
    );
  // Shutdown freezes updates immediately, before waiting for in-flight I/O.
  const abort = () => {
    connected = false;
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const candidates = await retry(() => discoverMarkets(reader, config));
    if (!candidates.length)
      throw new Error("No open binary markets in the bounded universe.");
    if (signal.aborted) return;
    const initialStates = await observeInitialMarkets(
      reader,
      candidates,
      config.tickers.length > 0,
      signal,
      (ticker, code) => {
        lastError = code;
        log("initial_market_unavailable", { ticker, code });
      },
    );
    if (signal.aborted) return;
    if (!initialStates.length)
      throw new Error("No discovery candidates remain available.");
    for (const state of initialStates) states.set(state.market.ticker, state);
    const universe = initialStates.map((state) => state.market);
    const rows = await retry(() =>
      store.upsertMarkets(
        initialStates.map((state) =>
          marketInput(state.market, reader.source, state.metadataReceivedAt),
        ),
      ),
    );
    for (const row of rows) ids.set(row.ticker, row.id);
    await retry(() => store.setMarketsTracked(runId, universe.length));
    if (ids.size !== universe.length)
      throw new Error("Market upsert did not return the complete universe.");
    // Two in-flight market reads bound request pressure and total shutdown delay.
    async function refresh(includeBook: boolean): Promise<void> {
      for (
        let offset = 0;
        offset < universe.length && !signal.aborted;
        offset += 2
      ) {
        const results = await Promise.allSettled(
          universe.slice(offset, offset + 2).map(async ({ ticker }) => {
            try {
              const market = await reader.getMarket(ticker);
              if (signal.aborted) return;
              if (market.ticker !== ticker)
                throw new Error("Market response ticker mismatch.");
              const receivedAt = new Date();
              const state =
                states.get(ticker) ?? new MarketState(market, receivedAt);
              state.refreshMarket(market, receivedAt);
              states.set(ticker, state);
              if (includeBook) {
                const book = await reader.getOrderbook(ticker);
                if (signal.aborted) return;
                state.setBook(book, new Date());
              }
            } catch (error) {
              lastError = `market_read_${errorCode(error)}`;
              if (once || !states.has(ticker)) throw error;
            }
          }),
        );
        for (const result of results)
          if (result.status === "rejected") throw result.reason;
      }
      if (signal.aborted) return;
      await store.upsertMarkets(
        [...states.values()].map((state) =>
          marketInput(state.market, reader.source, state.metadataReceivedAt),
        ),
      );
    }
    if (signal.aborted) return;
    connected = true; // initial REST capture is independent of subsequent socket state
    capture(new Date(), "rest");
    await retry(() => queue.flush(store, runId, health()));
    log("recorder_started", {
      source: reader.source,
      markets: states.size,
      snapshotIntervalMs: config.snapshotIntervalMs,
      databaseConnected: true,
      runId,
    });
    if (once) {
      status = "completed";
      return;
    }
    if (reader.source === "kalshi_demo") {
      connected = false;
      for (const state of states.values()) state.invalidateBook();
      stream = (options.streamFactory ?? createDemoMarketStream)(
        universe.map((market) => market.ticker),
        {
          onMessage: (event, receivedAt) =>
            signal.aborted
              ? true
              : (states.get(event.ticker)?.apply(event, receivedAt) ?? true),
          onConnection: (value) => {
            if (signal.aborted) return;
            connected = value;
            if (value) connectedAt = Date.now();
            if (!value)
              for (const state of states.values()) state.invalidateBook();
          },
          onWarning: (code) => {
            lastError = code;
            log("stream_warning", { code });
          },
        },
      );
      stream.start();
    }
    let nextRefreshAt = Date.now() + 60_000;
    let nextHealthAt = Date.now() + 60_000;
    let nextWriteAt = 0;
    let failures = 0;
    while (!signal.aborted) {
      try {
        await setTimeout(config.snapshotIntervalMs, undefined, { signal });
      } catch {
        break;
      }
      if (signal.aborted) break;
      try {
        if (
          reader.source === "kalshi_production_public" ||
          Date.now() >= nextRefreshAt
        ) {
          await refresh(reader.source === "kalshi_production_public");
          nextRefreshAt = Date.now() + 60_000;
        }
      } catch (error) {
        lastError = `refresh_${errorCode(error)}`;
        log("refresh_failed", { code: lastError });
      }
      if (signal.aborted) break;
      if (
        stream &&
        connected &&
        [...states.values()].some((state) =>
          state.bookVerifiedAt
            ? Date.now() - state.bookVerifiedAt.getTime() > config.staleMs
            : Date.now() - connectedAt > 30_000,
        )
      ) {
        lastError = "stale_book";
        stream.reconnect();
      }
      capture(new Date(), stream ? "websocket" : "rest");
      if (Date.now() >= nextWriteAt) {
        try {
          await queue.flush(store, runId, health());
          failures = 0;
        } catch (error) {
          lastError = `database_write_${errorCode(error)}`;
          nextWriteAt =
            Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
          log("persistence_failed", {
            code: lastError,
            pendingBatches: queue.pendingBatches,
          });
        }
      }
      if (Date.now() >= nextHealthAt) {
        const latest = Math.max(
          ...[...states.values()].map((state) =>
            Math.max(
              state.tickerReceivedAt.getTime(),
              state.bookReceivedAt?.getTime() ?? 0,
            ),
          ),
        );
        log("recorder_health", {
          runId,
          marketsTracked: states.size,
          snapshotsWritten: queue.snapshotsWritten,
          lastUpdateAgeMs: Date.now() - latest,
          reconnectCount: stream?.health().reconnects ?? 0,
          malformedMessages: stream?.health().malformedMessages ?? 0,
          pendingBatches: queue.pendingBatches,
          droppedSnapshots: queue.droppedSnapshots,
        });
        nextHealthAt = Date.now() + 60_000;
      }
    }
  } catch (error) {
    status = "failed";
    lastError = `recorder_${errorCode(error)}`;
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    await stream?.stop();
    // Final snapshot is explicitly disconnected; observations are not made fresher.
    if (!once && states.size && ids.size) {
      connected = false;
      capture(new Date(), stream ? "websocket" : "rest");
    }
    try {
      await retry(() => queue.flush(store, runId, health()));
    } catch (error) {
      status = "failed";
      finalFlushFailed = true;
      lastError = `shutdown_flush_${errorCode(error)}`;
      log("shutdown_persistence_failed", {
        code: lastError,
        pendingBatches: queue.pendingBatches,
      });
    }
    try {
      await retry(() => store.finishRun(runId, status, health()));
    } catch (error) {
      log("run_finalization_failed", { runId, code: errorCode(error) });
      throw error;
    }
    log("recorder_stopped", {
      runId,
      status,
      snapshotsWritten: queue.snapshotsWritten,
      pendingBatches: queue.pendingBatches,
    });
    if (finalFlushFailed)
      throw new Error("Recorder shutdown could not persist all work.");
  }
}
