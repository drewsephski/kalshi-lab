import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const marketSource = pgEnum("market_source", [
  "kalshi_demo",
  "kalshi_production_public",
]);
export const runStatus = pgEnum("worker_run_status", [
  "running",
  "completed",
  "stopped",
  "failed",
]);
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const price = (name: string) => numeric(name, { precision: 8, scale: 4 });
const quantity = (name: string) => numeric(name, { precision: 24, scale: 2 });

export const markets = pgTable(
  "markets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: marketSource("source").notNull(),
    ticker: text("ticker").notNull(),
    eventTicker: text("event_ticker"),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    status: text("status").notNull(),
    openTime: time("open_time"),
    closeTime: time("close_time"),
    expirationTime: time("expiration_time"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    firstSeenAt: time("first_seen_at").notNull(),
    lastSeenAt: time("last_seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("markets_source_ticker_uq").on(table.source, table.ticker),
    unique("markets_id_source_uq").on(table.id, table.source),
    index("markets_source_status_idx").on(table.source, table.status),
    index("markets_source_event_idx").on(table.source, table.eventTicker),
  ],
);

export const workerRuns = pgTable(
  "worker_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: marketSource("source").notNull(),
    startedAt: time("started_at").notNull().defaultNow(),
    stoppedAt: time("stopped_at"),
    heartbeatAt: time("heartbeat_at").notNull().defaultNow(),
    status: runStatus("status").notNull().default("running"),
    marketsTracked: integer("markets_tracked").notNull().default(0),
    snapshotsWritten: bigint("snapshots_written", { mode: "number" })
      .notNull()
      .default(0),
    lastSuccessfulObservationAt: time("last_successful_observation_at"),
    error: text("error"),
    gitCommit: text("git_commit").notNull(),
    gitDirty: boolean("git_dirty").notNull(),
    recorderVersion: text("recorder_version").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    reconnectCount: integer("reconnect_count").notNull().default(0),
    malformedMessages: integer("malformed_messages").notNull().default(0),
    droppedSnapshots: bigint("dropped_snapshots", { mode: "number" })
      .notNull()
      .default(0),
  },
  (table) => [
    unique("worker_runs_id_source_uq").on(table.id, table.source),
    index("worker_runs_source_started_idx").on(table.source, table.startedAt),
    index("worker_runs_status_heartbeat_idx").on(
      table.status,
      table.heartbeatAt,
    ),
    check(
      "worker_runs_nonnegative_counts",
      sql`${table.marketsTracked} >= 0 AND ${table.snapshotsWritten} >= 0 AND ${table.droppedSnapshots} >= 0`,
    ),
  ],
);

export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: uuid("id").primaryKey(), // generated before retry so uncertain commits are idempotent
    marketId: uuid("market_id").notNull(),
    source: marketSource("source").notNull(),
    workerRunId: uuid("worker_run_id").notNull(),
    observedAt: time("observed_at").notNull(),
    tickerReceivedAt: time("ticker_received_at").notNull(),
    bookReceivedAt: time("book_received_at"),
    bookVerifiedAt: time("book_verified_at"),
    exchangeTimestamp: time("exchange_timestamp"),
    status: text("status").notNull(),
    transport: text("transport").notNull(),
    connected: boolean("connected").notNull(),
    stale: boolean("stale").notNull(),
    yesBid: price("yes_bid"),
    yesAsk: price("yes_ask"),
    noBid: price("no_bid"),
    noAsk: price("no_ask"),
    lastPrice: price("last_price"),
    yesBidSize: quantity("yes_bid_size"),
    yesAskSize: quantity("yes_ask_size"),
    noBidSize: quantity("no_bid_size"),
    noAskSize: quantity("no_ask_size"),
    volume: quantity("volume"),
    openInterest: quantity("open_interest"),
    supplemental: jsonb("supplemental")
      .$type<Record<string, unknown>>()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "snapshots_market_source_fk",
      columns: [table.marketId, table.source],
      foreignColumns: [markets.id, markets.source],
    }),
    foreignKey({
      name: "snapshots_run_source_fk",
      columns: [table.workerRunId, table.source],
      foreignColumns: [workerRuns.id, workerRuns.source],
    }),
    uniqueIndex("snapshots_run_market_observed_uq").on(
      table.workerRunId,
      table.marketId,
      table.observedAt,
    ),
    index("snapshots_market_observed_idx").on(table.marketId, table.observedAt),
    index("snapshots_source_observed_idx").on(table.source, table.observedAt),
    check(
      "snapshots_binary_prices",
      sql`(${table.yesBid} BETWEEN 0 AND 1 OR ${table.yesBid} IS NULL) AND (${table.yesAsk} BETWEEN 0 AND 1 OR ${table.yesAsk} IS NULL) AND (${table.noBid} BETWEEN 0 AND 1 OR ${table.noBid} IS NULL) AND (${table.noAsk} BETWEEN 0 AND 1 OR ${table.noAsk} IS NULL) AND (${table.lastPrice} BETWEEN 0 AND 1 OR ${table.lastPrice} IS NULL)`,
    ),
    check(
      "snapshots_nonnegative_counts",
      sql`coalesce(${table.volume}, 0) >= 0 AND coalesce(${table.openInterest}, 0) >= 0 AND coalesce(${table.yesBidSize}, 0) >= 0 AND coalesce(${table.yesAskSize}, 0) >= 0 AND coalesce(${table.noBidSize}, 0) >= 0 AND coalesce(${table.noAskSize}, 0) >= 0`,
    ),
  ],
);

export type MarketRow = typeof markets.$inferSelect;
export type MarketInput = Omit<typeof markets.$inferInsert, "id">;
export type SnapshotInput = typeof marketSnapshots.$inferInsert;
export type RunInput = typeof workerRuns.$inferInsert;
export type RunHealth = Pick<
  typeof workerRuns.$inferInsert,
  "error" | "reconnectCount" | "malformedMessages" | "droppedSnapshots"
>;
