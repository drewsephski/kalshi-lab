import { execFileSync } from "node:child_process";
import {
  ANALYSIS_VERSION,
  DEFAULT_OPTIONS,
  episodes,
  prepare,
  summarize,
  type Observation,
  type Options,
  type Sample,
} from "./microstructure.ts";
import { THRESHOLDS, fixed } from "./spread.ts";
import { stats } from "./statistics.ts";
export function gitProvenance() {
  return {
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    gitDirty: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
    ),
  };
}
export function createAnalysis(options: Options = DEFAULT_OPTIONS) {
  if (
    !Number.isSafeInteger(options.cadenceMs) ||
    options.cadenceMs <= 0 ||
    !Number.isSafeInteger(options.gapToleranceMs) ||
    options.gapToleranceMs < options.cadenceMs ||
    !Number.isSafeInteger(options.forwardToleranceMs) ||
    options.forwardToleranceMs < 0 ||
    options.forwardToleranceMs >= 5000
  )
    throw new Error("Invalid analysis timing options.");
  const perMarket: Omit<ReturnType<typeof analyzeMarket>, "samples">[] = [];
  const all: Sample[] = [];
  const episodeSets = THRESHOLDS.map(() => [] as ReturnType<typeof episodes>);
  let segmentOffset = 0;
  function analyzeMarket(ticker: string, rows: Observation[]) {
    const quality = prepare(rows, options);
    const times = quality.samples.map((s) => s.time);
    const volumeByRun = new Map<string, { first: bigint; last: bigint }>();
    for (const row of [...rows].sort(
      (a, b) => a.observedAt.getTime() - b.observedAt.getTime(),
    )) {
      if (row.stale || !row.connected || row.volume === null) continue;
      const value = fixed(row.volume, 2),
        existing = volumeByRun.get(row.workerRunId);
      if (existing) existing.last = value;
      else volumeByRun.set(row.workerRunId, { first: value, last: value });
    }
    return {
      ticker,
      total: quality.total,
      eligible: times.length,
      exclusions: quality.exclusions,
      rawFlags: quality.flags,
      observationGapsMs: stats(quality.gaps),
      firstEligible: times.length ? new Date(times[0]!).toISOString() : null,
      lastEligible: times.length ? new Date(times.at(-1)!).toISOString() : null,
      eligibleSpanMs: times.length ? times.at(-1)! - times[0]! : 0,
      observedVolumeChangeContracts: [...volumeByRun.values()].reduce(
        (sum, v) => sum + Number(v.last - v.first) / 100,
        0,
      ),
      metrics: summarize(quality.samples, options),
      samples: quality.samples,
    };
  }
  return {
    consume(ticker: string, rows: Observation[]) {
      const result = analyzeMarket(ticker, rows);
      const { samples: marketSamples, ...marketResult } = result;
      perMarket.push(marketResult);
      THRESHOLDS.forEach((t, i) =>
        episodeSets[i]!.push(...episodes(marketSamples, t)),
      );
      const maxSegment = marketSamples.reduce(
        (max, row) => Math.max(max, row.segment),
        0,
      );
      for (const sample of marketSamples)
        all.push({ ...sample, segment: sample.segment + segmentOffset });
      segmentOffset += maxSegment + 1;
    },
    finish() {
      const exclusions = {
        stale: 0,
        disconnected: 0,
        closed: 0,
        missingQuote: 0,
        invalidQuote: 0,
        duplicate: 0,
      };
      for (const m of perMarket)
        for (const key of Object.keys(
          exclusions,
        ) as (keyof typeof exclusions)[])
          exclusions[key] += m.exclusions[key];
      const total = perMarket.reduce((sum, m) => sum + m.total, 0);
      const marketResults = perMarket;
      return {
        analysisVersion: ANALYSIS_VERSION,
        options,
        markets: perMarket.length,
        total,
        eligible: all.length,
        excluded: total - all.length,
        exclusions,
        aggregate: summarize(
          all.sort((a, b) => a.time - b.time),
          options,
          episodeSets,
        ),
        perMarket: marketResults,
      };
    },
  };
}
export type Analysis = ReturnType<ReturnType<typeof createAnalysis>["finish"]>;
export function verdict(analysis: Analysis) {
  const covered = analysis.perMarket.filter(
    (m) => m.eligible >= 1000 && m.eligibleSpanMs >= 7200000,
  );
  const qualifying = covered.filter((m) => {
    const spread = m.metrics.spreadCents.thresholds[1]!,
      persist = m.metrics.persistence[1]!,
      depth = m.metrics.depth.thresholds[1]!;
    return (
      (spread.pct ?? 0) >= 10 &&
      persist.multiObservationEpisodes >= 10 &&
      (persist.lasting[1]!.pct ?? 0) >= 20 &&
      (depth.bidContracts.median ?? 0) >= 10 &&
      (depth.askContracts.median ?? 0) >= 10
    );
  });
  const adverse = qualifying.filter((m) => {
    const h = m.metrics.forward.find((g) => g.group === "wide >=2c")!
      .horizons[3]!;
    return (
      h.matched >= 100 &&
      (h.downPct ?? 0) > 70 &&
      (h.midpointChangeCents.median ?? 0) <= -1
    );
  });
  if (adverse.length >= 3)
    return {
      verdict: "DEPRIORITIZE SPREAD CAPTURE",
      reason:
        "Predefined adverse movement criterion met in at least three otherwise qualifying markets.",
      coveredMarkets: covered.length,
      qualifyingMarkets: qualifying.length,
    };
  if (qualifying.length >= 3)
    return {
      verdict: "PROCEED TO FILL SIMULATOR",
      reason:
        "At least three markets meet predefined coverage, spread, persistence, and displayed-depth criteria.",
      coveredMarkets: covered.length,
      qualifyingMarkets: qualifying.length,
    };
  if (
    covered.length >= 3 &&
    (covered.every(
      (m) => (m.metrics.spreadCents.thresholds[1]!.pct ?? 0) < 1,
    ) ||
      (covered.some(
        (m) => (m.metrics.spreadCents.thresholds[1]!.pct ?? 0) >= 10,
      ) &&
        qualifying.length === 0))
  )
    return {
      verdict: "DEPRIORITIZE SPREAD CAPTURE",
      reason:
        "Full-sample spread rarity or persistence/depth stop criterion met.",
      coveredMarkets: covered.length,
      qualifyingMarkets: qualifying.length,
    };
  return {
    verdict: "COLLECT MORE DATA",
    reason:
      "Insufficient full-duration cross-market evidence under predefined criteria; shorter samples are preliminary.",
    coveredMarkets: covered.length,
    qualifyingMarkets: qualifying.length,
  };
}
const fmt = (n: number | null, digits = 2) =>
  n === null ? "n/a" : n.toFixed(digits);
export function consoleSummary(analysis: Analysis) {
  const m = analysis.aggregate;
  const lines = [
    `Kalshi Lab — Production Microstructure (${analysis.analysisVersion})`,
    `Markets: ${analysis.markets} | Snapshots: ${analysis.total} | Eligible: ${analysis.eligible} | Excluded: ${analysis.excluded}`,
    `Exclusions: ${JSON.stringify(analysis.exclusions)}`,
    `SPREAD median ${fmt(m.spreadCents.median)}c / mean ${fmt(m.spreadCents.mean)}c`,
    ...m.spreadCents.thresholds.map((t) => `>=${t.cents}c: ${fmt(t.pct)}%`),
    ...m.persistence.map(
      (p) =>
        `PERSISTENCE >=${p.cents}c: ${p.episodes} episodes, median ${fmt(p.durationMs.median === null ? null : p.durationMs.median / 1000)}s, >=10s ${fmt(p.lasting[1]!.pct)}%, >=30s ${fmt(p.lasting[2]!.pct)}%`,
    ),
    `DEPTH median best bid ${fmt(m.depth.all.bidContracts.median)} / ask ${fmt(m.depth.all.askContracts.median)} contracts`,
    ...m.depth.thresholds.map(
      (d) =>
        `>=${d.cents}c depth bid ${fmt(d.bidContracts.median)} / ask ${fmt(d.askContracts.median)}; both >=10: ${fmt(d.bothAtLeast10Pct)}%`,
    ),
    `IMBALANCE ${m.imbalance.available} available / ${m.imbalance.unavailable} unavailable`,
    ...m.imbalance.buckets.map((b) => `${b.bucket}: ${b.observations}`),
  ];
  for (const group of m.forward) {
    lines.push(
      `FORWARD ${group.group} (changes in cents; approximate horizons)`,
    );
    for (const h of group.horizons)
      lines.push(
        `~${h.horizonMs / 1000}s: ${h.matched}/${h.observations} matched; mean ${fmt(h.midpointChangeCents.mean)}, median ${fmt(h.midpointChangeCents.median)}; up/flat/down ${fmt(h.upPct)}/${fmt(h.flatPct)}/${fmt(h.downPct)}%; actual median ${fmt(h.elapsedMs.median === null ? null : h.elapsedMs.median / 1000)}s${group.group === "wide >=2c" ? `; future mid minus current bid mean ${fmt(h.futureMidpointMinusCurrentBidCents.mean)}c (no fill assumed)` : ""}`,
      );
  }
  lines.push(
    `${verdict(analysis).verdict}: ${verdict(analysis).reason}`,
    "Observed sampled persistence and displayed liquidity only. No orders or fill/P&L model.",
  );
  return lines.join("\n");
}
