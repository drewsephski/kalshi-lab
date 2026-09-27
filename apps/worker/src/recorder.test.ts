import assert from "node:assert/strict";
import test from "node:test";
import {
  MarketState,
  normalizeMarket,
  type MarketDataReader,
} from "@kalshi-lab/kalshi";
import type {
  RecorderStore,
  RunHealth,
  RunInput,
  SnapshotInput,
} from "@kalshi-lab/db";
import { readRecorderConfig } from "./config.ts";
import { discoverMarkets, selectMarkets } from "./universe.ts";
import { buildSnapshot } from "./snapshot.ts";
import { SnapshotQueue } from "./persistence.ts";
import { retry } from "./retry.ts";
import { recordMarkets } from "./recorder.ts";

const now = new Date("2026-01-01T00:00:00Z");
const market = (ticker: string, volume = "1.00", status = "active") =>
  normalizeMarket({
    ticker,
    title: ticker,
    status,
    volume_24h_fp: volume,
    volume_fp: volume,
    open_interest_fp: "5.00",
    market_type: "binary",
    notional_value_dollars: "1.0000",
  });
const config = readRecorderConfig({
  KALSHI_RECORDER_SOURCE: "production_public",
});
const book = {
  yes: [["0.4001", "3.00"] as const],
  no: [["0.5998", "4.00"] as const],
};

function harness() {
  const snapshots: SnapshotInput[] = [];
  const runs: RunInput[] = [];
  const statuses: string[] = [];
  let tracked = 0;
  let finishedHealth: RunHealth | undefined;
  const store: RecorderStore = {
    ping: async () => {},
    startRun: async (input) => {
      runs.push(input);
      return "run-id";
    },
    upsertMarkets: async (inputs) =>
      inputs.map((input) => ({
        ...input,
        id: `market-${input.ticker}`,
        eventTicker: input.eventTicker ?? null,
        subtitle: input.subtitle ?? null,
        openTime: input.openTime ?? null,
        closeTime: input.closeTime ?? null,
        expirationTime: input.expirationTime ?? null,
      })),
    setMarketsTracked: async (_id, count) => {
      tracked = count;
    },
    writeSnapshots: async (_run, rows) => {
      snapshots.push(...rows);
      return rows.length;
    },
    finishRun: async (_id, status, health) => {
      statuses.push(status);
      finishedHealth = health;
    },
  };
  const reader: MarketDataReader = {
    source: "kalshi_production_public",
    listMarkets: async () => ({
      markets: [market("A"), market("B")],
      cursor: null,
    }),
    getMarket: async (ticker) => market(ticker),
    getOrderbook: async () => book,
  };
  return {
    store,
    reader,
    snapshots,
    runs,
    statuses,
    tracked: () => tracked,
    health: () => finishedHealth,
  };
}

test("configuration defaults are bounded, reject unsafe sources, and deduplicate explicit tickers", () => {
  assert.equal(readRecorderConfig({}).snapshotIntervalMs, 5000);
  assert.equal(readRecorderConfig({}).maxMarkets, 25);
  assert.deepEqual(
    readRecorderConfig({ KALSHI_TRACK_TICKERS: " B,A,B " }).tickers,
    ["A", "B"],
  );
  assert.throws(
    () => readRecorderConfig({ KALSHI_RECORDER_SOURCE: "production" }),
    /source/i,
  );
  assert.throws(
    () => readRecorderConfig({ KALSHI_RECORDER_MAX_MARKETS: "101" }),
    /Invalid/,
  );
  assert.throws(
    () => readRecorderConfig({ MARKET_SNAPSHOT_INTERVAL_MS: "0" }),
    /Invalid/,
  );
});

test("selection ranks exact volume, deduplicates, and excludes closed/future/scalar markets", () => {
  const scalar = {
    ...market("SCALAR", "999.00"),
    metadata: { market_type: "scalar" },
  };
  const future = {
    ...market("FUTURE", "999.00"),
    openTime: new Date(now.getTime() + 1),
  };
  const closed = { ...market("CLOSED", "999.00"), closeTime: now };
  assert.deepEqual(
    selectMarkets(
      [
        market("B", "9007199254740993.00"),
        market("A", "9007199254740993.01"),
        market("A", "1.00"),
        market("BAD", "999.00", "closed"),
        scalar,
        future,
        closed,
      ],
      2,
      now,
    ).map((item) => item.ticker),
    ["A", "B"],
  );
  assert.deepEqual(
    selectMarkets([market("B"), market("A")], 1, now).map(
      (item) => item.ticker,
    ),
    ["A"],
  );
});

test("discovery is bounded to three pages and explicit tickers bypass broad discovery", async () => {
  const h = harness();
  let pages = 0;
  h.reader.listMarkets = async () => {
    pages++;
    return { markets: [market(String(pages))], cursor: String(pages) };
  };
  await discoverMarkets(h.reader, config, now);
  assert.equal(pages, 3);
  await discoverMarkets(h.reader, { ...config, tickers: ["A"] }, now);
  assert.equal(pages, 3);
  h.reader.getMarket = async () => market("A", "1.00", "closed");
  await assert.rejects(
    discoverMarkets(h.reader, { ...config, tickers: ["A"] }, now),
    /open/,
  );
});

test("snapshots separate scheduler time, update age, and executable book state", () => {
  const state = new MarketState(market("A"), now);
  state.setBook(book, now);
  const context = {
    source: "kalshi_demo" as const,
    marketId: "market-id",
    runId: "run",
    observedAt: new Date(now.getTime() + 5000),
    staleMs: 10_000,
    connected: true,
    transport: "websocket" as const,
  };
  const snapshot = buildSnapshot(state, context);
  assert.equal(snapshot.yesAsk, "0.4002");
  assert.equal(snapshot.yesAskSize, "4.00");
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.observedAt, context.observedAt);
  assert.equal(snapshot.bookReceivedAt, now);
  assert.equal(
    buildSnapshot(state, { ...context, connected: false }).stale,
    true,
  );
  assert.equal(
    buildSnapshot(state, {
      ...context,
      observedAt: new Date(now.getTime() + 10_001),
    }).stale,
    true,
  );
  state.invalidateBook();
  assert.equal(buildSnapshot(state, context).yesBid, null);
  assert.equal(buildSnapshot(state, context).stale, true);
});

test("bounded persistence retains identical observations after temporary DB failure", async () => {
  const state = new MarketState(market("A"), now);
  state.setBook(book, now);
  const row = buildSnapshot(state, {
    source: "kalshi_demo",
    marketId: "a",
    runId: "r",
    observedAt: now,
    staleMs: 10_000,
    connected: true,
    transport: "rest",
  });
  const queue = new SnapshotQueue(2);
  queue.enqueue([row]);
  await assert.rejects(
    queue.flush(
      {
        writeSnapshots: async () => {
          throw new Error("offline");
        },
      },
      "r",
      {},
    ),
    /offline/,
  );
  assert.equal(queue.pendingBatches, 1);
  await queue.flush(
    {
      writeSnapshots: async (_run, rows) => {
        assert.equal(rows[0], row);
        return 1;
      },
    },
    "r",
    {},
  );
  assert.equal(queue.pendingBatches, 0);
  assert.equal(queue.snapshotsWritten, 1);
  queue.enqueue([row]);
  queue.enqueue([row]);
  queue.enqueue([row]);
  assert.equal(queue.pendingBatches, 2);
  assert.equal(queue.droppedSnapshots, 1);
});

test("bounded retry waits between attempts", async () => {
  const waits: number[] = [];
  let attempts = 0;
  const result = await retry(
    async () => {
      if (++attempts < 3) throw new Error("temporary");
      return 42;
    },
    3,
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.equal(result, 42);
  assert.deepEqual(waits, [1000, 2000]);
});

test("one-shot writes one snapshot per selected market and completes the run", async () => {
  const h = harness();
  await recordMarkets({
    ...h,
    config,
    once: true,
    signal: new AbortController().signal,
    gitCommit: "a".repeat(40),
    gitDirty: false,
    log: () => {},
  });
  assert.equal(h.snapshots.length, 2);
  assert.equal(h.tracked(), 2);
  assert.deepEqual(h.statuses, ["completed"]);
  assert.ok(
    h.snapshots.every(
      (row) =>
        row.source === "kalshi_production_public" &&
        row.transport === "rest" &&
        !row.stale,
    ),
  );
  assert.equal(h.runs[0]?.gitCommit, "a".repeat(40));
  await assert.rejects(
    recordMarkets({
      ...h,
      config: { ...config, source: "demo" },
      once: true,
      signal: new AbortController().signal,
      gitCommit: "test",
      gitDirty: false,
      log: () => {},
    }),
    /source mismatch/,
  );
});

test("long-running demo shutdown freezes stream work, flushes, and finalizes", async () => {
  const h = harness();
  h.reader = { ...h.reader, source: "kalshi_demo" };
  const controller = new AbortController();
  let stopped = false;
  let factoryCalled = false;
  const timer = setTimeout(() => controller.abort(), 25);
  try {
    await recordMarkets({
      ...h,
      config: { ...config, source: "demo", snapshotIntervalMs: 5 },
      once: false,
      signal: controller.signal,
      gitCommit: "a".repeat(40),
      gitDirty: true,
      log: () => {},
      streamFactory: (_tickers, callbacks) => {
        factoryCalled = true;
        return {
          start: () => {
            callbacks.onConnection(true);
            for (const ticker of ["A", "B"])
              callbacks.onMessage(
                { type: "orderbook_snapshot", ticker, book, sid: 1, seq: 1 },
                new Date(),
              );
          },
          reconnect: () => {},
          health: () => ({
            reconnects: 0,
            malformedMessages: 0,
            connectionActivityAgeMs: 0,
          }),
          stop: async () => {
            stopped = true;
            callbacks.onMessage(
              {
                type: "orderbook_delta",
                ticker: "A",
                price: "0.4001",
                delta: 10000n,
                side: "yes",
                sid: 1,
                seq: 2,
                eventAt: null,
              },
              new Date(),
            );
          },
        };
      },
    });
    assert.equal(factoryCalled, true);
    assert.equal(stopped, true);
    assert.deepEqual(h.statuses, ["stopped"]);
    assert.ok(h.snapshots.length >= 4);
    assert.ok(
      h.snapshots.some((row) => row.transport === "websocket" && row.connected),
    );
    const final = h.snapshots.at(-2)!;
    assert.equal(final.connected, false);
    assert.equal(final.stale, true);
    assert.equal(final.yesBidSize, "3.00");
  } finally {
    clearTimeout(timer);
  }
});

test("implicit startup skips disappeared markets while explicit startup fails visibly", async () => {
  const h = harness();
  h.reader.getMarket = async (ticker) => {
    if (ticker === "A") throw Object.assign(new Error("gone"), { status: 404 });
    return market(ticker);
  };
  await recordMarkets({
    ...h,
    config,
    once: true,
    signal: new AbortController().signal,
    gitCommit: "a".repeat(40),
    gitDirty: false,
    log: () => {},
  });
  assert.equal(h.tracked(), 1);
  assert.equal(h.snapshots.length, 1);
  assert.equal(h.health()?.error, "HTTP_404");
  const explicit = harness();
  explicit.reader.getMarket = async () => {
    throw Object.assign(new Error("gone"), { status: 404 });
  };
  await assert.rejects(
    recordMarkets({
      ...explicit,
      config: { ...config, tickers: ["A"] },
      once: true,
      signal: new AbortController().signal,
      gitCommit: "a".repeat(40),
      gitDirty: false,
      log: () => {},
    }),
    /gone/,
  );
  assert.deepEqual(explicit.statuses, ["failed"]);
  assert.equal(explicit.snapshots.length, 0);
});
