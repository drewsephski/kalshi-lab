import assert from "node:assert/strict";
import test from "node:test";
import {
  combineCohortReports,
  type CohortReport,
} from "./replication-aggregation.ts";

function report(input: {
  from: string;
  to: string;
  tradeRunId: string;
  bookRunId: string;
  tradeId: string;
  candidateId: string;
  filled: boolean;
  snapshots: number;
  family: string;
}): CohortReport {
  const candidate = {
    candidateId: input.candidateId,
    simulationId: input.candidateId,
    family: input.family,
    queueFullyConsumed: input.filled,
    queueSupportedHypotheticalFill: input.filled,
    supportingTradeIds: [input.tradeId],
  };
  const run = {
    id: input.tradeRunId,
    startedAt: input.from,
    stoppedAt: input.to,
    status: "completed",
    error: null,
    gitCommit: "c".repeat(40),
    gitDirty: false,
    tradesWritten: 1,
    duplicatesSeen: 0,
    selectedTrades: 1,
    selectedNonBlockTrades: 1,
    config: { tickers: [`T-${input.family}`] },
  };
  const book = {
    id: input.bookRunId,
    startedAt: input.from,
    stoppedAt: input.to,
    status: "stopped",
    error: null,
    gitCommit: "c".repeat(40),
    gitDirty: false,
    snapshots: input.snapshots,
  };
  return {
    provenance: {
      gitCommit: "a".repeat(40),
      gitDirty: false,
      from: input.from,
      toExclusive: input.to,
      tradeRunIds: [input.tradeRunId],
      bookRunIds: [input.bookRunId],
      tradeDataSha256: input.tradeRunId,
      bookDataSha256: input.bookRunId,
      feeDataSha256: input.tradeRunId,
    },
    collection: {
      markets: 1,
      events: 1,
      seriesFamilies: [[input.family, 1]],
      trades: 1,
      nonBlockTrades: 1,
      uniqueTradeIds: 1,
      duplicatesSuppressed: 0,
      tradesPerMinute: 1,
      stableFieldPct: 100,
      maxExchangeToReceiptLagMs: 100,
      collectorRuns: [run],
      bookRuns: [book],
    },
    direction: {
      providerExplicit: 1,
      reconstructed: 0,
      ambiguous: 0,
      unmatched: 0,
      priceRelations: { trade_at_pre_bid: 1 },
    },
    alignment: {
      pre: 1,
      post: 1,
      both: 1,
      medianDelayMs: 100,
    },
    tradeAlignments: [
      {
        tradeId: input.tradeId,
        executedAt: input.from,
        preBookId: `${input.bookRunId}-pre`,
        postBookId: `${input.bookRunId}-post`,
        preDelayMs: 100,
        postDelayMs: 100,
      },
    ],
    queue: {
      candidateOrders: 1,
      observableRelevantFlow: 1,
      queueFullyConsumed: Number(input.filled),
      queueSupportedHypotheticalFills: Number(input.filled),
      unobservable: 0,
      concentration: {
        candidates: { byFamily: [], largestFamilySharePct: null, largestThreeSharePct: null },
        relevantFlow: { byFamily: [], largestFamilySharePct: null, largestThreeSharePct: null },
        queueSupportedHypotheticalFills: { byFamily: [], largestFamilySharePct: null, largestThreeSharePct: null },
      },
    },
    orderQueueEvidence: [candidate],
    fees: {
      eventsKnown: 0,
      eventsUnknown: 1,
      eventsConflicting: 0,
      eventClassifications: [{ eventTicker: `E-${input.family}`, classification: "fee_unknown" }],
      candidateCompletedContexts: 0,
      candidateContextKnownPct: null,
      queueSupportedContexts: {
        total: Number(input.filled),
        feeKnown: 0,
        feeUnknown: Number(input.filled),
        feeConflicting: 0,
        feeKnownCoveragePct: 0,
        byFamily: input.filled
          ? [{ eventTicker: `E-${input.family}`, family: input.family, classification: "fee_unknown" }]
          : [],
      },
      concentration: {
        publicTrades: { byFamily: [{ family: input.family, count: 1, sharePct: 100 }], largestFamilySharePct: 100, largestThreeSharePct: 100 },
        candidateOrders: { byFamily: [], largestFamilySharePct: null, largestThreeSharePct: null },
        relevantFlowCandidates: { byFamily: [], largestFamilySharePct: null, largestThreeSharePct: null },
        queueSupportedHypotheticalFills: { byFamily: [], largestFamilySharePct: null, largestThreeSharePct: null },
      },
      sourceSnapshots: [],
    },
  };
}

test("combined replication sums only the two cohort-scoped windows", () => {
  const combined = combineCohortReports(
    report({
      from: "2026-09-28T14:18:00.000Z",
      to: "2026-09-28T14:39:10.000Z",
      tradeRunId: "t1",
      bookRunId: "b1",
      tradeId: "trade-1",
      candidateId: "candidate-1",
      filled: true,
      snapshots: 25,
      family: "weather-MIA",
    }),
    report({
      from: "2026-09-28T16:00:00.000Z",
      to: "2026-09-28T16:20:00.000Z",
      tradeRunId: "t2",
      bookRunId: "b2",
      tradeId: "trade-2",
      candidateId: "candidate-2",
      filled: false,
      snapshots: 50,
      family: "soccer-BELFRA",
    }),
  );
  assert.equal(combined.collection.trades, 2);
  assert.equal(combined.collection.bookRuns.reduce((n, row) => n + row.snapshots, 0), 75);
  assert.deepEqual(combined.provenance.bookRunIds, ["b1", "b2"]);
  assert.equal(combined.queue.candidateOrders, 2);
  assert.equal(combined.queue.queueSupportedHypotheticalFills, 1);
  assert.equal(combined.fees.queueSupportedContexts.total, 1);
  assert.equal(combined.fees.concentration.publicTrades.byFamily.length, 2);
  assert.equal(combined.provenance.from, "2026-09-28T14:18:00.000Z");
  assert.equal(combined.provenance.toExclusive, "2026-09-28T16:20:00.000Z");
  assert.notEqual(combined.provenance.bookDataSha256, "b1");
});

test("combined replication rejects overlapping trade or candidate identities", () => {
  const left = report({
    from: "2026-09-28T14:18:00.000Z",
    to: "2026-09-28T14:39:10.000Z",
    tradeRunId: "t1",
    bookRunId: "b1",
    tradeId: "duplicate-trade",
    candidateId: "candidate-1",
    filled: false,
    snapshots: 25,
    family: "weather-MIA",
  });
  const right = report({
    from: "2026-09-28T16:00:00.000Z",
    to: "2026-09-28T16:20:00.000Z",
    tradeRunId: "t2",
    bookRunId: "b2",
    tradeId: "duplicate-trade",
    candidateId: "candidate-2",
    filled: false,
    snapshots: 50,
    family: "soccer-BELFRA",
  });
  assert.throws(() => combineCohortReports(left, right), /Duplicate trade/);
});
