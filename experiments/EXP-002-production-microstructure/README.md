# EXP-002: Production-public microstructure

Analysis version: `microstructure-v1`. Defined before any EXP-002 metrics are
computed or interpreted. EXP-001 base: `6b63fa2f5f07d9653b9750a02c08fc58179301d1`
(merged completed artifacts and anchored cadence correction). No orders.

Question: Do production-public Kalshi markets show spreads, persistence, and
displayed depth that warrant building a realistic maker fill simulator?

Hypothesis: More than one market in the existing bounded recorder universe has
repeated spreads of at least 2 cents, sampled persistence relevant to retail-speed
automation, and nontrivial displayed size. This is not a claim about returns.

## Protocol and fixed decision criteria

Use only persisted `kalshi_production_public` rows. Keep the recorder's existing
implicit universe selection and 5,000 ms cadence, maximum 25 markets. Target at
least two continuous hours; a shorter sample is preliminary and its verdict is
COLLECT MORE DATA regardless of encouraging descriptive statistics. Do not
replace markets after seeing their spreads. Preserve all exclusions and prior
experiment evidence. Collection and formal analysis must start from clean Git
commits and record exact SHAs, run IDs, and a UTC half-open selection window.

For a full sample, PROCEED TO FILL SIMULATOR requires at least three markets each
with at least 1,000 eligible observations over at least two hours, at least 10%
of observations at >=2 cents, at least ten >=2-cent episodes spanning multiple
observations, at least 20% of those episodes spanning >=10 seconds, and median
best bid AND ask size of at least ten contracts on >=2-cent observations.
Nontrivial depth and repeated persistence must occur together in those markets.
Observed volume increases are reported as activity context; time coverage alone
is not a claim of global liquidity or executed trading activity.

DEPRIORITIZE SPREAD CAPTURE requires a full sample and at least three markets
with 1,000 eligible observations each, where all such markets have <1% >=2-cent
observations OR every market meeting the spread-frequency criterion fails the
persistence/depth criteria. Also deprioritize if, in each of at least three
otherwise qualifying markets with >=100 matched wide observations at 60 seconds,
more than 70% have negative midpoint movement AND the median 60-second midpoint
change is <=-1 cent. These are research prioritization rules, not trade outcomes.
Otherwise COLLECT MORE DATA. No qualifying markets means insufficient evidence,
not evidence about the entire exchange. Never change criteria after output.

## Fixed metric definitions

- Spread: executable YES ask minus YES bid; integer ten-thousandths of a dollar.
  Thresholds >=1/2/3 cents mean >=100/200/300 price units. Locked books are allowed;
  crossed/invalid prices are excluded explicitly. Spread is not profit.
- Quality: sequential mutually exclusive exclusions: stale, disconnected,
  non-open/non-active snapshot status, missing bid/ask, invalid/crossed quote,
  duplicate market/run/timestamp. Also show overlapping raw quality flag counts.
  Use historical snapshot status, not current mutable market metadata.
- Sampled persistence: episode last timestamp minus first timestamp. One sample
  has zero observed duration; never extend to the next failing observation or
  beyond the selection window. Break on any excluded row, run boundary, or gap
  >7,500 ms (1.5 times default cadence). Never bridge rejected observations.
- Depth: best bid/ask sizes separately and conditioned on each spread threshold.
  Missing sizes remain missing; zero remains zero; quantities are displayed,
  never guaranteed fills. Sum top-three positive bid levels in each outcome.
- Imbalance: YES bids are buying depth; NO bids at price p imply executable YES
  selling depth at 1-p with identical quantity. Sort each outcome bid ladder by
  descending price; sum up to three available levels without padding. Use exact
  quantity integers for (buyDepth-sellDepth)/(buyDepth+sellDepth). Missing or
  malformed ladders, inconsistent best quote/size, or zero total => unavailable;
  no silently fabricated depth. Buckets: strong sell [-1,-0.6), moderate sell
  [-0.6,-0.2), balanced [-0.2,0.2], moderate buy (0.2,0.6], strong buy (0.6,1].
- Reference: executable midpoint, represented in half-price units to retain exact
  odd-price midpoints. Forward horizons 5/15/30/60 seconds: nearest strictly
  future eligible observation within +/-2,500 ms of target, ties choose earlier.
  Match only within the same continuous quality/run/gap segment and selection
  window. Report unmatched counts and actual elapsed-time distribution; no
  interpolation. Wide means >=2 cents. Report all/wide/imbalance-bucket groups.
- Adverse-selection proxy: for wide observations, future midpoint minus current
  best YES bid, and future midpoint minus current midpoint (down frequency).
  Hypothetical posting is not a fill; these are post-quote movements, not P&L.
- Statistics: linear-interpolated percentiles (index (n-1)*p), sample-weighted
  aggregate distributions, nullable empty summaries, percentage denominators
  stated by group. Retain per-market results to expose concentration.

## Limitations

Five-second sampled REST history omits exchange events. Polls are not simultaneous
across markets, and snapshots may repeat a last confirmed book until marked
stale. No production WebSocket authentication, queue position, fill simulator,
fee-based P&L, or guaranteed fill quantities. The fixed bounded pool can introduce
selection bias. Overlapping forward windows are dependent; association is not
causality or a validated predictive signal. Short runs and small buckets are
preliminary. Append dated results; never overwrite this protocol or EXP-001.
