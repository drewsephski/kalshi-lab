# Kalshi Lab

<p align="center">
  <img src="assets/kalshi-lab-banner.jpg" alt="Kalshi Lab — market data, careful simulation, reproducible research" width="100%" />
</p>

Kalshi Lab is an experimental research system for understanding prediction-market
data and testing whether a trading idea survives realistic measurement. It brings
together a market-data recorder, a reproducible research pipeline, and conservative
simulation tools in one TypeScript monorepo.

**This is a research lab, not an automated trading bot. Authenticated trading is
fixed to Kalshi demo.** Public production market data may be collected separately
for read-only analysis. Demo liquidity does not represent production liquidity,
and no result here is a claim of profitability.

## The idea

Start with observable evidence, state a question before looking at outcomes, and
keep the full trail from market data to conclusion. The system is designed to
move through three steps:

1. **Observe** a bounded market universe and persist timestamped market state.
2. **Measure** data quality, spreads, depth, and short-horizon book behavior.
3. **Simulate** hypothetical execution with explicit assumptions, then report
   uncertainty and limitations alongside the result.

The starting experiment bankroll is **$100 in mock funds**. Recorder runs and
database migrations do not reset or change it. Experiments preserve their
hypotheses, criteria, failures, and dated results; strategy changes record the
hypothesis, evaluation metrics, strategy version, and Git commit SHA.

## Research status

| Experiment                                                                                            | Question                                                                                   | Current result                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EXP-001 · Market recorder](experiments/EXP-001-market-recorder/README.md)                            | Can the recorder meet predefined coverage and freshness targets?                           | **PASS WITH LIMITATIONS** — corrected cadence met aggregate criteria; the baseline failure is preserved. [Result](experiments/EXP-001-market-recorder/result-2026-09-27.md)                                                 |
| [EXP-002 · Production-public microstructure](experiments/EXP-002-production-microstructure/README.md) | Does sampled public data justify a more realistic fill simulator?                          | **PROCEED TO FILL SIMULATOR** — this is a research gate, not a profitability finding. [Result](experiments/EXP-002-production-microstructure/result-2026-09-27.md)                                                          |
| [EXP-003 · Maker fill simulation](experiments/EXP-003-maker-fill-simulator/README.md)                 | How does a fixed passive strategy behave under conservative hypothetical fill assumptions? | **COLLECT MORE DATA** — profitability conclusion is insufficient independent data. [Result](experiments/EXP-003-maker-fill-simulator/result-2026-09-28.md) · [Protocol](experiments/EXP-003-maker-fill-simulator/README.md) |
| [EXP-004 · Trade and fee provenance](experiments/EXP-004-trade-fee-provenance/README.md)               | Can public trades and official fee evidence support stronger maker-fill inference?         | **COLLECT MORE EVIDENCE** — trade direction and book alignment improved, but queue-flow and historical-fee gates were not met. [Result](experiments/EXP-004-trade-fee-provenance/result-2026-09-28.md) |

## How the system fits together

The repo pairs a small Next.js research shell with TypeScript services and
packages. Market collection, persistence, analysis, and simulation are separate
so the evidence path stays inspectable.

```text
Kalshi demo REST + authenticated demo WebSocket
                     │
                     ├── demo recorder ──────────────┐
                     │                               │
Kalshi public REST ──┴── read-only public recorder  │
                                                     ▼
                                         PostgreSQL snapshots
                                                     │
                                  bounded research queries
                                                     │
                         metrics, reports, hypothetical simulation
```

The public-data client takes no credentials or custom host and has no order
methods. Production-public recording uses unsigned REST polling; it does not use
WebSockets. Authenticated clients and signed WebSocket connections have fixed
demo hosts.

### Workspace

| Path                  | Role                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`            | Next.js research shell.                                                                                                                    |
| `apps/cli`            | Explicit demo balance, market-listing, and smoke-order commands.                                                                           |
| `apps/worker`         | One-shot and continuous market recorder, plus a bounded production-public trade collector.                                                |
| `packages/kalshi`     | Demo API clients, WebSocket protocol, market normalization, and credential-free public client.                                             |
| `packages/research`   | Read-only public-data metrics, reproducible reports, and conservative maker simulation. See [research usage](packages/research/README.md). |
| `packages/db`         | Drizzle schema, SQL migrations, and transactional Postgres queries.                                                                        |
| `docs/market-data.md` | Data sources, fields, timing, reliability, and verification.                                                                               |
| `experiments/`        | Frozen protocols and dated results.                                                                                                        |

## Quick start

Requirements: Node.js 24 or newer and pnpm 11. Keep the workspace lockfile.

```sh
pnpm install
cp .env.example .env.local
```

Configure the research database and, only for demo-authenticated commands, a
Kalshi demo key. Keep credentials and private keys out of version control. Store
the demo Ed25519 or RSA PEM outside the repo; use an absolute key path so the CLI
and worker resolve it consistently.

```env
DATABASE_URL=your-neon-postgres-url
KALSHI_ENV=demo
KALSHI_API_KEY_ID=your-demo-key-id
KALSHI_PRIVATE_KEY_PATH=/absolute/path/to/kalshi-demo.pem
KALSHI_RECORDER_SOURCE=demo
KALSHI_RECORDER_MAX_MARKETS=25
MARKET_SNAPSHOT_INTERVAL_MS=5000
```

Commands load root `.env`, then `.env.local`; `.env.local` takes precedence, and
exported shell variables take precedence over both. Relative private-key paths
resolve from the invoked package (`apps/cli` or `apps/worker`). The worker uses
only `DATABASE_URL`.

Prepare the database and collect one snapshot per selected market:

```sh
pnpm db:generate
pnpm db:check
pnpm db:migrate
pnpm worker:once
```

Run the recorder continuously with `pnpm worker:record`; stop it with
Ctrl+C (SIGINT) or SIGTERM. By default, each run selects at most 25 open $1
binary markets from a bounded pool of up to three 200-market pages, excluding
MVE combinations. It ranks this pool by descending 24-hour volume, total volume,
open interest, then ascending ticker. This is not a ranking of every Kalshi
market, and the chosen universe stays fixed for that run. To track explicit
markets instead:

```sh
KALSHI_TRACK_TICKERS=TICKER-A,TICKER-B pnpm worker:once
```

Credential-free production-public collection is a separate explicit source; it
requires a database but does not use Kalshi API keys:

```sh
KALSHI_RECORDER_SOURCE=production_public pnpm worker:once
KALSHI_RECORDER_SOURCE=production_public pnpm worker:record
```

Filter or group analysis by source and account for stale observations. See the
[market-data guide](docs/market-data.md) for persisted-row checks and known gaps,
freshness, depth, trade-summary, and reconnect limitations.

## Read-only analysis

EXP-002 examines sampled spreads, displayed depth, and short-horizon book behavior
to decide whether a later fill simulator is justified. The protocol is frozen;
the analysis uses persisted production-public rows with explicit run IDs, UTC
windows, exclusions, timing tolerances, and Git provenance.

```sh
pnpm research:microstructure --from 2026-09-27T20:00:00.000Z \
  --to 2026-09-27T23:00:00.000Z --runs YOUR-RUN-UUID \
  --json ../../artifacts/research/report.json --formal
```

Commit the implementation before using `--formal`. Reports include per-market
and aggregate spreads, observed sampled persistence, displayed sizes, top-three
YES-side imbalance, approximate forward midpoint movement, and a post-quote
adverse-selection proxy. These are measurements of sampled observations, not
fill or trade P&L estimates. JSON paths resolve from `packages/research`; an
existing output file is never overwritten. See [research usage](packages/research/README.md)
for bounds, definitions, and units.

EXP-003 runs a fixed set of hypothetical passive-maker scenarios against persisted
public data. It separates quote signals, uncertain fills, exits, fees, and
simulated P&L. It submits no demo or production orders. Unknown queue evidence
does not produce a pessimistic fill; unknown fee applicability excludes a trade
from primary net-P&L conclusions.

EXP-004 collects individual public trades and official fee metadata with a
separate read-only collector. Its result preserves provider taker direction,
nearby book observations, and queue-consumption evidence without changing the
EXP-003 simulator or claiming actual fills. See the [EXP-004 result](experiments/EXP-004-trade-fee-provenance/result-2026-09-28.md).

```sh
pnpm research:simulate-maker --help
```

Read the immutable [EXP-003 protocol](experiments/EXP-003-maker-fill-simulator/README.md)
and [simulation instructions](packages/research/README.md#conservative-maker-simulation-exp-003)
before a formal run.

## Demo commands

```sh
pnpm kalshi:balance
pnpm kalshi:markets
pnpm kalshi:smoke-order
```

Balance and market listing are read-only. **`kalshi:smoke-order` places one demo
order.** It buys one post-only YES contract at a 1¢ limit, retrieves and cancels
that same order, then checks it. If cancellation fails, it makes one best-effort
cleanup retry; it does not place a replacement order. This command is not part of
recorder checks or CI.

## Development checks

```sh
pnpm test
pnpm lint
pnpm check-types
pnpm build
pnpm db:generate
pnpm db:check
```

Tests require no Kalshi or Neon credentials. Persistence tests apply the generated
SQL migration to isolated PGlite PostgreSQL and exercise source constraints,
exact numerics, upserts, transactions, and retry idempotency.

## Research boundaries

- Authenticated Kalshi access is **demo only**; the production-public client is
  credential-free and read-only.
- Demo liquidity is not representative of production liquidity.
- Recorder and migration commands do not alter the starting mock bankroll or
  live demo balance.
- Preserve every experiment result, including unfavorable and incomplete runs.
  Do not revise a hypothesis or its criteria after results exist.
- No automated orders, strategy execution, P&L optimization, WeatherNext,
  Grok/xAI, external sports/economic feeds, user auth, billing, or dashboard
  redesign are part of this milestone.
