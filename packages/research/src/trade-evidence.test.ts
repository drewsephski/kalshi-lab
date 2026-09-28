import assert from "node:assert/strict";
import test from "node:test";
import {
  alignTrade,
  classifyFeeWindow,
  queueAlignedTrades,
  queueConsumption,
  type EvidenceBook,
  type EvidenceTrade,
  type FeeEvidence,
} from "./trade-evidence.ts";

const at = (ms: number) => new Date(1_000_000 + ms);
const trade = (
  id: string,
  ms: number,
  quantity = "1.00",
  aggressorSide: EvidenceTrade["aggressorSide"] = "no_exposure",
  yesPrice = "0.4000",
): EvidenceTrade => ({
  tradeId: id,
  ticker: "T",
  executedAt: at(ms),
  yesPrice,
  quantity,
  aggressorSide,
  sideProvenance: aggressorSide === "unknown" ? "unknown" : "provider_explicit",
  isBlockTrade: false,
});
const book = (
  ms: number,
  overrides: Partial<EvidenceBook> = {},
): EvidenceBook => ({
  id: String(ms),
  workerRunId: "r",
  observedAt: at(ms),
  bookReceivedAt: at(ms),
  stale: false,
  connected: true,
  status: "open",
  yesBid: "0.4000",
  yesAsk: "0.4200",
  yesBidSize: "2.00",
  yesAskSize: "3.00",
  volume: "10.00",
  supplemental: {},
  ...overrides,
});

test("nearest valid pre/post books and bounded price relation", () => {
  const match = alignTrade(trade("a", 5000), [
    book(-3000),
    book(1000),
    book(7000),
    book(8000),
  ]);
  assert.equal(match.pre?.id, "1000");
  assert.equal(match.post?.id, "7000");
  assert.equal(match.preDelayMs, 4000);
  assert.equal(match.postDelayMs, 2000);
  assert.equal(match.relation, "trade_at_pre_bid");
  assert.equal(
    alignTrade(trade("b", 5000, "1.00", "unknown", "0.4100"), [book(1000)])
      .relation,
    "inside_spread",
  );
  assert.equal(
    alignTrade(trade("c", 5000), [book(1000, { stale: true })]).relation,
    "unmatched",
  );
});

test("queue evidence requires both books within the fixed alignment tolerance", () => {
  const aligned = trade("aligned", 5000);
  const noPre = trade("no-pre", 5000);
  const noPost = trade("no-post", 5000);
  assert.deepEqual(
    queueAlignedTrades([aligned], [book(4000), book(6000)]).map(
      (row) => row.tradeId,
    ),
    ["aligned"],
  );
  assert.deepEqual(queueAlignedTrades([noPre], [book(6000)]), []);
  assert.deepEqual(queueAlignedTrades([noPost], [book(4000)]), []);
  assert.deepEqual(
    queueAlignedTrades([aligned], [book(0), book(12_501)]),
    [],
  );
});

test("queue arithmetic excludes wrong side, blocks, duplicates, cancellations and expiry", () => {
  const cancelled = trade("cancel", 1000, "100.00", "unknown");
  const blocked = { ...trade("block", 2000, "100.00"), isBlockTrade: true };
  const result = queueConsumption({
    queueAhead: "2.00",
    orderedTrades: [
      cancelled,
      blocked,
      trade("wrong", 3000, "10.00", "yes_exposure"),
      trade("a", 4000),
      trade("a", 4000),
      trade("b", 5000),
      trade("late", 10_000),
    ],
    limitPrice: "0.4000",
    side: "yes_buy",
    activationTime: at(0),
    expiryTime: at(10_000),
  });
  assert.equal(result.queueConsumed, "2.00");
  assert.equal(result.queueFullyConsumed, true);
  assert.equal(result.ourFillReached, false);
  assert.deepEqual(result.supportingTradeIds, ["a", "b"]);
  const filled = queueConsumption({
    queueAhead: "2.00",
    orderedTrades: [trade("a", 4000, "2.00"), trade("b", 5000)],
    limitPrice: "0.4000",
    side: "yes_buy",
    activationTime: at(0),
    expiryTime: at(10_000),
  });
  assert.equal(filled.ourFillReached, true);
  const empty = queueConsumption({
    queueAhead: "0.00",
    orderedTrades: [],
    limitPrice: "0.4000",
    side: "yes_buy",
    activationTime: at(0),
    expiryTime: at(10_000),
  });
  assert.equal(empty.queueFullyConsumed, false);
  assert.throws(
    () =>
      queueConsumption({
        queueAhead: "0.00",
        orderedTrades: [trade("b", 5000), trade("a", 4000)],
        limitPrice: "0.4000",
        side: "yes_buy",
        activationTime: at(0),
        expiryTime: at(10_000),
      }),
    /ordered/,
  );
});

test("fees require complete dated window and reject conflicts", () => {
  const rule: FeeEvidence = {
    eventTicker: "E",
    seriesTicker: "S",
    observedAt: at(0),
    effectiveFrom: at(0),
    effectiveTo: at(10_000),
    feeType: "quadratic",
    makerMultiplier: "0.0000",
    takerMultiplier: "1.0000",
    sourceType: "official_event_fee_change_api",
  };
  assert.equal(classifyFeeWindow([rule], "E", at(1000), at(9000)), "fee_known");
  assert.equal(
    classifyFeeWindow([rule], "E", at(-1000), at(9000)),
    "fee_unknown",
  );
  assert.equal(
    classifyFeeWindow(
      [{ ...rule, effectiveFrom: null }],
      "E",
      at(1000),
      at(9000),
    ),
    "fee_unknown",
  );
  assert.equal(
    classifyFeeWindow(
      [rule, { ...rule, makerMultiplier: "1.0000" }],
      "E",
      at(1000),
      at(9000),
    ),
    "fee_conflicting",
  );
});
