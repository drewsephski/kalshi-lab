# EXP-005: Independent Production-Public Replication + Fee History

Protocol frozen before collection and formal analysis. This is unsigned, read-only production-public research. Do not authenticate to production, place orders, change bankroll records, alter EXP-003 strategy assumptions, or run maker-simulator-v2.

## Question and hypothesis

Across longer, temporally separated production-public sessions and independent event families, do enough hypothetical maker opportunities have observable directed trade flow and historically verifiable fee rules to support maker-simulator-v2?

Hypothesis: Additional independent sessions will materially increase queue-observable candidate orders and may establish sufficient dated fee provenance for at least some event/series families. This is not a profitability hypothesis.

EXP-004 is frozen and is not reinterpreted. Its `COLLECT MORE EVIDENCE` verdict, result files, 1,234 unique non-block trades, 95 candidate orders, 16 relevant-flow candidates, six fully consumed queues, four queue-supported hypothetical fills, and 0/10 event families with historically known fees remain unchanged.

## Collection and fixed strategy

Use only the existing production-public market/book recorder, public trade collector, official event/series/fee-change metadata collector, existing deterministic bounded universe, and committed clean code. A session pairs one continuous `KALSHI_RECORDER_SOURCE=production_public pnpm worker:record` run with one `pnpm worker:trades --duration-minutes 20` run. Target 20–30 minutes per session. Attempt at least three new sessions, separated in time when practical. Record every success and failure; failed sessions remain in the manifest and are excluded only with a reason. No manual ticker list or post-result universe substitution is allowed.

Freeze the formal selection manifest before analysis. Each selected window names book and trade run IDs, UTC boundaries, source, commit SHA, market tickers, event tickers and series families. The formal analysis selects only those IDs and windows; it never means “all current database rows.” Collection should overlap within one fixed market universe as much as the existing independently started workers permit. Record run UUIDs, dirty flags, exact code SHAs, UTC start/stop, selected markets, events, series, row counts, errors, collector duplicate sightings, pages, continuity/API failures, and maximum exchange-to-local receipt lag when available.

The queue analysis reuses EXP-004 alignment and the frozen EXP-003 `passive-yes-v1` candidate rules without edits: 2-cent minimum YES spread, minimum displayed depth 10 contracts on both sides, whole-cent bid/original ask, one-contract YES bid, 1,000ms latency, 30-second exclusive expiry, one attempt per eligible spread episode, and existing conservative queue-ahead arithmetic. Do not tune, widen the 7.5-second tolerance, or count cancellations, quote changes, undirected activity, aggregate volume, block trades, or price-only direction as executions. A trade used for queue arithmetic requires the same ticker, non-stale pre/post books within 7.5 seconds, explicit agreeing provider taker exposure, a non-block trade, a timestamp in `[activation, expiry)`, and a price at or through the YES bid limit that can consume it. Full displayed-queue consumption is separate from reaching queue-ahead plus one contract. Use the exact label **queue-supported hypothetical fill**.

Do not change or run the v1 P&L simulator. The replication analysis only evaluates frozen candidate episodes and directed queue evidence.

## Family identity and concentration

Use EXP-003's pre-existing `identify()` conservative underlying event-family grouping. Sports player/line variants on the same dated game and recognized weather thresholds in the same city/day share a family; unsupported identities are `unknown` and cannot satisfy an independence gate. Retain the family mapping version and do not create mappings after inspecting outcomes. Additionally report series-family counts. Calculate largest family share and largest three family share separately for public trades, candidates, relevant-flow candidates, and queue-supported hypothetical fills. A new-data family must be counted once regardless of market/ticker count.

## Historical fee evidence

Recheck current official mechanisms: `GET /events/{event_ticker}`, `GET /series/{series_ticker}`, `GET /events/fee_changes`, the current official fee schedule PDF and web page, official historical fee notices/change records if available, and current API/OpenAPI metadata. Retain URLs, retrieval time, raw-response SHA-256, normalized fields, and rationale. For every queue-supported context, attempt to establish event, series, effective-from, effective-to (or supported continuing applicability), fee type, maker applicability, maker multiplier and taker multiplier. Retain all supporting official source references. A null end date alone is not proof of historical continuity.

Keep **formula known** separate from **event/series applicability known**. The general schedule formula, current event/series fields, and current fee type do not establish a past rule without an official dated applicability window. A candidate context counts fee-known only when both the maker applicability and multipliers cover the complete hypothetical context window. Multiple incompatible official rules are `fee_conflicting`; absent/undated history is `fee_unknown`. Do not infer certainty. The archive shape includes `eventTicker`, `seriesTicker`, `effectiveFrom`, `effectiveTo`, `makerFeeApplicable`, `makerMultiplier`, `takerMultiplier`, `sourceType`, `sourceUrl`, `retrievedAt`, `rawResponseHash`, `rationale`, and all corroborating references.

## Frozen decision criteria

**PROCEED TO MAKER-SIMULATOR-V2** requires every gate below:

1. At least 5 temporally separated production-public sessions across EXP-004 + EXP-005, with EXP-005 adding at least 3 new sessions.
2. At least 5 independent series/event families represented in EXP-005, with no family accounting for more than 50% of its public trades.
3. At least 2,500 new unique non-block trades in EXP-005.
4. At least 150 fixed-strategy candidate maker opportunities across EXP-004 + EXP-005.
5. At least 50 combined candidate orders with relevant directed execution flow.
6. At least 10 combined queue-supported hypothetical fills across at least 3 independent event families.
7. At least 80% pre/post book alignment among trade records used for queue evidence, using the frozen 7.5-second tolerance.
8. Historically applicable official fee rules for at least 80% of queue-supported hypothetical fill contexts used in maker-simulator-v2.
9. No unresolved collector continuity failure contaminates selected formal windows.

Use **COLLECT MORE DATA** when infrastructure works but any sample-size, independence, queue-flow, fill-family, alignment, fee-coverage, or other data gate remains unmet.

Use **FEE HISTORY BLOCKED** only when the data gates are met but official public sources cannot establish historically applicable fee rules for the necessary contexts. A failure to gather enough queue evidence is never a fee-history blocker.

Never relax or reinterpret criteria after seeing results. Report each gate PASS/FAIL and its exact numerator, denominator, and threshold. Do not make any profitability claim.

## Reproducibility and result

Commit the protocol before formal collection or analysis. Commit implementation before formal collection. Run formal analysis from a clean committed checkout. Create `selection.json` before analysis and preserve it. The dated result Markdown and JSON record protocol commit/SHA-256, analysis commit/SHA and clean/dirty state, per-input hashes, selected and failed run IDs, windows and exclusions, raw and deduplicated counts, trade/book alignment, candidates/flow/queue evidence, family concentration, fee evidence and classifications, official-source provenance table, gate table, and exactly one permitted verdict. Report EXP-004, EXP-005, and combined values separately, with concentration analysis and whether combined counts depend disproportionately on EXP-004.

No maker-simulator-v2 P&L run or orders are part of this experiment. If every gate passes, stop after documenting **PROCEED TO MAKER-SIMULATOR-V2**; simulator work belongs to the next protocol stage.
