# EXP-001: Market recorder

Question: Can Kalshi Lab continuously collect sufficiently reliable market-state
history for later microstructure and strategy research?

This is a data-quality experiment, not a profitability test. There is no strategy
and no order submission. The initial experiment bankroll remains **$100 mock
funds**. Recording neither reads nor changes the bankroll.

Recorder version: `market-recorder-v1`. Each worker run records the exact Git HEAD
SHA and whether the checkout was dirty. Commit the implementation before a formal
measurement run so a clean SHA identifies the executed version. Keep run IDs,
configuration, logs, and SQL measurements with any future result entry. Do not
rewrite this question or success criteria after recording formal results.

## Success criteria defined before formal execution

Run the demo recorder for 30 minutes with 25 selected markets (or all eligible
markets when the available universe is smaller) and five-second snapshots.

- Every observation is associated with a market, source, and worker run.
- At least 95% of scheduled market observations are persisted; report observed
  gaps, missing initial markets, DB outage drops, and actual timing separately.
- At least 95% of persisted observations have `stale = false`, excluding the final
  shutdown batch. Empty confirmed books count as valid observations, not liquidity.
- No source mixing or precision loss occurs; reattempting a batch does not create
  duplicate rows or double-count run totals.
- Force one disconnect. Recording resumes with a new book snapshot within 60
  seconds of restored connectivity; invalid books are flagged in the intervening data.
- SIGINT/SIGTERM stops the process, flushes pending snapshots when the DB is
  available, and records a terminal run status.
- A temporary database outage recovers without unbounded memory growth. If the
  bounded queue fills, dropped observations are reported, never hidden.
- No orders are placed. Demo liquidity makes no claim about production liquidity.

## Results

No formal 30-minute experiment has been run. Local implementation tests are
engineering validation only. Add dated result files instead of modifying prior
results, and include the Git SHA, recorder version, configuration, run IDs,
coverage, stale fraction, reconnect timing, and failure evidence.
