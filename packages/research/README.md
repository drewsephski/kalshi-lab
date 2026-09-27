# Production-public microstructure research

Read-only analysis of persisted `kalshi_production_public` snapshots. No Kalshi
transport, credentials, order operations, fill model, or fee-based P&L. Uses the
existing database schema without moving research calculations into the DB package.

```sh
pnpm research:microstructure \
  --from 2026-09-27T20:09:16.942Z --to 2026-09-27T22:12:00.000Z \
  --runs e6a6d78b-7708-4155-8f6b-77e90a3fff53 \
  --json ../../artifacts/research/example.json --formal
```

Both UTC dates are required. Selection is `[from,to)`, at most seven days and
250,000 rows; narrow it with `--runs` or `--tickers`. `--source` accepts only
`kalshi_production_public`. The command loads root `.env` then `.env.local`, with
exported environment variables taking precedence. JSON paths are relative to
`packages/research` when using the root pnpm script. Reports never overwrite
existing files. Generated reports/logs in `artifacts/research` are ignored.

Queries use a read-only repeatable-read transaction, existing source/time and
market/time indexes, and 2,000-row keyset pages. A selected-row count gate rejects
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
