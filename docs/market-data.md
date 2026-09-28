# Market data foundation

## EXP-004 directed trades and fee provenance (checked 2026-09-28)

Official current documentation: [Get Trades](https://docs.kalshi.com/api-reference/market/get-trades), [Order direction](https://docs.kalshi.com/getting_started/order_direction), [Get Event](https://docs.kalshi.com/api-reference/events/get-event), [Get Series](https://docs.kalshi.com/api-reference/market/get-series), [Get Event Fee Changes](https://docs.kalshi.com/api-reference/events/get-event-fee-changes), and the [fee schedule PDF](https://kalshi.com/docs/kalshi-fee-schedule.pdf) (effective July 7, 2026). The unsigned production REST endpoint `GET /trade-api/v2/markets/trades` supports `ticker`, `min_ts`, `max_ts`, opaque `cursor`, `limit` up to 1000, and `is_block_trade`. Individual responses provide `trade_id`, `created_time`, `count_fp`, `yes_price_dollars`, `no_price_dollars`, `taker_outcome_side`, `taker_book_side`, and `is_block_trade`. A live unsigned response on September 28 included these fields. `taker_side` is deprecated and ignored.

Kalshi defines `taker_outcome_side=yes` and `taker_book_side=bid` as the same long-YES directional bit; `no` and `ask` are long-NO. Buy-YES and sell-NO share the YES bit; buy-NO and sell-YES share the NO bit. The public trade gives taker exposure, not an order action or account-specific queue position. The normalizer records `yes_exposure`/`no_exposure` only when both canonical fields agree; missing or contradictory values remain `unknown`. A passive YES bid can be consumed by a long-NO taker. No price-only relation is promoted to an aggressor label in EXP-004. Block trades are excluded from queue analysis.

The separate `worker:trades` mode uses the recorder's bounded universe, two concurrent unsigned GETs, one-second overlapping `min_ts` windows, complete cursor pagination, stable-ID deduplication and explicit collector-run health. Stored trades have exact `numeric(8,4)` prices and `numeric(24,2)` quantities. A repeated ID with changed immutable values fails the batch. A gap caused by an API error or page cap fails the run; one-second overlap still cannot guarantee recovery from publication delays longer than one second. The existing recorder must run concurrently for nearby book observations; the trade collector does not create or fabricate books. Snapshot `book_received_at` is compared with exchange trade time under a fixed 7.5-second tolerance; these are different clocks and discrete REST receipts.

The event API provides current `fee_type_override` and `fee_multiplier_override`; the series API provides current `fee_type` and `fee_multiplier`. `GET /events/fee_changes` provides event-specific `scheduled_ts` records, with null override fields clearing an override. The PDF states a general taker formula with factor 0.07 and maker factor 0.0175, plus market-specific exceptions and maker applicability. Event/series snapshots and fee-change records are stored separately from trades with source URLs and observed/effective timestamps. Current event/series metadata alone cannot prove past applicability: live event `last_updated_ts` was year 0001 for a sampled event, while its series had a normal timestamp. Unknown historical windows stay unknown. No universal maker-free assumption is backfilled.

## Sources and API contract

`kalshi_demo` uses signed demo REST at
`https://external-api.demo.kalshi.co/trade-api/v2` and signed WebSockets at
`wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`. All credentials must be demo
credentials and `KALSHI_ENV=demo`. The existing authenticated client retains its
hard-coded demo origin and environment guard.

`kalshi_production_public` uses only unsigned GET requests to
`https://external-api.kalshi.com/trade-api/v2/markets...` through
`KalshiPublicMarketDataClient`. It accepts no credentials, custom origins, headers,
or order operations and never uses the authenticated transport. Environment
credentials may coexist in the process but are not read or transmitted by this
client. Redirects are rejected by both transports.

Official API documentation checked September 27, 2026:

- [Environments and endpoints](https://docs.kalshi.com/getting_started/api_environments)
- [Unauthenticated public REST market data](https://docs.kalshi.com/getting_started/quick_start_market_data)
- [Get Markets](https://docs.kalshi.com/api-reference/market/get-markets)
- [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-orderbook)
- [WebSocket authentication and subscriptions](https://docs.kalshi.com/getting_started/quick_start_websockets)
- [Ticker](https://docs.kalshi.com/websockets/market-ticker),
  [order books](https://docs.kalshi.com/websockets/orderbook-updates),
  [public trades](https://docs.kalshi.com/websockets/public-trades), and
  [control-frame heartbeat](https://docs.kalshi.com/websockets/connection-keep-alive)
- [Current OpenAPI](https://docs.kalshi.com/openapi.yaml) and
  [AsyncAPI](https://docs.kalshi.com/asyncapi.yaml)

REST uses `GET /markets?status=open&limit=200&mve_filter=exclude`, optional opaque
pagination cursors, `GET /markets/{ticker}`, and
`GET /markets/{ticker}/orderbook` (full depth). Protocol logic and validation live
in `packages/kalshi`, never in the worker. The book has YES and NO bids; executable
asks are complements of opposite-side bids with identical sizes.

Demo subscriptions use `ticker`, `orderbook_delta`, and `trade`, each restricted
to the chosen tickers. The order-book channel first supplies a snapshot and then
signed quantity deltas. A `get_snapshot` subscription update every 60 seconds
reconciles the book. Production-public recording uses REST because current
WebSockets require authentication even for public ticker/trade channels. No
production WebSocket authentication is implemented. No visual scraping is used.

## Schema and indexes

`packages/db/migrations` contains the generated SQL and Drizzle metadata.
`pnpm db:generate` requires no credentials; `pnpm db:migrate` explicitly loads
`DATABASE_URL`, applies pending migrations, and closes the driver.

| Table              | Purpose                                   | Main fields and indexes                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `markets`          | Stable current metadata per source/ticker | UUID, source enum, ticker, event ticker, title/subtitle, lifecycle status, open/close/latest expiration times, selected terms/strike/price-grid JSON, first/last seen times. Unique `(source,ticker)` and `(id,source)`; indexes `(source,status)` and `(source,event_ticker)`.                                                                  |
| `market_snapshots` | Immutable sampled state                   | UUID, source, market/run references, observation/receipt/verification/exchange timestamps, status, transport, connected/stale flags, four executable prices and sizes, last price, total volume, open interest, supplemental JSON. Unique `(worker_run_id,market_id,observed_at)`; indexes `(market_id,observed_at)` and `(source,observed_at)`. |
| `worker_runs`      | Health and provenance                     | UUID, source, start/stop/heartbeat times, status, market count, snapshot count, last successful observation, last error code, Git SHA/dirty flag, recorder version/config, reconnect/malformed/drop counts. Unique `(id,source)`; indexes `(source,started_at)` and `(status,heartbeat_at)`.                                                     |

Composite foreign keys force snapshot source to match both its market and run.
Source labels cannot silently mix. Snapshot writes and run-count increments share
one transaction. Retrying the same IDs or run/market/time keys is idempotent.
Market upserts retain the original ID and first-seen time and never regress
last-seen time or overwrite metadata with an older observation. There are no
cascade deletions, data pruning, account tables, or bankroll mutations.

Prices use `numeric(8,4)` in **dollars per $1 binary contract**. Counts and sizes
use `numeric(24,2)` in contracts. API decimal strings stay strings through storage;
price complements, size deltas, and ranking use scaled `bigint`, never JS floating
point. Unsupported precision/range is rejected. DB checks enforce prices in
`[0,1]` and nonnegative quantities. Zero and null are distinct. Empty book sides
produce null bids/asks/sizes, not fabricated zero-liquidity prices.

## Snapshot semantics

Default `MARKET_SNAPSHOT_INTERVAL_MS=5000`. The worker updates memory on packets
and periodically freezes a batch before database I/O; it does not write a row
per packet. Two REST reads run concurrently at most. Metadata refreshes every
60 seconds in demo; production-public polls current metadata and books each
cycle. Actual observation times, not nominal time buckets, are stored. Request,
refresh, retry, and database latency can lengthen the interval; missed time is
not backfilled or presented as observed data.

- `observed_at`: local UTC clock when a frozen snapshot is constructed.
- `ticker_received_at`: last local receipt of REST statistics or a ticker update.
- `book_received_at`: last local book snapshot or delta receipt.
- `book_verified_at`: last full REST/WS book snapshot receipt; deltas do not refresh
  this verification time.
- `exchange_timestamp`: exchange ticker timestamp when available (`ts_ms`), not
  the scheduler time. REST market metadata `updated_time` is not a trading clock.
- `connected`: transport was available; initial/one-shot REST capture is marked
  connected. Final shutdown capture is explicitly disconnected.
- `stale`: disconnected, uninitialized/invalid book, or book verification/ticker
  statistics older than `MARKET_DATA_STALE_MS` (default 120 seconds).

All four prices and displayed sizes come from one reconstructed executable book,
not a mixture of asynchronously updated ticker quotes. Last price, cumulative
volume, and open interest come from the latest ticker/REST statistics. Their
receipt time is separate; a book delta is not proof that those statistics changed.
Book verification age distinguishes quiet confirmed markets from lost updates.

Supplemental JSON retains the best ten bid levels per outcome, level counts,
exact sum of those ten quantities, the last ticker quote for comparison, and the
last observed public trade (ID, price, quantity, taker outcome side, timestamps).
A bounded recent-trade-ID set suppresses repeats. This is **not a complete trade
tape**, a trade-count aggregator, or event replay history. Cumulative volume is
never incremented from trades, avoiding ticker/trade double counting. Metadata
JSON retains useful rules, settlement notional, strikes, and price-grid fields,
not every possible provider field. Deprecated titles fall back to `yes_sub_title`
or ticker. Metadata history/versioned rule changes are not separately archived.

## Universe selection

`KALSHI_RECORDER_MAX_MARKETS=25`, permitted range 1–100. Without explicit tickers:

1. Fetch at most three 200-market open pages, excluding MVE combinations; stop at
   exhaustion or a repeated cursor.
2. Deduplicate by ticker; require active/open status, an already reached open
   time, a future close time if supplied, and $1 binary contracts when type and
   notional metadata are supplied.
3. Sort by descending exact 24-hour volume, total volume, open interest, then
   ascending ticker; take at most the configured maximum.
4. Verify selected candidates with current metadata and a book. Implicit candidates
   that return HTTP 404 or are no longer open are logged and excluded before the
   universe is fixed. The run may consequently track fewer than the maximum;
   unavailable explicit tickers still fail visibly.

This deterministic ranking is within the returned candidate pool, not a global
liquidity ranking. Missing metrics rank as zero. Page contents and exchange state
can change between runs. The selected universe is fixed during a run; closed
markets remain in its history rather than being silently replaced. Known close
boundaries stop snapshots being labeled active even before the next metadata poll.

`KALSHI_TRACK_TICKERS=A,B` bypasses broad discovery. Tickers are trimmed,
deduplicated, sorted, fetched individually, and validated as currently open
binary markets. Invalid or closed explicit tickers fail startup visibly; the list
must fit the maximum. Restart with a new universe deliberately when needed.

## Reliability and lifecycle

WebSocket signing is `timestamp + GET + /trade-api/ws/v2` against the fixed demo
host. `ws` automatically returns Pong for Kalshi's Ping frames (documented every
10 seconds). The recorder also sends Ping every 10 seconds and terminates a
connection with no incoming control/data activity for 35 seconds. Missing
subscription acknowledgements also cause reconnect.

Disconnect, malformed book packet, negative reconstructed size, subscription
error, sequence gap, or a stale full book triggers fresh connection/subscriptions.
Subscription IDs and sequence tracking reset per connection; duplicates/older
sequenced packets are ignored. Sequence numbers are scoped to subscription ID,
not ticker. Old incremental book state is invalidated, and each market must
receive a fresh snapshot. Malformed ticker/trade messages are counted and skipped;
unknown future/control messages are ignored. Exchange ticker timestamps suppress
older ticker updates. Reconnect delay grows exponentially with jitter from
0.8–1 second up to 30 seconds, resetting only after a connection lasts 60 seconds.

The persistence FIFO retains at most 12 batches (at most 1,200 rows at the maximum
universe). DB failures retain the original frozen IDs/timestamps and back off up
to 30 seconds. Queue overflow drops the oldest batch and increments
`dropped_snapshots`; it never grows without bound. Startup and final writes have
three attempts with one-/two-second delays. Run counters reflect committed rows.
The queue is memory-only: abrupt process/host loss can lose pending batches.

SIGINT/SIGTERM freezes updates, stops scheduled work, closes the stream, tries to
flush queued observations and a final safe disconnected batch, marks the run
stopped/failed, and closes DB resources. An unavailable database may prevent final
status persistence; the process logs that failure and exits nonzero. A hard kill
can leave `status=running`; use `heartbeat_at` to identify abandoned runs. Startup
failures after run creation record a failed run. Errors are safe codes, not raw
provider bodies or driver messages that might contain credentials. Logs show
startup source/universe/interval/database/run ID and aggregate health every minute.

## Running and proving persistence

Set root `.env.local` (or `.env`; local overrides it) using `.env.example`.
Exported environment variables take precedence. Use a Neon PostgreSQL URL; TLS
is required for Neon and prepared statements are disabled for pooled compatibility.
An absolute demo private-key path avoids package-relative path ambiguity.

```sh
pnpm install
pnpm db:generate
pnpm db:check
pnpm db:migrate
pnpm worker:once
pnpm worker:record
# Ctrl+C for graceful shutdown.
```

For credential-free production-public reads:

```sh
KALSHI_RECORDER_SOURCE=production_public pnpm worker:once
```

Copy the run ID from startup/stop logs. Verify persisted state in the Neon SQL
editor or a PostgreSQL client (substitute that UUID below):

```sql
SELECT id, source, status, markets_tracked, snapshots_written,
       last_successful_observation_at, heartbeat_at, error, git_commit, git_dirty,
       reconnect_count, malformed_messages, dropped_snapshots
FROM worker_runs ORDER BY started_at DESC LIMIT 10;

SELECT r.id, r.source, r.snapshots_written, count(s.id) AS actual_rows,
       min(s.observed_at) AS first_observation, max(s.observed_at) AS last_observation
FROM worker_runs r LEFT JOIN market_snapshots s ON s.worker_run_id = r.id
WHERE r.id = 'replace-with-run-uuid'
GROUP BY r.id;

SELECT m.source, m.ticker, s.observed_at, s.yes_bid, s.yes_ask,
       s.yes_bid_size, s.yes_ask_size, s.volume, s.open_interest,
       s.book_verified_at, s.stale, s.transport
FROM market_snapshots s JOIN markets m ON m.id = s.market_id
WHERE s.worker_run_id = 'replace-with-run-uuid'
ORDER BY s.observed_at DESC, m.ticker LIMIT 50;

SELECT market_id, observed_at,
       observed_at - lag(observed_at) OVER
         (PARTITION BY worker_run_id, market_id ORDER BY observed_at) AS gap,
       stale
FROM market_snapshots
WHERE worker_run_id = 'replace-with-run-uuid'
ORDER BY market_id, observed_at;
```

A normal one-shot has one row per selected market and `status=completed`. A
continuous run should have growing snapshot counts, current heartbeat, and
freshness evidence. Verify actual rows; merely seeing a started process is not
proof. Never invoke `kalshi:smoke-order` for recorder validation.

## Limitations and research use

Five-second sampling omits intermediate ticks and cannot reconstruct queue
position or prove fillability. These are observations, not trading decisions or
backtesting results. Local receipt clocks should be synchronized; timestamps
across REST calls/markets are not atomic exchange-wide snapshots. REST public
polling has lower time resolution and no public trade summary. Empty/stale books,
rate limits, disconnects, queue overflow, and API schema changes need explicit
analysis. There is no automatic retention policy, partitioning, archived trade
tape, global universe refresh, durable queue, or backtesting engine in this
milestone. Plan storage/retention before scaling beyond the bounded universe.

See [EXP-001](../experiments/EXP-001-market-recorder/README.md) for success criteria.
No data-quality success or profitability is inferred from unit tests or short
smokes. Authenticated production trading remains impossible through this API.

## Production-public research

`packages/research` consumes stored snapshots with an explicit UTC window and
optional run/ticker selection. It does not contact Kalshi. See its
[definitions and query limits](../packages/research/README.md) and the immutable
[EXP-002 protocol](../experiments/EXP-002-production-microstructure/README.md).
Stale, disconnected, closed and missing-quote rows remain stored and are counted
as exclusions. Supplemental `depth.yesTop10` and `depth.noTop10` retain exact
prices/quantities needed for top-three executable YES-side imbalance.

## EXP-003 interpretation boundary

The maker simulator consumes the unchanged recorder through read-only research
queries, including historical book/ticker receipt timestamps. Its 7.5s receipt
freshness gate is stricter than the recorder stale flag. Repeated snapshots of
one received book cannot manufacture new execution evidence. Public REST has no
complete directed trade tape, so pessimistic queue depletion is unobservable.
Current market metadata does not retain historical fee overrides; fee applicability
must be documented in a separate evidence manifest or net P&L stays unavailable.
See the [frozen protocol](../experiments/EXP-003-maker-fill-simulator/README.md).
