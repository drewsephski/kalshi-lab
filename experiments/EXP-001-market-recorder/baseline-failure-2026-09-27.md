# EXP-001 baseline formal run: September 27, 2026

This immutable record captures the first clean-SHA formal run before a cadence
correction. The run failed the predefined coverage criterion. Its database rows
and failure evidence remain in Neon and are not overwritten. The experiment
definition in `README.md` is unchanged.

## Provenance and configuration

- Git SHA: `80de494273c8d885d826921f0469a5b9eb81a704`
- Git dirty: `false`
- Recorder: `market-recorder-v1`
- Source: `kalshi_demo` (authenticated demo only)
- Run ID: `bfffe5f0-3277-4fa4-91a7-30e5ec216231`
- Run status: `stopped`; graceful SIGINT; `stopped_at` recorded
- Worker run start: `2026-09-27T18:42:08.838Z`
- Worker stop: `2026-09-27T19:12:33.103Z`
- Runtime: 30m 24.265s
- First observation: `2026-09-27T18:42:13.720Z`
- Last observation: `2026-09-27T19:12:32.707Z`
- Effective config: 25 markets, 5,000 ms snapshot interval, 120,000 ms stale
  threshold, continuous mode; no explicit tickers
- Actual markets tracked: 25

Required engineering gates passed before the run: `pnpm install`, `pnpm test`,
`pnpm lint`, `pnpm check-types`, `pnpm build`, `pnpm db:generate`, and
`pnpm db:check`. Migration generation reported no schema changes. The worker,
database, and Kalshi package tests were also run directly after the measurement:
11, 2, and 15 tests passed, respectively.

## Neon measurements

Coverage uses the first persisted observation as the initial opportunity, then
one opportunity every 5 seconds until shutdown. The interval from first
observation to worker stop was 1,819.383 seconds, yielding
`1 + floor(1,819.383 / 5) = 364` expected opportunities per market, or 9,100
aggregate. The deliberate final disconnected shutdown row is excluded from
actual scheduled observations.

| Metric | Measured result |
| --- | ---: |
| Scheduled observations expected | 9,100 |
| Scheduled observations persisted | 8,150 |
| Coverage | 89.56% |
| Missing scheduled observations | 950 (38 per market) |
| Total rows including final shutdown batch | 8,175 |
| Worker `snapshots_written` counter | 8,175 |
| Fresh scheduled observations | 7,970 / 8,150 (97.79%) |
| Stale scheduled observations | 180 / 8,150 (2.21%) |
| Stale rows including final shutdown batch | 205 / 8,175 (2.51%) |
| Deliberate final disconnected rows | 25 |
| Median observation interval | 5.419 s |
| Largest observed interval | 7.733 s |
| Rows per market | 327 total; 326 excluding final row |
| Reconnects / malformed messages / dropped snapshots | 0 / 0 / 0 |
| Duplicate `(run, market, observed_at)` rows | 0 |

All rows used `kalshi_demo`; every market and run source matched through the
database's composite foreign keys. All 25 markets had an initial row. Snapshot
row count matched the run counter. Price and quantity fields use the schema's
fixed-precision numeric columns; exact decimal normalization and persistence
behavior passed the directly executed package tests. No live source-byte
comparison is available in the stored schema.

Quote quality: 7 of 25 markets had at least one non-null executable quote;
622 of 8,175 rows had any non-null quote. The other 18 markets remained empty.
There were 7,553 rows with both sides empty, which is valid under the experiment
semantics when confirmed by the captured book. Volume and open interest were
non-null on all 8,175 rows. All 25 disconnected rows were the final shutdown
batch; no earlier disconnected rows were persisted.

The worker run's final error field was `market_read_HTTP_404` during a metadata
refresh late in the run. The recorder continued snapshotting all 25 selected
markets through shutdown. The worker does not retain per-ticker refresh errors,
so the exact 404 ticker cannot be identified retrospectively. No rows were
deleted or hidden.

## Reconnect and shutdown evidence

A controlled reconnect check used the same clean SHA and the existing injectable
stream seam. It used a separate 3-market demo run and forced a socket termination
15 seconds after initial connection:

- Run ID: `da940b17-50a1-4eef-a43a-b877ed7ebe6a`
- Git SHA / dirty: `80de494273c8d885d826921f0469a5b9eb81a704` / `false`
- Transport disconnected: `2026-09-27T19:15:45.663Z`
- Transport reconnected: `2026-09-27T19:15:46.907Z`
- Fresh order-book snapshot: `2026-09-27T19:15:47.022Z`
- Disconnect to fresh book: 1.359 s
- Run stopped cleanly with 21 rows and no pending batch

The formal 25-market run also stopped via SIGINT, flushed the final 25 rows,
recorded `status=stopped` and `stopped_at`, and left no active worker process.
No order command was invoked and no orders were placed.

Temporary database outage behavior was not induced against Neon. Directly run
worker tests passed the bounded FIFO/retry test (capacity is 12 batches and
overflow increments the dropped-row counter) and shutdown tests; direct database
tests passed transactional idempotency/counter checks. This is automated test
evidence, not a live Neon outage test.

## Predefined criteria result

| Criterion | Target | Result | Status | Evidence |
| --- | --- | --- | --- | --- |
| Associate every observation with market, source, and run | Every row linked and source-consistent | 8,175 rows satisfy references; one source only | PASS | Neon source counts and enforced composite foreign keys |
| Persist scheduled market observations | At least 95% | 8,150 / 9,100 = 89.56%; 38 missing per market | FAIL | Neon per-market counts; median interval 5.419 s |
| Persist fresh observations, excluding final shutdown rows | At least 95% non-stale | 7,970 / 8,150 = 97.79% | PASS | Neon stale flags |
| Preserve source and numeric integrity; retry without duplicate rows or counter inflation | No mixing, precision loss, duplicate writes, or double-counting | One demo source; exact-decimal tests pass; zero duplicates; 8,175 rows equals counter | PASS | Neon plus direct Kalshi and DB package tests |
| Recover after forced disconnect with a fresh book | Within 60 seconds | 1.359 s from disconnect to fresh book | PASS | Controlled same-SHA run `da940b17-50a1-4eef-a43a-b877ed7ebe6a` |
| Graceful SIGINT/SIGTERM shutdown | Flush when DB available and terminal status recorded | SIGINT stopped run, final batch persisted, terminal status and timestamp present | PASS | Formal run row and process exit |
| Temporary DB outage stays bounded and reports overflow | Recover or report bounded-queue drops | Bounded retry/queue behavior passes deterministic tests; no live Neon outage | PARTIAL | Direct worker tests; Neon was not disrupted |
| Place no orders and make no production-liquidity claim | Zero orders; demo only | No order command; all formal data is demo | PASS | Command record and run source |

## Anomalies and verdict

- Coverage failed because the recorder's five-second wait was followed by
  refresh/write work before the next wait began. This accumulated processing
  time into the observed interval.
- Some confirmed demo books were empty for the whole run; empty books are valid
  observations under the predeclared semantics, not fabricated quote data.
- A metadata refresh returned HTTP 404 late in the run; the worker retained all
  tracked markets and continued recording, but did not retain the failing
  ticker in its run diagnostics.
- No malformed packets, dropped snapshots, duplicate rows, source mixing, or
  unexpected disconnected rows were observed.

**EXP-001 baseline verdict: FAIL.** The recorder is not ready to proceed to
microstructure/profitability research because scheduled-observation coverage
was 89.56%, below the predeclared 95% threshold. This is not a profitability
finding. The cadence defect must be corrected and revalidated in a separate run
with its own SHA; this baseline remains failed evidence.
