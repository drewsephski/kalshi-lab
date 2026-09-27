import assert from "node:assert/strict";
import test from "node:test";
import { spreadUnits, priceUnits, fixed } from "./spread.ts";
import { stats, percentile } from "./statistics.ts";
import { imbalance } from "./imbalance.ts";
import { matchForward } from "./forward-returns.ts";
import {
  prepare,
  episodes,
  summarize,
  movement,
  type Observation,
} from "./microstructure.ts";
import { createAnalysis, verdict } from "./report.ts";
function row(seconds: number, patch: Partial<Observation> = {}): Observation {
  return {
    id: String(seconds),
    workerRunId: "a",
    observedAt: new Date(seconds * 1000),
    stale: false,
    connected: true,
    status: "active",
    yesBid: "0.4700",
    yesAsk: "0.5000",
    yesBidSize: "10.00",
    yesAskSize: "20.00",
    volume: "100.00",
    supplemental: {},
    ...patch,
  };
}
const book = (yes = "10.00", no = "20.00") => ({
  depth: {
    yesTop10: [
      ["0.4700", yes],
      ["0.4600", "20.00"],
      ["0.4500", "30.00"],
      ["0.4400", "1000.00"],
    ],
    noTop10: [
      ["0.5000", no],
      ["0.4900", "20.00"],
      ["0.4800", "20.00"],
      ["0.4700", "1.00"],
    ],
  },
});
test("fixed-point cent thresholds and half-unit midpoints remain exact", () => {
  assert.equal(spreadUnits("0.47", "0.50"), 300);
  assert.equal(spreadUnits("0.49", "0.50"), 100);
  assert.equal(spreadUnits("0.4801", "0.50"), 199);
  assert.equal(spreadUnits("0.4800", "0.50"), 200);
  assert.equal(priceUnits("0.0001"), 1);
  assert.equal(fixed("9007199254740993.01", 2), 900719925474099301n);
  assert.throws(() => priceUnits("1.0001"));
  assert.throws(() => priceUnits("0.12345"));
  assert.throws(() => fixed("-1", 2));
  assert.throws(() => spreadUnits("0.6", "0.5"));
  const s = summarize(prepare([row(0, { yesBid: "0.4801" }), row(5)]).samples);
  assert.equal(s.spreadCents.thresholds[1]!.pct, 50);
  assert.equal(prepare([row(0, { yesBid: "0.4701" })]).samples[0]!.mid2, 9701);
});
test("statistics use linear interpolation and explicit empty values", () => {
  assert.equal(percentile([1, 2, 3, 4], 0.25), 1.75);
  assert.equal(stats([4, 1, 3, 2]).median, 2.5);
  assert.equal(stats([3]).p95, 3);
  assert.equal(stats([]).mean, null);
  assert.equal(summarize([]).spreadCents.thresholds[0]!.pct, null);
  assert.throws(() => stats([NaN]));
  assert.throws(() => percentile([], 2));
});
test("observed sampled episodes end at last qualifying sample", () => {
  const samples = prepare([
    row(15, { yesBid: "0.4900" }),
    row(0),
    row(10),
    row(5),
  ]).samples;
  assert.deepEqual(episodes(samples, 300), [
    { durationMs: 10000, observations: 3 },
  ]);
  assert.deepEqual(episodes(samples, 100), [
    { durationMs: 15000, observations: 4 },
  ]);
  assert.equal(summarize(samples).persistence[2]!.lasting[1]!.pct, 100);
  assert.deepEqual(episodes(prepare([row(0)]).samples, 300), [
    { durationMs: 0, observations: 1 },
  ]);
});
test("irregular gaps, quality failures, duplicates, and run boundaries break episodes", () => {
  assert.equal(
    episodes(prepare([row(0), row(7.5), row(15.001)]).samples, 300).length,
    2,
  );
  const result = prepare([
    row(0),
    row(5, { stale: true }),
    row(10),
    row(15, { yesAsk: null }),
    row(20),
    row(20, { id: "duplicate" }),
    row(25),
    row(30, { workerRunId: "b" }),
  ]);
  assert.equal(result.exclusions.stale, 1);
  assert.equal(result.exclusions.missingQuote, 1);
  assert.equal(result.exclusions.duplicate, 1);
  assert.equal(episodes(result.samples, 300).length, 5);
});
test("quality counts reconcile and zero/missing quantities remain distinct", () => {
  const result = prepare([
    row(0, { stale: true, connected: false, yesBid: null }),
    row(5, { connected: false }),
    row(10, { status: "closed" }),
    row(15, { yesBid: null }),
    row(20, { yesBid: "0.6" }),
    row(25, { yesBidSize: "0.00", yesAskSize: null }),
  ]);
  assert.deepEqual(result.exclusions, {
    stale: 1,
    disconnected: 1,
    closed: 1,
    missingQuote: 1,
    invalidQuote: 1,
    duplicate: 0,
  });
  assert.equal(result.flags.disconnected, 2);
  const d = summarize(result.samples).depth.all;
  assert.equal(d.bidContracts.median, 0);
  assert.equal(d.askContracts.median, null);
  assert.equal(d.missingAskSize, 1);
  assert.equal(
    result.total,
    result.samples.length +
      Object.values(result.exclusions).reduce((a, b) => a + b, 0),
  );
});
test("top-three imbalance uses exact complementary NO bids and fixed buckets", () => {
  assert.equal(imbalance(book(), 4700, 5000, "10.00", "20.00")?.value, 0);
  assert.equal(imbalance(book(), 4700, 5000, "10.00", "20.00")?.buyDepth, 60);
  assert.equal(imbalance(book(), 4700, 5000, "10.00", "20.00")?.sellDepth, 60);
  assert.equal(imbalance({}, 4700, 5000, "10.00", "20.00"), null);
  assert.equal(imbalance(book(), 4700, 5000, "9.00", "20.00"), null);
  assert.equal(imbalance(book(), 4700, 5100, "10.00", "20.00"), null);
  const one = (buy: string, sell: string) =>
    imbalance(
      { depth: { yesTop10: [["0.47", buy]], noTop10: [["0.50", sell]] } },
      4700,
      5000,
      buy,
      sell,
    );
  assert.equal(one("0.00", "0.00"), null);
  assert.equal(one("1.00", "4.00")?.bucket, "moderate sell-heavy"); // exactly -.6
  assert.equal(one("2.00", "3.00")?.bucket, "balanced"); // exactly -.2
  assert.equal(one("3.00", "2.00")?.bucket, "balanced"); // exactly +.2
  assert.equal(one("4.00", "1.00")?.bucket, "moderate buy-heavy"); // exactly +.6
  assert.equal(one("100.00", "1.00")?.bucket, "strong buy-heavy");
  assert.equal(one("1.00", "100.00")?.bucket, "strong sell-heavy");
});
test("nearest forward matching is future-only, bounded, and conservative at boundaries", () => {
  const timed = [
    { time: 0, segment: 1 },
    { time: 3000, segment: 1 },
    { time: 7000, segment: 1 },
    { time: 15000, segment: 2 },
  ];
  assert.equal(matchForward(timed, 0, 5000, 2500)?.time, 3000); // equal distance chooses earlier
  assert.equal(matchForward(timed, 0, 5000, 1000), null);
  assert.equal(matchForward(timed, 2, 5000, 2500), null);
  assert.equal(matchForward(timed, 3, 5000, 2500), null);
  const samples = prepare([
    row(0),
    row(7, { yesBid: "0.4500" }),
    row(14),
  ]).samples;
  const m = movement(samples, () => true, 5000, 2500);
  assert.equal(m.matched, 2);
  assert.equal(m.unmatched, 1);
  assert.equal(m.elapsedMs.median, 7000);
  assert.equal(m.downPct, 50);
  assert.equal(m.midpointChangeCents.mean, 0);
  assert.equal(m.futureMidpointMinusCurrentBidCents.median, 2);
});
test("forward matching never bridges a rejected observation or crosses markets/runs", () => {
  const interrupted = prepare([
    row(0),
    row(5, { stale: true }),
    row(10),
  ]).samples;
  assert.equal(movement(interrupted, () => true, 15000, 2500).matched, 0);
  const a = createAnalysis();
  a.consume("A", [row(0), row(5)]);
  a.consume("B", [row(0), row(5, { yesBid: "0.4500" })]);
  const combined = a.finish();
  assert.equal(combined.aggregate.forward[0]!.horizons[0]!.matched, 2);
  assert.equal(combined.aggregate.persistence[2]!.episodes, 2);
  assert.equal(
    combined.aggregate.forward[0]!.horizons[0]!.midpointChangeCents.mean,
    -0.5,
  );
  assert.equal(verdict(combined).verdict, "COLLECT MORE DATA");
  const overlapping = prepare([
    row(0),
    row(5),
    row(2, { workerRunId: "b" }),
    row(7, { workerRunId: "b" }),
  ]).samples;
  assert.equal(movement(overlapping, () => true, 5000, 2500).matched, 2);
  assert.equal(episodes(overlapping, 300).length, 2);
});

test("predefined decision criteria distinguish preliminary, sufficient, rare, thin, and adverse data", () => {
  function fixture(mode: "qualify" | "rare" | "thin") {
    const a = createAnalysis();
    for (const ticker of ["A", "B", "C"])
      a.consume(
        ticker,
        Array.from({ length: 1442 }, (_, i) =>
          row(i * 5, {
            yesBid: mode === "rare" || i % 13 === 12 ? "0.4900" : "0.4700",
            yesBidSize: mode === "thin" ? "1.00" : "10.00",
          }),
        ),
      );
    return a.finish();
  }
  const qualifying = fixture("qualify");
  assert.equal(verdict(qualifying).verdict, "PROCEED TO FILL SIMULATOR");
  assert.equal(verdict(qualifying).qualifyingMarkets, 3);
  assert.equal(verdict(fixture("rare")).verdict, "DEPRIORITIZE SPREAD CAPTURE");
  assert.equal(verdict(fixture("thin")).verdict, "DEPRIORITIZE SPREAD CAPTURE");
  const preliminary = structuredClone(qualifying);
  preliminary.perMarket.forEach((m) => (m.eligibleSpanMs = 7199999));
  assert.equal(verdict(preliminary).verdict, "COLLECT MORE DATA");
  const adverse = structuredClone(qualifying);
  adverse.perMarket.forEach((m) => {
    const h = m.metrics.forward.find((g) => g.group === "wide >=2c")!
      .horizons[3]!;
    h.downPct = 71;
    h.midpointChangeCents.median = -1;
  });
  assert.equal(verdict(adverse).verdict, "DEPRIORITIZE SPREAD CAPTURE");
  adverse.perMarket[0]!.metrics.forward.find(
    (g) => g.group === "wide >=2c",
  )!.horizons[3]!.matched = 99;
  assert.equal(verdict(adverse).verdict, "PROCEED TO FILL SIMULATOR");
});
