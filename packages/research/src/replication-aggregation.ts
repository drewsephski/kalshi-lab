import { createHash } from "node:crypto";

type FamilyRow = { family: string; count: number; sharePct: number | null };
type Concentration = {
  byFamily: FamilyRow[];
  largestFamilySharePct: number | null;
  largestThreeSharePct: number | null;
};
type QueueCandidate = {
  candidateId: string;
  simulationId: string;
  family: string;
  queueFullyConsumed: boolean;
  queueSupportedHypotheticalFill: boolean;
  supportingTradeIds: string[];
};
type CollectorRun = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  status: string;
  error: string | null;
  gitCommit: string;
  gitDirty: boolean;
  config: Record<string, any>;
  [key: string]: any;
};
type BookRun = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  status: string;
  error: string | null;
  gitCommit: string;
  gitDirty: boolean;
  [key: string]: any;
};
export type CohortReport = {
  provenance: Record<string, unknown>;
  collection: {
    markets: number;
    events: number;
    seriesFamilies: Array<[string, number]>;
    trades: number;
    nonBlockTrades: number;
    uniqueTradeIds: number;
    duplicatesSuppressed: number;
    tradesPerMinute: number;
    stableFieldPct: number | null;
    maxExchangeToReceiptLagMs: number | null;
    collectorRuns: CollectorRun[];
    bookRuns: BookRun[];
  };
  direction: {
    providerExplicit: number;
    reconstructed: number;
    ambiguous: number;
    unmatched: number;
    priceRelations: Record<string, number>;
    [key: string]: unknown;
  };
  alignment: {
    pre: number;
    post: number;
    both: number;
    medianDelayMs: number | null;
    [key: string]: unknown;
  };
  tradeAlignments: Array<Record<string, any> & { tradeId: string }>;
  queue: {
    candidateOrders: number;
    observableRelevantFlow: number;
    queueFullyConsumed: number;
    queueSupportedHypotheticalFills: number;
    unobservable: number;
    concentration: {
      candidates: Concentration;
      relevantFlow: Concentration;
      queueSupportedHypotheticalFills: Concentration;
    };
  };
  orderQueueEvidence: QueueCandidate[];
  fees: {
    eventsKnown: number;
    eventsUnknown: number;
    eventsConflicting: number;
    eventClassifications: Array<Record<string, any> & { eventTicker: string }>;
    candidateCompletedContexts: number;
    candidateContextKnownPct: number | null;
    queueSupportedContexts: {
      total: number;
      feeKnown: number;
      feeUnknown: number;
      feeConflicting: number;
      feeKnownCoveragePct: number | null;
      byFamily: Array<Record<string, any>>;
    };
    concentration: {
      publicTrades: Concentration;
      candidateOrders: Concentration;
      relevantFlowCandidates: Concentration;
      queueSupportedHypotheticalFills: Concentration;
    };
    sourceSnapshots: Array<Record<string, any>>;
  };
};

const pct = (n: number, d: number) =>
  d ? Math.round((n / d) * 10000) / 100 : null;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const addCounts = (rows: FamilyRow[]) => {
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(row.family, (counts.get(row.family) ?? 0) + row.count);
  const total = sum([...counts.values()]);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, count]) => ({ family, count, sharePct: pct(count, total) }));
};
const concentration = (rows: Array<{ family: string }>): Concentration => {
  const byFamily = addCounts(rows.map((row) => ({ family: row.family, count: 1, sharePct: null }))).sort(
    (a, b) => b.count - a.count || a.family.localeCompare(b.family),
  );
  return concentrationFromCounts(byFamily);
};
const concentrationFromCounts = (rows: FamilyRow[]): Concentration => {
  const byFamily = addCounts(rows).sort(
    (a, b) => b.count - a.count || a.family.localeCompare(b.family),
  );
  const total = sum(byFamily.map((row) => row.count));
  return {
    byFamily,
    largestFamilySharePct: byFamily[0]?.sharePct ?? null,
    largestThreeSharePct: total
      ? pct(sum(byFamily.slice(0, 3).map((row) => row.count)), total)
      : null,
  };
};
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
function assertUnique<T>(rows: T[], key: (row: T) => string, label: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) throw new Error(`Duplicate ${label} in cohort reports.`);
    seen.add(value);
  }
}

/** Combine already window-scoped cohort reports without widening either window. */
export function combineCohortReports(
  exp004: CohortReport,
  exp005: CohortReport,
): CohortReport {
  const collectorRuns = [...exp004.collection.collectorRuns, ...exp005.collection.collectorRuns].sort(
    (a, b) => String(a.startedAt).localeCompare(String(b.startedAt)),
  );
  const bookRuns = [...exp004.collection.bookRuns, ...exp005.collection.bookRuns].sort(
    (a, b) => String(a.startedAt).localeCompare(String(b.startedAt)),
  );
  assertUnique(collectorRuns, (row) => String(row.id), "trade run");
  assertUnique(bookRuns, (row) => String(row.id), "book run");
  const tradeAlignments = [...exp004.tradeAlignments, ...exp005.tradeAlignments].sort(
    (a, b) => String(a.executedAt).localeCompare(String(b.executedAt)) || a.tradeId.localeCompare(b.tradeId),
  );
  assertUnique(tradeAlignments, (row) => row.tradeId, "trade");
  const orderQueueEvidence = [...exp004.orderQueueEvidence, ...exp005.orderQueueEvidence];
  assertUnique(orderQueueEvidence, (row) => row.candidateId, "candidate");
  const events = [
    ...new Map(
      [...exp004.fees.eventClassifications, ...exp005.fees.eventClassifications].map((row) => [row.eventTicker, row]),
    ).values(),
  ];
  const queueContexts = [
    ...exp004.fees.queueSupportedContexts.byFamily,
    ...exp005.fees.queueSupportedContexts.byFamily,
  ];
  const feeKnown = queueContexts.filter((row) => row.classification === "fee_known").length;
  const feeUnknown = queueContexts.filter((row) => row.classification === "fee_unknown").length;
  const feeConflicting = queueContexts.filter((row) => row.classification === "fee_conflicting").length;
  const candidates = orderQueueEvidence.map((row) => ({ family: row.family }));
  const relevantFlow = orderQueueEvidence
    .filter((row) => row.supportingTradeIds.length > 0)
    .map((row) => ({ family: row.family }));
  const fills = orderQueueEvidence
    .filter((row) => row.queueSupportedHypotheticalFill)
    .map((row) => ({ family: row.family }));
  const publicTradeFamilies = addCounts([
    ...exp004.fees.concentration.publicTrades.byFamily,
    ...exp005.fees.concentration.publicTrades.byFamily,
  ]);
  const series = new Map<string, number>();
  for (const [ticker, count] of [...exp004.collection.seriesFamilies, ...exp005.collection.seriesFamilies])
    series.set(ticker, (series.get(ticker) ?? 0) + count);
  const activeTradeMs = collectorRuns.reduce((total, row) => {
    const start = Date.parse(String(row.startedAt));
    const stop = Date.parse(String(row.stoppedAt));
    return total + (Number.isFinite(start) && Number.isFinite(stop) ? Math.max(0, stop - start) : 0);
  }, 0);
  const trades = exp004.collection.trades + exp005.collection.trades;
  const preDelays = tradeAlignments.flatMap((row) => typeof row.preDelayMs === "number" ? [row.preDelayMs] : []);
  const postDelays = tradeAlignments.flatMap((row) => typeof row.postDelayMs === "number" ? [row.postDelayMs] : []);
  const relationCounts: Record<string, number> = {};
  for (const [key, count] of Object.entries(exp004.direction.priceRelations))
    relationCounts[key] = (relationCounts[key] ?? 0) + count;
  for (const [key, count] of Object.entries(exp005.direction.priceRelations))
    relationCounts[key] = (relationCounts[key] ?? 0) + count;
  const marketTickers = new Set(
    collectorRuns.flatMap((row) => (row.config?.tickers as string[] | undefined) ?? []),
  );
  const tradeIds = [...exp004.provenance.tradeRunIds as string[], ...exp005.provenance.tradeRunIds as string[]];
  const bookIds = [...exp004.provenance.bookRunIds as string[], ...exp005.provenance.bookRunIds as string[]];
  const from = [String(exp004.provenance.from), String(exp005.provenance.from)].sort()[0]!;
  const toExclusive = [String(exp004.provenance.toExclusive), String(exp005.provenance.toExclusive)].sort().at(-1)!;
  return {
    provenance: {
      ...exp005.provenance,
      from,
      toExclusive,
      tradeRunIds: tradeIds,
      bookRunIds: bookIds,
      tradeDataSha256: digest([exp004.provenance.tradeDataSha256, exp005.provenance.tradeDataSha256]),
      bookDataSha256: digest([exp004.provenance.bookDataSha256, exp005.provenance.bookDataSha256]),
      feeDataSha256: digest([exp004.provenance.feeDataSha256, exp005.provenance.feeDataSha256]),
    },
    collection: {
      markets: marketTickers.size,
      events: events.length,
      seriesFamilies: [...series].sort(([a], [b]) => a.localeCompare(b)),
      trades,
      nonBlockTrades: exp004.collection.nonBlockTrades + exp005.collection.nonBlockTrades,
      uniqueTradeIds: tradeAlignments.length,
      duplicatesSuppressed: exp004.collection.duplicatesSuppressed + exp005.collection.duplicatesSuppressed,
      tradesPerMinute: activeTradeMs ? trades / (activeTradeMs / 60000) : 0,
      stableFieldPct: pct(
        exp004.collection.trades * (exp004.collection.stableFieldPct ?? 0) +
          exp005.collection.trades * (exp005.collection.stableFieldPct ?? 0),
        trades,
      ),
      maxExchangeToReceiptLagMs: Math.max(
        exp004.collection.maxExchangeToReceiptLagMs ?? 0,
        exp005.collection.maxExchangeToReceiptLagMs ?? 0,
      ),
      collectorRuns,
      bookRuns,
    },
    direction: {
      providerExplicit: exp004.direction.providerExplicit + exp005.direction.providerExplicit,
      providerExplicitPct: pct(exp004.direction.providerExplicit + exp005.direction.providerExplicit, trades),
      reconstructed: exp004.direction.reconstructed + exp005.direction.reconstructed,
      reconstructedPct: pct(exp004.direction.reconstructed + exp005.direction.reconstructed, trades),
      ambiguous: exp004.direction.ambiguous + exp005.direction.ambiguous,
      ambiguousPct: pct(exp004.direction.ambiguous + exp005.direction.ambiguous, trades),
      unmatched: exp004.direction.unmatched + exp005.direction.unmatched,
      unmatchedPct: pct(exp004.direction.unmatched + exp005.direction.unmatched, trades),
      priceRelations: relationCounts,
    },
    alignment: {
      pre: exp004.alignment.pre + exp005.alignment.pre,
      prePct: pct(exp004.alignment.pre + exp005.alignment.pre, trades),
      post: exp004.alignment.post + exp005.alignment.post,
      postPct: pct(exp004.alignment.post + exp005.alignment.post, trades),
      both: exp004.alignment.both + exp005.alignment.both,
      bothPct: pct(exp004.alignment.both + exp005.alignment.both, trades),
      medianDelayMs: median([...preDelays, ...postDelays]),
    },
    tradeAlignments,
    queue: {
      candidateOrders: orderQueueEvidence.length,
      observableRelevantFlow: relevantFlow.length,
      queueFullyConsumed: orderQueueEvidence.filter((row) => row.queueFullyConsumed).length,
      queueSupportedHypotheticalFills: fills.length,
      unobservable: orderQueueEvidence.length - relevantFlow.length,
      concentration: {
        candidates: concentration(candidates),
        relevantFlow: concentration(relevantFlow),
        queueSupportedHypotheticalFills: concentration(fills),
      },
    },
    orderQueueEvidence,
    fees: {
      eventsKnown: events.filter((row) => row.classification === "fee_known").length,
      eventsUnknown: events.filter((row) => row.classification === "fee_unknown").length,
      eventsConflicting: events.filter((row) => row.classification === "fee_conflicting").length,
      eventClassifications: events,
      candidateCompletedContexts: exp004.fees.candidateCompletedContexts + exp005.fees.candidateCompletedContexts,
      candidateContextKnownPct: pct(
        (exp004.fees.candidateContextKnownPct ?? 0) * exp004.fees.candidateCompletedContexts +
          (exp005.fees.candidateContextKnownPct ?? 0) * exp005.fees.candidateCompletedContexts,
        exp004.fees.candidateCompletedContexts + exp005.fees.candidateCompletedContexts,
      ),
      queueSupportedContexts: {
        total: queueContexts.length,
        feeKnown,
        feeUnknown,
        feeConflicting,
        feeKnownCoveragePct: pct(feeKnown, queueContexts.length),
        byFamily: queueContexts,
      },
      concentration: {
        publicTrades: concentrationFromCounts(publicTradeFamilies),
        candidateOrders: concentration(candidates),
        relevantFlowCandidates: concentration(relevantFlow),
        queueSupportedHypotheticalFills: concentration(fills),
      },
      sourceSnapshots: [...exp004.fees.sourceSnapshots, ...exp005.fees.sourceSnapshots],
    },
  };
}
