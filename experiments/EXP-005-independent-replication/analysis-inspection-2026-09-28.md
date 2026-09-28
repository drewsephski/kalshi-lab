# EXP-005 analysis inspection — queue trade/book alignment

Before formal EXP-005 analysis, inspection found that `packages/research/src/trade-report.ts` computed nearest pre/post book matches for every trade but passed the complete per-ticker trade list to queue depletion. Queue depletion itself enforced provider-explicit direction, block-trade exclusion, price, activation, and expiry; it did not require the trade to have both valid nearby books.

The EXP-004 result is frozen and is not changed or regenerated. A read-only check of its committed result JSON found 47 unique trade IDs supporting relevant-flow candidates; all 47 have both pre- and post-book IDs in the archived `tradeAlignments` (`47/47`, 100%). Its 16 relevant-flow candidates and four queue-supported hypothetical fills therefore remain unchanged under the additional alignment requirement.

EXP-005 analysis will restrict queue depletion to trades with both valid pre- and post-books under the existing 7.5-second alignment function, which rejects stale/disconnected/non-open books. This leaves the frozen candidate strategy, queue arithmetic, and latency/expiry unchanged. The result will report this implementation correction and the exact source/analysis SHAs.

## Formal aggregation input limit

The first formal replication attempt successfully reproduced the archived EXP-004 queue metrics exactly, then failed before the EXP-005 report was written. The report command limited a selected universe to 100 tickers, while the committed five-session EXP-005 selection contains 125 distinct tickers (25 per session). The formal selection and collected evidence remain unchanged. The smallest fix is to raise the research report's bounded ticker cap to accommodate this frozen selection; it does not change market selection or strategy logic. Formal analysis will be rerun from a clean commit.

After raising the report-level cap, the next formal attempt reached the shared query validator, which independently capped ticker selections and distinct snapshot markets at 100. It stopped before writing a report. The same bounded multi-session limit needs to be raised at those two validation points; the selected ticker count remains 125 and the data remains unchanged.

## Combined window envelope

The first successful formal run wrote `result-2026-09-28.json` from analysis commit `446abb48a65d162b4e17f4eea8a7c32dd653e46e`. Its separate EXP-004 and EXP-005 reports used their committed windows, but its combined report used one broad envelope window for all run IDs. That admitted 225 post-window book snapshots from one EXP-004 book run after the frozen EXP-004 end (`14:39:10Z`). Candidate/flow/fill counts still equaled the sum of the separately windowed reports (358/54/9), but combined provenance must not include those extra observations. The successful attempt is preserved as `result-2026-09-28-envelope-attempt.json` (SHA-256 `dd1e062fe8713336a0e6d2f8ca0daa05cf7ccdd17d06a76eb9ba60f95f6dd68b`). The aggregation will be changed to combine the already scoped EXP-004 and EXP-005 reports, then formally rerun from a clean commit.

## Weighted combined family concentration

The first clean scoped-window replay ran from analysis commit `e156ccdcac1a0cc595c7dd40f91cfa0f83f0f52d` and produced the expected 48,361 scoped snapshots, but inspection found the combined public-trade concentration reducer treated each input family summary as one observation rather than weighting its `count`. This affects only the combined family concentration figures; cohort reports and queue totals were unchanged. The attempt is retained as `result-2026-09-28-aggregation-attempt.json` (SHA-256 `2f13c875b3c2cec0e3f98d96f15e5dd42f02aed46920cc46d30d4c95ea5beff4`). Fix the weighted aggregation and add a regression assertion before the final formal replay.
