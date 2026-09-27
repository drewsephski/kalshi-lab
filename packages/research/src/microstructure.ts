import { imbalance, BUCKETS, type Bucket } from "./imbalance.ts";
import { HORIZONS, matchForward } from "./forward-returns.ts";
import { priceUnits, quantity, spreadUnits, THRESHOLDS } from "./spread.ts";
import { percentage, stats } from "./statistics.ts";
export const ANALYSIS_VERSION = "microstructure-v1";
export interface Observation {
  id: string;
  workerRunId: string;
  observedAt: Date;
  stale: boolean;
  connected: boolean;
  status: string;
  yesBid: string | null;
  yesAsk: string | null;
  yesBidSize: string | null;
  yesAskSize: string | null;
  volume: string | null;
  supplemental: Record<string, unknown>;
}
export interface Options {
  cadenceMs: number;
  gapToleranceMs: number;
  forwardToleranceMs: number;
}
export const DEFAULT_OPTIONS: Options = {
  cadenceMs: 5000,
  gapToleranceMs: 7500,
  forwardToleranceMs: 2500,
};
const EXCLUSIONS = [
  "stale",
  "disconnected",
  "closed",
  "missingQuote",
  "invalidQuote",
  "duplicate",
] as const;
type Exclusion = (typeof EXCLUSIONS)[number];
export interface Sample {
  time: number;
  segment: number;
  spread: number;
  bid: number;
  mid2: number;
  bidSize: number | null;
  askSize: number | null;
  book: ReturnType<typeof imbalance>;
}
export function prepare(
  input: readonly Observation[],
  options = DEFAULT_OPTIONS,
) {
  const exclusions: Record<Exclusion, number> = {
    stale: 0,
    disconnected: 0,
    closed: 0,
    missingQuote: 0,
    invalidQuote: 0,
    duplicate: 0,
  };
  const flags = { stale: 0, disconnected: 0, closed: 0, missingQuote: 0 };
  // Process run histories independently, then sort by absolute time for matching.
  const rows = [...input].sort(
    (a, b) =>
      a.workerRunId.localeCompare(b.workerRunId) ||
      a.observedAt.getTime() - b.observedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const samples: Sample[] = [];
  const gaps: number[] = [];
  let previous: Observation | undefined,
    segment = 0;
  for (const row of rows) {
    const time = row.observedAt.getTime();
    if (!Number.isFinite(time))
      throw new Error("Invalid observation timestamp.");
    if (row.stale) flags.stale++;
    if (!row.connected) flags.disconnected++;
    if (!["active", "open"].includes(row.status)) flags.closed++;
    if (row.yesBid === null || row.yesAsk === null) flags.missingQuote++;
    const sameRun = previous?.workerRunId === row.workerRunId;
    const gap = sameRun ? time - previous!.observedAt.getTime() : null;
    if (gap !== null && gap > 0) gaps.push(gap);
    if (!sameRun || (gap !== null && gap > options.gapToleranceMs)) segment++;
    let reason: Exclusion | null = row.stale
      ? "stale"
      : !row.connected
        ? "disconnected"
        : !["active", "open"].includes(row.status)
          ? "closed"
          : row.yesBid === null || row.yesAsk === null
            ? "missingQuote"
            : null;
    if (!reason && sameRun && gap === 0) reason = "duplicate";
    if (!reason) {
      try {
        const bid = priceUnits(row.yesBid!);
        const spread = spreadUnits(row.yesBid!, row.yesAsk!);
        samples.push({
          time,
          segment,
          bid,
          spread,
          mid2: 2 * bid + spread,
          bidSize: quantity(row.yesBidSize),
          askSize: quantity(row.yesAskSize),
          book: imbalance(
            row.supplemental,
            bid,
            bid + spread,
            row.yesBidSize,
            row.yesAskSize,
          ),
        });
      } catch {
        reason = "invalidQuote";
      }
    }
    if (reason) {
      exclusions[reason]++;
      segment++;
    }
    previous = row;
  }
  samples.sort((a, b) => a.time - b.time || a.segment - b.segment);
  return { samples, total: rows.length, exclusions, flags, gaps };
}
export function episodes(samples: readonly Sample[], threshold: number) {
  const result: { durationMs: number; observations: number }[] = [];
  let first: Sample | undefined,
    last: Sample | undefined,
    count = 0;
  const flush = () => {
    if (first && last)
      result.push({ durationMs: last.time - first.time, observations: count });
    first = last = undefined;
    count = 0;
  };
  // Separate overlapping worker runs: interleaving must not destroy valid episodes.
  const ordered = [...samples].sort(
    (a, b) => a.segment - b.segment || a.time - b.time,
  );
  for (const row of ordered) {
    if (last && last.segment !== row.segment) flush();
    if (row.spread < threshold) {
      flush();
      continue;
    }
    first ??= row;
    last = row;
    count++;
  }
  flush();
  return result;
}
export function movement(
  samples: readonly Sample[],
  predicate: (s: Sample) => boolean,
  horizon: number,
  tolerance: number,
) {
  const moves: number[] = [],
    postBid: number[] = [],
    elapsed: number[] = [];
  let observations = 0;
  const segments = new Map<number, Sample[]>();
  for (const row of samples) {
    const group = segments.get(row.segment) ?? [];
    group.push(row);
    segments.set(row.segment, group);
  }
  for (const rows of segments.values())
    rows.forEach((row, index) => {
      if (!predicate(row)) return;
      observations++;
      const future = matchForward(rows, index, horizon, tolerance);
      if (!future) return;
      moves.push((future.mid2 - row.mid2) / 200); // cents, exact half-price units
      postBid.push((future.mid2 - 2 * row.bid) / 200);
      elapsed.push(future.time - row.time);
    });
  return {
    observations,
    matched: moves.length,
    unmatched: observations - moves.length,
    midpointChangeCents: stats(moves),
    futureMidpointMinusCurrentBidCents: stats(postBid),
    elapsedMs: stats(elapsed),
    upPct: percentage(moves.filter((v) => v > 0).length, moves.length),
    flatPct: percentage(moves.filter((v) => v === 0).length, moves.length),
    downPct: percentage(moves.filter((v) => v < 0).length, moves.length),
  };
}
export function summarize(
  samples: readonly Sample[],
  options = DEFAULT_OPTIONS,
  episodeSets = THRESHOLDS.map((t) => episodes(samples, t)),
) {
  const depth = (rows: readonly Sample[]) => ({
    observations: rows.length,
    bidContracts: stats(
      rows.flatMap((r) => (r.bidSize === null ? [] : [r.bidSize])),
    ),
    askContracts: stats(
      rows.flatMap((r) => (r.askSize === null ? [] : [r.askSize])),
    ),
    missingBidSize: rows.filter((r) => r.bidSize === null).length,
    missingAskSize: rows.filter((r) => r.askSize === null).length,
    bothAtLeast10Pct: percentage(
      rows.filter(
        (r) =>
          r.bidSize !== null &&
          r.askSize !== null &&
          r.bidSize >= 10 &&
          r.askSize >= 10,
      ).length,
      rows.length,
    ),
  });
  const groups: { name: string; predicate: (s: Sample) => boolean }[] = [
    { name: "all", predicate: () => true },
    { name: "wide >=2c", predicate: (s) => s.spread >= 200 },
    ...BUCKETS.map((b: Bucket) => ({
      name: b,
      predicate: (s: Sample) => s.book?.bucket === b,
    })),
  ];
  return {
    observations: samples.length,
    spreadCents: {
      ...stats(samples.map((r) => r.spread / 100)),
      thresholds: THRESHOLDS.map((threshold) => ({
        cents: threshold / 100,
        count: samples.filter((r) => r.spread >= threshold).length,
        pct: percentage(
          samples.filter((r) => r.spread >= threshold).length,
          samples.length,
        ),
      })),
      exactly1Pct: percentage(
        samples.filter((r) => r.spread === 100).length,
        samples.length,
      ),
      exactly2Pct: percentage(
        samples.filter((r) => r.spread === 200).length,
        samples.length,
      ),
    },
    persistence: THRESHOLDS.map((t, i) => {
      const eps = episodeSets[i]!;
      return {
        cents: t / 100,
        episodes: eps.length,
        multiObservationEpisodes: eps.filter((e) => e.observations > 1).length,
        durationMs: stats(eps.map((e) => e.durationMs)),
        lasting: [5000, 10000, 30000, 60000].map((ms) => ({
          ms,
          pct: percentage(
            eps.filter((e) => e.durationMs >= ms).length,
            eps.length,
          ),
        })),
      };
    }),
    depth: {
      all: depth(samples),
      thresholds: THRESHOLDS.map((t) => ({
        cents: t / 100,
        ...depth(samples.filter((s) => s.spread >= t)),
      })),
    },
    imbalance: {
      available: samples.filter((s) => s.book !== null).length,
      unavailable: samples.filter((s) => s.book === null).length,
      buyDepthContracts: stats(
        samples.flatMap((s) => (s.book ? [s.book.buyDepth] : [])),
      ),
      sellDepthContracts: stats(
        samples.flatMap((s) => (s.book ? [s.book.sellDepth] : [])),
      ),
      buckets: BUCKETS.map((b) => ({
        bucket: b,
        observations: samples.filter((s) => s.book?.bucket === b).length,
      })),
    },
    forward: groups.map((g) => ({
      group: g.name,
      horizons: HORIZONS.map((h) => ({
        horizonMs: h,
        ...movement(samples, g.predicate, h, options.forwardToleranceMs),
      })),
    })),
  };
}
