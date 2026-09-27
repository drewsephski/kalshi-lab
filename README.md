# Kalshi Lab

Kalshi Lab is an experimental prediction-market research system. **Authenticated
trading is Kalshi demo only.** The market recorder collects data without placing
orders. Demo liquidity is not representative of production liquidity, and this
lab makes no profitability claims.

The initial experiment bankroll remains **$100 mock funds**. No recorder or
migration resets or changes that record or the live demo balance.

## Research milestone

EXP-001 is complete with **PASS WITH LIMITATIONS**. The corrected recorder met
the aggregate coverage and freshness criteria; see the dated [formal result](experiments/EXP-001-market-recorder/result-2026-09-27.md)
and preserved [baseline failure](experiments/EXP-001-market-recorder/baseline-failure-2026-09-27.md).
The next milestone is production-public microstructure analysis using the
credential-free read-only client. This is not a profitability claim; authenticated
trading remains demo-only.

## Workspace and architecture

- `apps/web`: unchanged Next.js research shell.
- `apps/cli`: explicit demo balance, markets, and bounded smoke-order commands.
- `apps/worker`: executable recorder with continuous and one-shot modes.
- `packages/kalshi`: demo authentication, REST market data, demo WebSocket
  protocol, exact normalization, and a separate credential-free public client.
- `packages/research`: read-only production-public microstructure metrics, bounded
  queries, and reproducible reports; see [usage](packages/research/README.md).
- `packages/db`: Drizzle schema, SQL migrations, Postgres.js connections, and
  transactional recorder queries compatible with Neon Postgres.
- `docs/market-data.md`: sources, fields, timing, reliability, and verification.
- `experiments/EXP-001-market-recorder`: data-quality question and success criteria.

```text
REST discovery / metadata          Demo ticker + orderbook + trade WebSocket
              └───────────────────────┬──────────────────────┘
                            normalized in-memory state
                                      │
                         snapshot scheduler (default 5s)
                                      │
                            bounded persistence queue
                                      │
                        Neon Postgres: markets / snapshots / runs
```

Production-public recording uses unsigned REST polling instead of WebSockets;
Kalshi currently requires authentication for every WebSocket connection. That
client accepts no credentials or custom host and exposes no order methods.
The authenticated client and signed WebSocket connection have fixed demo hosts.

## Setup

Use Node 24 or newer and pnpm 11, retaining the workspace lockfile:

```sh
pnpm install
cp .env.example .env.local
```

Commands load the root `.env`, then `.env.local` if present; `.env.local` takes
precedence, and exported shell variables take precedence over both. Never commit
credentials, private keys, or environment files. Save an unencrypted demo Ed25519
or RSA PEM outside version control, preferably with restrictive file permissions.

```env
DATABASE_URL=your-neon-postgres-url
KALSHI_ENV=demo
KALSHI_API_KEY_ID=your-demo-key-id
KALSHI_PRIVATE_KEY_PATH=/absolute/path/to/kalshi-demo.pem
KALSHI_RECORDER_SOURCE=demo
KALSHI_RECORDER_MAX_MARKETS=25
MARKET_SNAPSHOT_INTERVAL_MS=5000
```

Use an absolute private-key path to share the same configuration between the CLI
and worker. Relative paths resolve from the invoked package (`apps/cli` or
`apps/worker`). No authentication/users/organizations are added by this milestone.
The worker uses only `DATABASE_URL`; existing Neon Auth settings are unrelated.

Generate/validate migrations, apply them to the configured research database,
then write one snapshot per selected market:

```sh
pnpm db:generate
pnpm db:check
pnpm db:migrate
pnpm worker:once
pnpm worker:record
```

`worker:record` runs until SIGINT/SIGTERM (Ctrl+C). Defaults select at most 25 open
$1 binary markets from a bounded pool of at most three 200-market pages, excluding
MVE combinations. Ranking is descending 24-hour volume, total volume, open
interest, then ascending ticker. This is a ranking within that pool, not all of
Kalshi. The universe is fixed for each run. Explicit tickers are also supported:

```sh
KALSHI_TRACK_TICKERS=TICKER-A,TICKER-B pnpm worker:once
```

Credential-free production data is an explicit separate dataset:

```sh
KALSHI_RECORDER_SOURCE=production_public pnpm worker:once
KALSHI_RECORDER_SOURCE=production_public pnpm worker:record
```

Those commands require a database but do not use Kalshi API keys. Research must
filter or group by source and reject stale observations as appropriate. See
[market-data documentation](docs/market-data.md) for SQL proving rows were written
and for gaps, freshness, depth, trade-summary, and reconnect limitations.

## Read-only microstructure research

EXP-002 evaluates whether sampled spreads, displayed depth, and short-horizon
book behavior justify a later realistic fill simulator. Its [predefined
protocol](experiments/EXP-002-production-microstructure/README.md) is immutable.
The research package queries only persisted production-public rows; exclusions,
run IDs, a UTC half-open window, timing tolerances, and Git provenance are explicit.

```sh
pnpm research:microstructure --from 2026-09-27T20:00:00.000Z \
  --to 2026-09-27T23:00:00.000Z --runs YOUR-RUN-UUID \
  --json ../../artifacts/research/report.json --formal
```

Commit the implementation before using `--formal`. Reports include per-market
and aggregate spreads, observed sampled persistence, displayed sizes, top-three
YES-side imbalance, approximate forward midpoint movement and a post-quote
adverse-selection proxy. JSON paths resolve from `packages/research`; existing
files are never overwritten. These are not fill or trade P&L estimates. See
[research documentation](packages/research/README.md) for query limits and units.
The dated [EXP-002 result](experiments/EXP-002-production-microstructure/result-2026-09-27.md)
applies the predefined criteria to a stopped two-hour production-public run.

## Existing demo CLI

```sh
pnpm kalshi:balance
pnpm kalshi:markets
pnpm kalshi:smoke-order
```

Balance and markets are read-only. **The last command places an order** and is
never part of recorder checks or CI. It buys one post-only YES contract at a 1¢
limit, retrieves it, cancels it, and checks the same order. A failed cancellation
gets one best-effort cleanup retry; a successful cancellation is not repeated.
Cleanup can never create another order.

## Development verification

```sh
pnpm install
pnpm test
pnpm lint
pnpm check-types
pnpm build
pnpm db:generate
pnpm db:check
```

Tests require neither Kalshi nor Neon credentials. Persistence tests apply the
actual generated SQL migration to isolated PGlite PostgreSQL and exercise source
constraints, exact numerics, upserts, transactions, and retry idempotency.

## Research boundaries

This milestone has no strategies, automated orders, backtesting engine, P&L
optimization, WeatherNext, Grok/xAI, external sports/economic feeds, user auth,
billing, or dashboard redesign. Preserve prior results and the starting bankroll.
Future strategy changes must record a hypothesis, evaluation metrics, strategy
version, and Git commit SHA before interpreting results. Never weaken the
hard-coded demo boundary to enable authenticated production access.
