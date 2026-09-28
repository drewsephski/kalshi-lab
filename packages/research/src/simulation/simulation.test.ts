import assert from "node:assert/strict";
import test from "node:test";
import { fee, dollars, parseFeeRules } from "./fees.ts";
import { simulateMarket } from "./execution.ts";
import { fillEvidence } from "./fills.ts";
import { queueAhead } from "./queue.ts";
import { identify, prepareMaker } from "./strategy.ts";
import { concentration, maximumDrawdown, metrics } from "./metrics.ts";
import {
  validateSplit,
  decision,
  type Manifest,
  type Run,
} from "./protocol.ts";
import type { FeeRule, Ledger, MakerObservation, Settings } from "./types.ts";
const settings: Settings = {
  scenario: "base",
  latencyMs: 1000,
  expiryMs: 30000,
};
const event = "KXNFLTD-26SEP28BALDAL";
const rule: FeeRule = {
  eventTicker: event,
  seriesTicker: "KXNFLTD",
  makerMultiplier: "0",
  takerMultiplier: "1",
  from: "1970-01-01T00:00:00Z",
  toExclusive: "1970-01-02T00:00:00Z",
  evidence: ["https://kalshi.com/docs/kalshi-fee-schedule.pdf"],
  rationale: "Synthetic rule only.",
};
function row(
  seconds: number,
  patch: Partial<MakerObservation> = {},
): MakerObservation {
  const date = new Date(seconds * 1000);
  return {
    id: `s${seconds}`,
    workerRunId: "run",
    eventTicker: event,
    observedAt: date,
    bookReceivedAt: date,
    tickerReceivedAt: date,
    stale: false,
    connected: true,
    status: "active",
    yesBid: "0.4700",
    yesAsk: "0.5000",
    yesBidSize: "100.00",
    yesAskSize: "100.00",
    volume: "100.00",
    supplemental: {},
    ...patch,
  };
}
const below = { yesBid: "0.4500", yesAsk: "0.4600" };
function path(passiveExit = true) {
  return Array.from({ length: 21 }, (_, i) => {
    const s = i * 5;
    if (s < 10) return row(s);
    if (s < 25 || !passiveExit)
      return row(s, { ...below, volume: `${100 + i}.00` });
    return row(s, {
      yesBid: "0.5000",
      yesAsk: "0.5200",
      volume: `${100 + i}.00`,
    });
  });
}
const sim = (
  rows: MakerObservation[],
  patch: Partial<Settings> = {},
  rules: FeeRule[] = [rule],
) => simulateMarket("TEST", rows, { ...settings, ...patch }, rules);
test("official fee formula uses exact centicents, role, multiplier and conservative rounding", () => {
  assert.equal(dollars(fee(5000n, "1", "taker")), "0.0175");
  assert.equal(dollars(fee(5000n, "1", "maker")), "0.0044");
  assert.equal(dollars(fee(4700n, "1", "taker")), "0.0175");
  assert.equal(dollars(fee(5000n, "0.5", "taker")), "0.0088");
  assert.equal(dollars(fee(5000n, "1", "taker", true)), "0.0200");
  assert.equal(fee(0n, "1", "taker"), 0n);
  assert.equal(fee(10000n, "1", "maker"), 0n);
  assert.equal(fee(4700n, "0", "maker"), 0n);
  assert.throws(() => fee(10001n, "1", "maker"));
  assert.throws(() => fee(5000n, "-1", "maker"));
  assert.equal(dollars(-12345n), "-1.2345");
  assert.deepEqual(parseFeeRules([rule]), [rule]);
  assert.throws(() => parseFeeRules([{ ...rule, evidence: [] }]));
});
test("latency activation waits for a refreshed book and never fills at activation", () => {
  const result = sim(path());
  const first = result.ledger[0]!;
  assert.equal(first.scheduledActiveAt, new Date(1000).toISOString());
  assert.equal(first.orderActiveAt, new Date(5000).toISOString());
  assert.equal(first.entryFillAt, new Date(15000).toISOString());
  const slow = sim(path(), { latencyMs: 10000 }).ledger[0]!;
  assert.equal(slow.entryFilled, false);
  assert.equal(slow.entryFillEvidence, "post_only_would_cross");
  const reused = sim(path().map((r) => ({ ...r, bookReceivedAt: new Date(0) })))
    .ledger[0]!;
  assert.equal(reused.entryFilled, false);
  assert.equal(reused.status, "rejected");
});
test("expiration is exclusive and never extended by delayed activation", () => {
  assert.equal(sim(path(), { expiryMs: 14000 }).ledger[0]!.entryFilled, false); // expires exactly 15s
  assert.equal(sim(path(), { expiryMs: 14001 }).ledger[0]!.entryFilled, true);
  const l = sim(path(), { expiryMs: 1000 }).ledger[0]!;
  assert.equal(l.status, "rejected");
  assert.equal(l.netPnl, "0.0000");
});
test("optimistic/base/pessimistic differ without treating static quotes as fills", () => {
  const optimistic = sim(path(), { scenario: "optimistic" }).ledger[0]!;
  const base = sim(path()).ledger[0]!;
  const pessimistic = sim(path(), { scenario: "pessimistic" }).ledger[0]!;
  assert.equal(optimistic.entryFillAt, new Date(10000).toISOString());
  assert.equal(base.entryFillAt, new Date(15000).toISOString());
  assert.equal(pessimistic.entryFilled, false);
  assert.equal(pessimistic.entryFillEvidence, "queue_depletion_unobservable");
  for (const scenario of ["optimistic", "base", "pessimistic"] as const) {
    const l = sim(
      Array.from({ length: 20 }, (_, i) =>
        row(i * 5, {
          volume: `${100 + i}.00`,
          yesBidSize: i ? "1.00" : "100.00",
        }),
      ),
      { scenario },
    ).ledger;
    assert.equal(l.length, 1);
    assert.equal(l[0]!.entryFilled, false); // cancellation/volume do not prove execution at our level
  }
});
test("base requires two strict through samples and contemporaneous increasing volume", () => {
  const touch = path().map((r) =>
    r.observedAt.getTime() >= 10000
      ? { ...r, yesBid: "0.4600", yesAsk: "0.4700" }
      : r,
  );
  assert.equal(sim(touch).ledger[0]!.entryFilled, false);
  assert.equal(
    sim(touch, { scenario: "optimistic" }).ledger[0]!.entryFilled,
    true,
  );
  assert.equal(
    sim(path().map((r) => ({ ...r, volume: null }))).ledger[0]!.entryFilled,
    false,
  );
  assert.equal(
    sim(path().map((r) => ({ ...r, volume: "100.00" }))).ledger[0]!.entryFilled,
    false,
  );
  const samples = prepareMaker([
    row(0),
    row(5, { ...below, volume: "101.00" }),
  ]).samples;
  assert.equal(
    fillEvidence("base", "buy", 4700n, samples[0]!, samples[1]!, false),
    null,
  );
});
test("queue accounts for displayed size, better prices, missing and truncated ladders", () => {
  assert.equal(sim(path()).ledger[0]!.displayedQueueAhead, "100.00");
  const sample = prepareMaker([
    row(0, {
      supplemental: {
        depth: {
          yesTop10: [
            ["0.47", "100.00"],
            ["0.46", "50.00"],
          ],
        },
      },
    }),
  ]).samples[0]!;
  assert.equal(queueAhead(sample, "buy", 4700n), 10000n);
  assert.equal(queueAhead(sample, "buy", 4600n), 15000n);
  assert.equal(queueAhead(sample, "buy", 4500n), null);
  assert.equal(queueAhead(sample, "buy", 4800n), 0n);
  assert.equal(queueAhead(sample, "sell", 5100n), null);
});
test("passive exit has its own activation/evidence and exact gross/fee/net ledger", () => {
  const first = sim(path()).ledger[0]!;
  assert.equal(first.targetExitPrice, "0.4900");
  assert.equal(first.exitActiveAt, new Date(20000).toISOString());
  assert.equal(first.exitFillAt, new Date(30000).toISOString());
  assert.equal(first.exitFilled, true);
  assert.equal(first.forcedExit, false);
  assert.equal(first.grossPnl, "0.0200");
  assert.equal(first.netPnl, "0.0200");
  assert.equal(first.entryFee, "0.0000");
  assert.equal(first.postFill5s?.midpointChangeHalfUnits, "0");
  assert.equal(first.postFill15s?.midpointChangeHalfUnits, "1100");
});
test("forced liquidation uses first fresh later bid minus slippage with taker fees", () => {
  const first = sim(path(false)).ledger[0]!;
  assert.equal(first.entryFillAt, new Date(15000).toISOString());
  assert.equal(first.exitFillAt, new Date(80000).toISOString());
  assert.equal(first.exitFillPrice, "0.4400");
  assert.equal(first.grossPnl, "-0.0300");
  assert.equal(first.forcedExit, true);
  assert.equal(first.exitFilled, false);
  assert.equal(first.exitFee, "0.0173");
  assert.equal(first.netPnl, "-0.0473");
  assert.equal(first.wholeCentNetPnl, "-0.0500");
});
test("missing exit stays unresolved, excludes net and blocks further orders", () => {
  const rows = path(false).filter((r) => r.observedAt.getTime() < 75000);
  const first = sim(rows).ledger[0]!;
  assert.equal(first.status, "unresolved");
  assert.equal(first.netPnl, null);
  assert.equal(first.grossPnl, null);
  assert.equal(first.exitFillEvidence, "liquidation_unobservable");
  const m = metrics(sim(rows).ledger);
  assert.equal(m.unresolved, 1);
  assert.equal(m.completedTrades, 0);
});
test("missing fee evidence retains gross with null net, never defaults to free", () => {
  const l = sim(path(), {}, []).ledger[0]!;
  assert.equal(l.grossPnl, "0.0200");
  assert.equal(l.netPnl, null);
  assert.equal(l.entryFee, null);
  const m = metrics([l]);
  assert.equal(m.unknownFeeTrades, 1);
  assert.equal(m.netPnl, null);
  assert.equal(m.winRatePct, null);
  assert.equal(
    sim(path(), {}, [{ ...rule, toExclusive: new Date(20000).toISOString() }])
      .ledger[0]!.netPnl,
    null,
  );
  assert.equal(sim(path(), {}, [rule, rule]).ledger[0]!.netPnl, null);
});
test("one opportunity per spread episode, busy signals suppressed, no gap resets", () => {
  assert.equal(
    sim(Array.from({ length: 100 }, (_, i) => row(i * 5))).ledger.length,
    1,
  );
  const gappy = [
    row(0),
    row(5),
    row(50),
    row(55),
    row(60, { stale: true }),
    row(65),
  ];
  assert.equal(sim(gappy).ledger.length, 1);
  const result = sim(path()).ledger;
  assert.equal(result[1]!.status, "suppressed");
  assert.equal(result.length, 2);
  const reset = [
    ...Array.from({ length: 10 }, (_, i) => row(i * 5)),
    row(50, { yesBid: "0.49" }),
    row(55),
  ];
  assert.equal(
    sim(reset).ledger.filter((l) => l.status !== "suppressed").length,
    2,
  );
});
test("invalid partial evidence, duplicate clocks and quality gaps cannot fill", () => {
  const stale = path().map((r) =>
    r.observedAt.getTime() === 10000 ? { ...r, stale: true } : r,
  );
  assert.equal(sim(stale).ledger[0]!.entryFilled, false);
  const missing = path().map((r) => ({ ...r, bookReceivedAt: null }));
  assert.equal(sim(missing).ledger.length, 0);
  const fractional = [row(0, { yesBid: "0.4701" })];
  assert.equal(sim(fractional).ledger.length, 0);
  assert.equal(prepareMaker([row(0), row(0)]).exclusions.duplicate, 1);
  assert.equal(prepareMaker([row(0, { yesBidSize: "-1" })]).eligible, 0);
});
test("concentration counts underlying games, exact drawdown and net rates", () => {
  const base = sim(path()).ledger[0]!;
  const pnls = ["0.0200", "-0.0300", "0.0100", "-0.0400"];
  const ledger = pnls.map((netPnl, i): Ledger => ({
    ...base,
    simulationId: String(i),
    family: i === 0 ? "A" : "B",
    eventTicker: String(i),
    netPnl,
    exitFillAt: new Date(i * 1000).toISOString(),
  }));
  assert.equal(maximumDrawdown([200n, -300n, 100n, -400n]), 600n);
  const m = metrics(ledger);
  assert.equal(m.maximumDrawdown, "0.0600");
  assert.equal(m.netPnl, "-0.0400");
  assert.equal(m.winRatePct, 50);
  assert.equal(
    concentration(ledger).largestPositiveSharePct,
    (100 * 200) / 300,
  );
  assert.equal(concentration(ledger).byEvent[0]!.shareOfTotalNetPct, null);
  assert.equal(
    identify("A", "KXNFLREC-26SEP27BALDAL-BALPLAYER").family,
    identify("B", "KXNFLTD-26SEP27BALDAL").family,
  );
  assert.equal(identify("UNKNOWN", null).family, null);
  assert.equal(decision(ledger, [], [], 2).verdict, "COLLECT MORE DATA");
});
test("chronological split rejects leakage, missing runs and overlapping sessions", () => {
  const manifest: Manifest = {
    protocolCommit: "a".repeat(40),
    from: new Date(0).toISOString(),
    toExclusive: new Date(100000).toISOString(),
    developmentRuns: ["dev"],
    evaluationRuns: ["eval"],
    fees: [],
  };
  const run = (id: string, start: number, stop: number): Run => ({
    id,
    startedAt: new Date(start),
    stoppedAt: new Date(stop),
    status: "stopped",
    gitCommit: "a".repeat(40),
    gitDirty: false,
    config: {},
  });
  assert.doesNotThrow(() =>
    validateSplit([run("dev", 0, 1000), run("eval", 2000, 3000)], manifest),
  );
  assert.throws(
    () =>
      validateSplit([run("dev", 2000, 3000), run("eval", 0, 1000)], manifest),
    /strictly after/,
  );
  assert.throws(
    () =>
      validateSplit([run("dev", 0, 2500), run("eval", 2000, 3000)], manifest),
    /Overlapping/,
  );
  assert.throws(
    () => validateSplit([run("dev", 0, 1000)], manifest),
    /Missing/,
  );
});
test("deterministic replay is independent of input order", () => {
  assert.deepEqual(sim(path()), sim(path().reverse()));
});

test("independence collapses weather hours/strikes and overlapping speaker events", () => {
  assert.equal(
    identify("A", "KXTEMPCHIHS-26SEP2810").family,
    identify("B", "KXTEMPCHIH-26SEP2811").family,
  );
  assert.notEqual(
    identify("A", "KXTEMPCHIHS-26SEP2810").family,
    identify("B", "KXTEMPMIAH-26SEP2810").family,
  );
  assert.equal(
    identify("A", "KXTRUMPMENTION-26SEP28").family,
    identify("B", "KXTRUMPSAY-26OCT05").family,
  );
  assert.equal(
    identify("A", "KXTEMPMIAH-26SEP2810").category,
    "Climate and Weather",
  );
});

test("frozen verdict requires meaningful independent samples and rejects concentration/latency failures", () => {
  const base = sim(path()).ledger[0]!;
  const ledger = Array.from({ length: 100 }, (_, i): Ledger => ({
    ...base,
    simulationId: String(i),
    family: `family${i % 5}`,
    workerRunId: i < 50 ? "one" : "two",
    netPnl: "0.0200",
    wholeCentNetPnl: "0.0200",
  }));
  const sessions = ["one", "two"].map((id, i): Run => ({
    id,
    startedAt: new Date(i * 700000),
    stoppedAt: new Date(i * 700000 + 600000),
    status: "stopped",
    gitCommit: "a".repeat(40),
    gitDirty: false,
    config: {},
  }));
  assert.equal(
    decision(ledger, [ledger, ledger], sessions, 5).verdict,
    "PROCEED TO DEMO FORWARD TEST",
  );
  assert.equal(
    decision(ledger.slice(1), [ledger, ledger], sessions, 5).verdict,
    "COLLECT MORE DATA",
  );
  const negative = ledger.map((l) => ({
    ...l,
    netPnl: "-0.0100",
    wholeCentNetPnl: "-0.0200",
  }));
  assert.equal(
    decision(negative, [negative, negative], sessions, 5).verdict,
    "REJECT STRATEGY V1",
  );
  assert.equal(
    decision(ledger, [negative, ledger], sessions, 5).verdict,
    "COLLECT MORE DATA",
  );
  const concentrated = ledger.map((l) => ({
    ...l,
    netPnl: l.family === "family0" ? "1.0000" : "0.0001",
  }));
  assert.equal(
    decision(concentrated, [concentrated, concentrated], sessions, 5).verdict,
    "COLLECT MORE DATA",
  );
  assert.equal(
    decision(
      [...ledger, { ...base, status: "unresolved", netPnl: null }],
      [ledger, ledger],
      sessions,
      5,
    ).verdict,
    "COLLECT MORE DATA",
  );
});

test("asynchronous receipts from before activation cannot earn a fill", () => {
  const prepared = prepareMaker([
    row(5, {
      bookReceivedAt: new Date(4500),
      tickerReceivedAt: new Date(4500),
    }),
    row(10, {
      ...below,
      volume: "101.00",
      bookReceivedAt: new Date(4900),
      tickerReceivedAt: new Date(4900),
    }),
  ]);
  assert.equal(
    fillEvidence(
      "optimistic",
      "buy",
      4700n,
      prepared.samples[0]!,
      prepared.samples[1]!,
      false,
    ),
    null,
  );
  const entry = sim(path()).ledger[0]!;
  assert.equal(
    entry.entryFillClassification,
    "hypothetical_conservative_proxy",
  );
});
