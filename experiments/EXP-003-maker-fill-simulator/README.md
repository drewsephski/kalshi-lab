# EXP-003: Conservative Maker Fill Simulation

Immutable protocol, defined before simulation output. Base: EXP-002 commit
`37f32e29d03c09e9367c3486a05309bb668f9a13` (not merged at inspection).
Strategy `passive-yes-v1`; simulator `maker-simulator-v1`.

Question: Under conservative maker-fill assumptions, does a simple Kalshi
spread-capture strategy show positive net simulated expectancy across multiple
independent events? Hypothesis: a one-contract passive YES buy and partial-spread
exit may retain positive expectancy after fees, latency, and adverse movement.
This is unsigned production-public research only. No demo or production orders.
No bankroll changes. Preserve all earlier evidence, including losses.

## Frozen strategy and execution

Use the existing deterministic bounded universe unchanged: max 25 markets, three
200-market pages, implicit ranking, 5s snapshots. Never select on historical
spread or simulated performance. Development is the EXP-002 run
`e6a6d78b-7708-4155-8f6b-77e90a3fff53`. Evaluation consists of all continuous
sessions launched for this experiment after this protocol commit, in chronological
order; target two sessions of at least 10 minutes each while implementation runs.
Retain every attempted session, even failed/empty ones. Do not move evaluation
runs into development. Record exact IDs in a committed selection manifest before
formal evaluation. Evaluation events overlapping development are reported separately
and excluded from the independent out-of-sample conclusion. No parameter tuning.

Signal: fresh, connected, active/open, valid noncrossed two-sided YES book,
spread >=200 integer $0.0001 units (2c), bid and ask size each >=10 contracts.
Both book and ticker receipts must be no older than 7.5s, not future-dated.
Require a whole-cent bid and original ask (other grids are reported/excluded).
Post exactly one YES buy at the observed bid, never cross at activation.
Primary latency 1000ms; fixed sensitivity 0,250,500,1000,2500,5000ms, with 30s
entry expiry. Separately test 10s and 60s expiry only at 1000ms. No combinatorial
parameter search. Holding period is 60s from the hypothetical entry fill.
Target sell = original ask minus 1c (at least entry plus 1c).

An order is eligible to activate at T+latency, but sampling conservatively delays
its activation to the first independently refreshed book observed at/after that
time, within 7.5s. The activation sample cannot also fill the order. If already
marketable, reject post-only entry (or skip passive exit). Expiry is exclusive
at scheduled activation+wait. All fill evidence must be from strictly later book
receipts and observation times, within expiry and one continuous quality segment.
Never infer favorable intermediate quotes. Orders expire locally with no late
fill credit. Cancellation latency is conservatively applied to liquidation:
after holding deadline plus latency use the first fresh executable bid within
7.5s, minus a fixed 1c slippage haircut, floored at zero, with >=1 contract bid
size. No target-price floor. If unavailable, the position is unresolved, never
assigned a winning exit. Unresolved positions block subsequent market orders
for the session, appear separately, and prevent a passing verdict.

One opportunity per observed >=2c spread episode: attempt at the first sample
within that episode that also meets depth/quality/grid rules. No reattempt after
expiry/rejection/completion. A narrow spread resets the episode; missing rows,
quality breaks and gaps >7.5s do NOT grant a fresh opportunity within an otherwise
persistent wide spread. One active order/position per market; signals occurring
while busy are counted as suppressed and never queued. Sessions cannot overlap.

## Fill scenarios and queue uncertainty

All are hypothetical classifications, not calibrated probabilities. For both
entry and exit, activation records displayed queue ahead at our level, including
all displayed contracts at better prices. Entry queue is at least the signal's
best bid size. Missing/truncated ladder coverage is unknown, never zero. Quote
size loss alone can be cancellation and is never counted as executed volume.

- **optimistic** (upper-bound fill generosity, not a guaranteed P&L upper bound):
  after activation an independently refreshed opposite quote reaches or crosses
  the limit with >=1 contract executable size, accompanied by a strictly positive
  cumulative-volume change from the previous fresh observation. Buy: ask<=limit;
  sell: bid>=limit. This is a quote-transition/volume proxy, not proof that queue
  ahead traded. Mere unchanged quotes do not fill.
- **base**: require opposite quote strictly through limit on two consecutive
  independently refreshed samples (gap <=7.5s), and positive cumulative-volume
  change on the second sample. Buy: ask<limit; sell: bid>limit. Fill is assigned
  at the second sample and at the limit without price improvement. This stronger
  proxy assumes persistent through-price flow would reach us; it still does not
  prove queue consumption. Label `persistent_through_with_volume_proxy`.
- **pessimistic**: require identifiable, correctly directed, post-activation
  executed volume at/through the limit sufficient to consume the entire displayed
  queue ahead plus our contract, with complete queue/trade evidence. The existing
  REST snapshots do not provide this. Therefore v1 returns no fill, classified
  `queue_depletion_unobservable`, for this dataset. Never substitute cumulative
  volume (which includes other prices/sides) or quote cancellations for this tape.

Entry and passive exit apply the same scenario independently. No exit fills on
entry or activation samples. Queue measurements and evidence sample IDs/times
are retained in every deterministic ledger record. Unknown means no fill.

## Fees and exact arithmetic

Official sources checked 2026-09-28:
https://kalshi.com/docs/kalshi-fee-schedule.pdf (effective July 7, 2026),
https://kalshi.com/fee-schedule,
https://docs.kalshi.com/api-reference/market/get-series,
https://docs.kalshi.com/api-reference/events/get-event.
Formula per order: taker M*0.07*C*P*(1-P); maker M*0.0175*C*P*(1-P).
The PDF says fee+position cost rounds upward to a centicent ($0.0001); its
illustrative tables retain whole-cent amounts. Implement exact centicent formula
and additionally report conservative whole-cent rounding sensitivity. No rebates,
fee discounts or favorable rounding refunds. One integer contract per order.

Fee applicability requires an explicit evidence manifest keyed by event, including
series, maker/taker multipliers, effective UTC window, source URLs, and rationale.
Do not infer historical event overrides from a current series response. Unknown,
conflicting or temporally unverified rules => null fees/net, retained gross only,
excluded from primary net analysis and counted. Existing snapshots lack historical
fee/series override metadata; this may preclude a formal net conclusion. Do not
invent fees merely to populate a result. New metadata may be collected via unsigned
GET separately without altering recorder behavior. All monetary arithmetic uses
bigint fixed point; exact totals and rational means/medians are preserved in JSON.

## Metrics and independence

Report signals, suppressed signals, posted/rejected orders, entry/exit fills,
entry fills/posted orders, forced exits, unresolved positions, completed trades,
fee-known trades, gross, fees, net, mean/median net, win/loss/breakeven rates,
average win/loss, profit factor, and maximum drawdown. Drawdown is the largest
peak-to-trough decline of cumulative realized simulated net P&L in exit-time
order (deterministic ID ties), starting at zero. No annualization or dollars/day.
Unfilled orders have zero P&L but do not enter trade statistics. Unknown exit or
fees has null P&L, not zero. Gross-only and fee-known subsets remain distinct.

After every hypothetical entry fill, match nearest future midpoint at ~5/15/30/60s
within +/-2.5s, ties earlier, same continuous quality segment. Record actual delay,
midpoint change in exact half-price units, missing count, mean/median and negative
movement rate (adverse for a YES buy), even if position exited earlier.

Group by ticker, actual eventTicker, category (unknown if not derivable), worker
run, and conservative underlying event family. Sports player/line variants sharing
a league and dated game token count as ONE family; unsupported families count as
unknown and cannot satisfy independence. Different series on one game do not count
as independent. Report largest and largest-three shares of positive net trade P&L
by family and signed net-P&L shares (null if aggregate net<=0). Include zero-signal
markets in data coverage. No claim that different tickers establish independence.

## Frozen decision criteria

Formal evaluation must run from a clean committed implementation, with exact input
hash, protocol SHA, collection SHAs, windows and run IDs. All new evaluation runs
must be stopped, clean at collection start, implicit-universe, 5s continuous runs.
Failures remain listed. Minimum meaningful evaluation: 100 fee-known completed
base trades on independent evaluation events, >=5 independent families with >=10
such trades each, >=3 event families represented in collection, >=2 evaluation
sessions each >=10 minutes. Unknown families do not count. At least 95% of completed
base trades must have established fees, and no unresolved base positions.

PROCEED TO DEMO FORWARD TEST requires that coverage AND positive base net/mean,
nonnegative base net at 500/2500ms, positive base net in each evaluation session,
positive net under whole-cent fee rounding, largest family <40% and largest three
<80% of positive P&L, and reporting of pessimistic results. This merely authorizes
proposing a demo forward test; never implies actual profitability.

REJECT STRATEGY V1 requires the same meaningful coverage and base mean <=-1c per
completed trade with negative base net in each evaluation session. Otherwise
COLLECT MORE DATA. If coverage/independence is insufficient, explicitly label the
formal profitability conclusion INSUFFICIENT INDEPENDENT DATA. Insufficient fee
evidence is an additional blocker. Never weaken these criteria after results.

## Artifacts and limitations

Append dated markdown/JSON results with all scenarios and predeclared sensitivities,
source hashes, code SHA, ledger hash/path, exact split, per-event/session metrics,
exclusions and a single verdict. Large ledgers stay in ignored artifacts/research;
reproduction is via bounded read-only repeatable-read DB selection. Never mutate DB
from the simulator. No true queue position, no production WebSocket event stream,
5-second REST sampling, asynchronous receipt clocks, incomplete trading evidence,
disappearing displayed liquidity, uncertain simulated fills, selection dependence,
mutable metadata and historical behavior that may not persist. No live production
execution. No automated demo execution, ML, tuning, external signals or UI work.
