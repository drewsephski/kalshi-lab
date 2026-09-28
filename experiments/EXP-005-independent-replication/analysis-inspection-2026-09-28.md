# EXP-005 analysis inspection — queue trade/book alignment

Before formal EXP-005 analysis, inspection found that `packages/research/src/trade-report.ts` computed nearest pre/post book matches for every trade but passed the complete per-ticker trade list to queue depletion. Queue depletion itself enforced provider-explicit direction, block-trade exclusion, price, activation, and expiry; it did not require the trade to have both valid nearby books.

The EXP-004 result is frozen and is not changed or regenerated. A read-only check of its committed result JSON found 47 unique trade IDs supporting relevant-flow candidates; all 47 have both pre- and post-book IDs in the archived `tradeAlignments` (`47/47`, 100%). Its 16 relevant-flow candidates and four queue-supported hypothetical fills therefore remain unchanged under the additional alignment requirement.

EXP-005 analysis will restrict queue depletion to trades with both valid pre- and post-books under the existing 7.5-second alignment function, which rejects stale/disconnected/non-open books. This leaves the frozen candidate strategy, queue arithmetic, and latency/expiry unchanged. The result will report this implementation correction and the exact source/analysis SHAs.

## Formal aggregation input limit

The first formal replication attempt successfully reproduced the archived EXP-004 queue metrics exactly, then failed before the EXP-005 report was written. The report command limited a selected universe to 100 tickers, while the committed five-session EXP-005 selection contains 125 distinct tickers (25 per session). The formal selection and collected evidence remain unchanged. The smallest fix is to raise the research report's bounded ticker cap to accommodate this frozen selection; it does not change market selection or strategy logic. Formal analysis will be rerun from a clean commit.
