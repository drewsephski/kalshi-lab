# Production-public microstructure research

## Directed trade evidence (EXP-004)

Run `pnpm worker:trades --duration-minutes 10` alongside the existing `KALSHI_RECORDER_SOURCE=production_public pnpm worker:record` to capture public trade IDs, explicit taker direction, current fee metadata and nearby REST books. Trade collection always uses unsigned production-public GETs and takes no credentials. The frozen [EXP-004 protocol](../../experiments/EXP-004-trade-fee-provenance/README.md) defines sampling, alignment and verdict thresholds. The analysis command accepts explicit UTC windows and run IDs:

```sh
pnpm research:trade-report --from 2026-09-28T14:00:00.000Z \
  --to 2026-09-28T14:20:00.000Z --trade-runs UUID,UUID \
  --book-runs UUID,UUID --json ../../experiments/EXP-004-trade-fee-provenance/result-2026-09-28.json \
  --exp003-ledger ../../artifacts/research/EXP-003-2026-09-28.jsonl --formal
```

Paths resolve from `packages/research`; output uses exclusive creation. The report hashes selected trade, book and fee data. Queue counts are **hypothetical evidence**, not actual fills. Historical fee coverage requires effective windows, so current metadata by itself remains unknown.

Read-only analysis of persisted `kalshi_production_public` snapshots. No Kalshi
transport, credentials, or order operations. The microstructure command does not model fills or P&L. Uses the
existing database schema without moving research calculations into the DB package.

```sh
pnpm research:microstructure \
  --from 2026-09-27T20:09:16.942Z --to 2026-09-27T22:12:00.000Z \
  --runs e6a6d78b-7708-4155-8f6b-77e90a3fff53 \
  --json ../../artifacts/research/example.json --formal
```

Both UTC dates are required. Selection is `[from,to)`, at most seven days and
250,000 rows, 100 markets and 100 worker runs; narrow it with `--runs` or `--tickers`. `--source` accepts only
`kalshi_production_public`. The command loads root `.env` then `.env.local`, with
exported environment variables taking precedence. JSON paths are relative to
`packages/research` when using the root pnpm script. Reports never overwrite
existing files. Generated reports/logs in `artifacts/research` are ignored.

Queries use a read-only repeatable-read transaction, existing source/time and
market/time indexes, and 2,000-row keyset pages. Cursors retain canonical UTC PostgreSQL timestamp
precision; calculations use the recorder's millisecond UTC observation times. A selected-row count gate rejects
oversized selections instead of silently truncating them. The data-access layer
retains one market history at a time. Statistical accumulators retain bounded
numeric distributions for exact percentiles; memory remains proportional to the
explicit row cap. All selected fields (including quality failures) are hashed in
stable ticker/time/ID order to identify the actual analyzed dataset.

`--formal` requires a clean checkout throughout the query and stopped continuous
clean-SHA recorder runs with the predefined cadence. It rejects timing overrides.
Exploratory reports may use `--cadence-ms`, `--gap-ms`, and
`--forward-tolerance-ms`; those values always appear in provenance. Formal EXP-002
uses the immutable [protocol](../../experiments/EXP-002-production-microstructure/README.md).
Full-duration decision coverage must occur within one continuous worker run;
multiple short runs cannot be joined to fabricate it. Volume changes require at least two fresh connected observations per run; missing
volume context is unavailable and decreasing counters are flagged.
A formal invocation describes reproducibility, not sufficient sample size or an
endorsement of any outcome.

## Calculations

`spread.ts` parses decimal prices to integer 1/10,000-dollar units. Threshold
classifications and imbalance bucket boundaries use exact integers. Midpoints
use half-price units. Summary prices/movements are in cents, durations in ms,
quantities in displayed contracts. Quantity summaries convert exact decimal
integers to JavaScript numbers and are approximate at extremely large quantities;
imbalance sums and bucket comparisons remain exact. Percentiles interpolate
linearly at `(n-1)*p`. Aggregate distributions are observation-weighted, while
persistence duration distributions are episode-weighted. Empty metrics are null.

Quality exclusion counts are mutually exclusive in this priority: stale,
disconnected, closed/non-active, missing quote, invalid/crossed quote or quantity,
duplicate market/run/time. Raw quality flag counts overlap and are reported per
market. Historical snapshot status is used; current market status is mutable and
must not rewrite past eligibility. Missing sizes stay missing; zeros stay zero.

Persistence uses last-minus-first qualifying sample time, never extends to the
next failed sample, and breaks on rejected rows, run boundaries or gaps >7,500 ms.
Even a long episode means **observed sampled persistence**, not exchange-level
continuity. Single observations have zero duration.

YES selling depth is complementary NO buying depth: `YES ask = 1 - NO bid`,
with unchanged quantity. Imbalance sums each outcome's three highest bid levels
(or fewer when fewer exist), including prices farther from the best. It is a
fixed level scope, not a fixed price-distance band. Stored top-ten ladders contain
exact prices/sizes; inconsistent best quote/size, malformed/empty ladders, and
zero total are unavailable, counted explicitly. Bucket ranges are in the protocol.

Forward matching uses the nearest strictly future eligible observation in the
same continuous quality/run/gap segment within +/-2,500 ms of the requested
5/15/30/60 seconds. Ties choose the earlier sample. Report matched/unmatched counts
and elapsed-time distributions. No interpolation, gap bridging, cross-market or
cross-run matching. Imbalance associations use the entry observation's bucket;
future observations need eligible quotes, not the same bucket or wide spread.

Wide means >=2 cents. The adverse-selection proxy reports future midpoint minus
current midpoint, and future midpoint minus the hypothetical current best YES
bid. It does not assume an order existed or filled. Overlapping forward samples
are dependent, so associations are exploratory and not validated forecasts.

## Tests

`pnpm --filter @kalshi-lab/research test` uses synthetic snapshots and isolated
PGlite with the actual DB migrations. It requires no credentials, network, or
external services. Tests cover fixed-point thresholds, quantiles, quality counts,
persistence/gap boundaries, depth, imbalance, forward matching, source isolation,
pagination and selection caps. No production reads occur in the normal suite.

ESLint explicitly selects this package's TypeScript sources. TypeScript checks
undefined symbols and unused locals/parameters; Babel's JavaScript scope rules
are disabled for TS declarations to avoid false type-only warnings.

## Conservative maker simulation (EXP-003)

The separate `src/simulation` layer implements hypothetical passive YES orders.
It never imports a Kalshi transport or writes database rows. The immutable
[EXP-003 protocol](../../experiments/EXP-003-maker-fill-simulator/README.md)
predefines the rules and decision gates. The historical microstructure command
above is unchanged. The simulation command runs the fixed 24 scenario/settings
combinations; it does not rank or optimize them.

```sh
pnpm research:simulate-maker \
  --manifest ../../experiments/EXP-003-maker-fill-simulator/selection-2026-09-28.json \
  --json ../../artifacts/research/EXP-003-reproduction.json \
  --ledger ../../artifacts/research/EXP-003-reproduction.jsonl --formal
```

Run from a clean committed checkout. The committed selection manifest names the
protocol commit, full UTC window, development/evaluation IDs and any verified fee
rules. No overlapping sessions or moving evaluation into development. Unknown
fee validity means gross-only trades, null net values, and explicit exclusions.
The simulator does not fetch fees implicitly. Official metadata evidence is
retained separately from approved fee rules.

The existing read-only repeatable-read query adds receipt timestamps and event
identity only when simulation requests them; EXP-002's selected fields and hash
semantics remain unchanged. All rows, including quality failures, contribute to
the selected input hash. There is a 250,000-row input and per-scenario ledger cap.
Both output paths are create-only. Large JSONL ledgers belong in ignored
`artifacts/research`, with hashes in compact experiment evidence.

Currency fields are exact decimal dollars backed by bigint. Rational means and
medians retain dollar numerators and integer denominators. Movement is in half
$0.0001 units. Rates and concentration percentages are descriptive floating-point
ratios; classifications, fees and all P&L sums remain exact. Metrics report realized
completed trades; unresolved positions are separate and block continuation.
`exitFilled` means passive exit; `forcedExit` identifies liquidation. Net statistics
use only completed fee-known trades. Unfilled/rejected/suppressed orders do not
enter win/loss statistics. Empty expectancy is null, never a winning observation.

Queue sizes are measured in displayed contracts, not estimated execution volume.
Pessimistic v1 deliberately produces no fills because the current production REST
adapter has no complete queue/trade tape. The base model's two consecutive
through-price observations plus increasing volume remain a proxy, not proof of
actual execution. Receipt freshness is stricter than the recorder stale flag.

Family normalization merges sports player/line variants on the same dated game,
weather hourly/strike variants within each recognized city-day, and overlapping
Trump mention windows into one speaker exposure. The weather and mention identity
mapping was checked against unsigned public event metadata before evaluation.
Unsupported identities remain unknown and cannot satisfy independence thresholds.
Even recognized exposure groups are not proof of statistical independence.
