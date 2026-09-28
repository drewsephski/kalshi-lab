# EXP-004 — Directed trade and fee provenance collection

Protocol frozen before collection or formal analysis. This experiment is read-only: unsigned production-public GETs, no authenticated production connection, no orders, no bankroll changes, and no changes to EXP-003's fill rules or evidence.

## Question and hypothesis

Can production-public trade and fee provenance improve Kalshi Lab's ability to model passive maker fills without favorable assumptions? The hypothesis is that stable individual trade records, explicit taker fields, bounded book alignment, and dated official fee evidence will make some hypothetical queue consumption observable. A trade tape still cannot reveal account-specific queue position, hidden liquidity, or cancellations.

## Sources and immutable selection

Official Kalshi API documentation and the fee schedule are checked on **2026-09-28** before implementation. Use `GET /markets/trades` for non-block trades, `GET /events/{event_ticker}`, `GET /series/{series_ticker}`, and `GET /events/fee_changes` only if live unsigned responses confirm the documented fields. Record source URLs, response metadata, and collection UTC times. Do not infer a historical fee window from current metadata alone.

Choose markets by the existing recorder's bounded public discovery: up to three 200-market pages, open non-MVE $1 binary markets ranked by 24-hour volume, total volume, open interest, then ticker; fix a maximum of 25 markets for a run. Log the selected tickers before interpreting outcomes. Use at least two separate collection sessions if feasible, seeking three independent event families and 500 individual trades. A family is the series ticker for this protocol; multiple markets in one event or series do not count as independent families. Do not swap markets because simulated outcomes are unfavorable.

Collector polling target: 10 seconds, at most two concurrent requests. Each poll uses a one-second overlap before the last persisted execution timestamp, paginates to the first older record, and deduplicates by provider trade ID. Cursor loops, page caps, API errors, and continuity gaps are explicit health failures. Timestamp ties require the overlap and ID deduplication. REST history ordering is verified; no silently truncated batch is accepted.

## Alignment and direction

Use valid same-market production-public book observations only. A pre-book must be observed at or before the trade and within **7.5 seconds**; a post-book at or after it and within **7.5 seconds**. Exclude stale/disconnected or missing books. Report each side separately and together, plus median absolute delay. Trades with provider taker outcome and book-side fields are provider-explicit only when the official semantics are unambiguous and fields are valid. Otherwise keep `aggressor_side=unknown`. A bounded price-to-pre-book reconstruction may label `trade_at_pre_ask`, `trade_at_pre_bid`, `trade_above_pre_ask`, `trade_below_pre_bid`, `inside_spread`, `ambiguous`, or `unmatched`; price-only direction is never promoted when both sides could explain it. Block trades are excluded from queue arithmetic.

Queue evidence uses the displayed same-side quantity at equal/better prices before activation. For a hypothetical one-contract resting order, count only unique, non-block, provider-directed executions at or through its limit whose taker direction consumes that resting side, during `[activation, expiry)`. Exact fixed-point arithmetic must show execution quantity **strictly greater than queue ahead** to reach our contract; `queue ahead + 1.00` supports a full hypothetical one-contract fill. Cancellations, quote-size changes, undirected trades, and aggregate volume count as zero. Report partial depletion distinctly. This is evidence for a hypothetical fill, never an actual fill claim.

## Fee evidence

Archive event/series response snapshots, event fee-change records, source URL, observation time, and documented effective time. Treat conflicting rules as conflicting. Current series/event fields without a dated effective window are current-only, not proof for earlier trades. The fee schedule PDF effective date is a lower bound only when the specific series or event rule is independently established for that window. Apply the event override over the series rule only within a proven window. Classify each candidate completed-trade context as `fee_known`, `fee_unknown`, or `fee_conflicting`; both entry and exit must be covered to count as known.

## Frozen decision gates

`PROCEED TO MAKER-SIMULATOR-V2` requires **all** of:

1. At least **500** unique public non-block trades across **3** series families, with at least **50** trades in each.
2. At least **80%** of received trades have stable IDs and valid timestamp, price, and size; no unresolved collector continuity failure in the formal window.
3. At least **60%** of trades have valid pre- and post-books under the fixed tolerance.
4. At least **50%** of trades relevant to candidate resting orders have mechanically supported aggressor direction (provider-explicit or defensibly reconstructed).
5. At least **50** fixed-strategy hypothetical maker opportunities have relevant observable directed flow, and at least **one** has full displayed-queue consumption. The strategy and order timing are EXP-003's frozen `passive-yes-v1` primary settings; no new parameter search.
6. At least **80%** of candidate completed-trade contexts have non-conflicting, historically applicable official fee evidence.

If the public endpoint lacks stable per-trade ID/time/price/size or defensible direction in live responses, verdict is `TRADE DATA INSUFFICIENT FOR QUEUE MODELING`. Otherwise any missed gate yields `COLLECT MORE EVIDENCE`. Never relax a gate after results. Report failed gates numerically, including zero denominators. Formal results include the code and protocol SHAs, run IDs, UTC windows, input hashes, duplicates, direction/alignment/queue/fee metrics, and unchanged EXP-003 retrospective classifications when windows overlap.

The only permitted verdicts are `PROCEED TO MAKER-SIMULATOR-V2`, `COLLECT MORE EVIDENCE`, and `TRADE DATA INSUFFICIENT FOR QUEUE MODELING`.
