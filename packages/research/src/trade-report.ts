import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  createDatabase,
  feeRuleSnapshots,
  marketTrades,
  tradeCollectorRuns,
} from "@kalshi-lab/db";
import { queryResearch } from "./queries.ts";
import { simulateMarket } from "./simulation/execution.ts";
import { identify } from "./simulation/strategy.ts";
import type { Ledger, MakerObservation } from "./simulation/types.ts";
import {
  alignTrade,
  classifyFeeWindow,
  queueAlignedTrades,
  queueConsumption,
  type EvidenceBook,
  type EvidenceTrade,
  type FeeEvidence,
} from "./trade-evidence.ts";

const PROTOCOL_SHA = "1783627743117647529390843560ef871ae1ac80";
const PROTOCOL_PATH = "experiments/EXP-004-trade-fee-provenance/README.md";
const sortedIds = (value: string | undefined) =>
  [...new Set(value?.split(",").filter(Boolean) ?? [])].sort();
const pct = (n: number, d: number) =>
  d ? Math.round((n / d) * 10000) / 100 : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const i = Math.floor(values.length / 2);
  return values.length % 2 ? values[i]! : (values[i - 1]! + values[i]!) / 2;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function readExp003(
  path: string,
  tradesByTicker: Map<string, EvidenceTrade[]>,
) {
  const result = {
    compared: 0,
    changed: 0,
    changes: [] as {
      simulationId: string;
      previous: string;
      newEvidence: string;
    }[],
  };
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const row = JSON.parse(line) as Ledger;
    if (
      row.fillScenario !== "pessimistic" ||
      row.latencyMs !== 1000 ||
      row.expiryMs !== 30000 ||
      !row.orderActiveAt
    )
      continue;
    const trades = tradesByTicker.get(row.ticker) ?? [];
    const active = Date.parse(row.orderActiveAt),
      expiry = Date.parse(row.scheduledActiveAt) + row.expiryMs;
    if (
      !trades.some(
        (trade) =>
          trade.executedAt.getTime() >= active &&
          trade.executedAt.getTime() < expiry,
      )
    )
      continue;
    const evidence = queueConsumption({
      queueAhead: row.displayedQueueAhead,
      orderedTrades: trades,
      limitPrice: row.entryLimitPrice,
      side: "yes_buy",
      activationTime: new Date(active),
      expiryTime: new Date(expiry),
    });
    result.compared++;
    const next = evidence.ourFillReached
      ? "queue_supported_hypothetical_fill"
      : evidence.supportingTradeIds.length
        ? "partial_directed_flow"
        : "unobservable";
    if (next !== "unobservable") {
      result.changed++;
      result.changes.push({
        simulationId: row.simulationId,
        previous: row.entryFillClassification,
        newEvidence: next,
      });
    }
  }
  return result;
}

async function main() {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      to: { type: "string" },
      "trade-runs": { type: "string" },
      "book-runs": { type: "string" },
      json: { type: "string" },
      "exp003-ledger": { type: "string" },
      formal: { type: "boolean", default: false },
    },
  });
  const tradeRuns = sortedIds(values["trade-runs"]),
    bookRuns = sortedIds(values["book-runs"]);
  if (
    !values.from?.endsWith("Z") ||
    !values.to?.endsWith("Z") ||
    !tradeRuns.length ||
    !values.json
  )
    throw new Error(
      "Usage: --from UTC --to UTC --trade-runs UUID,... [--book-runs UUID,...] --json PATH [--exp003-ledger PATH] [--formal]",
    );
  const from = new Date(values.from),
    to = new Date(values.to);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    to <= from ||
    to.getTime() - from.getTime() > 7 * 86400000
  )
    throw new Error("Invalid bounded UTC window.");
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const gitDirty = Boolean(
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  );
  const protocolBytes = execFileSync("git", [
    "show",
    `${PROTOCOL_SHA}:${PROTOCOL_PATH}`,
  ]);
  if (values.formal) {
    const relevantChanges = execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--",
        "apps/worker",
        "packages/db",
        "packages/kalshi",
        "packages/research",
        "docs/market-data.md",
        PROTOCOL_PATH,
        "package.json",
      ],
      { encoding: "utf8" },
    ).trim();
    if (relevantChanges)
      throw new Error(
        "Formal analysis requires committed EXP-004 source and protocol.",
      );
    execFileSync("git", ["merge-base", "--is-ancestor", PROTOCOL_SHA, "HEAD"]);
    if (
      !protocolBytes.equals(
        execFileSync("git", ["show", `HEAD:${PROTOCOL_PATH}`]),
      )
    )
      throw new Error("EXP-004 protocol changed.");
  }
  const database = createDatabase();
  try {
    const runs = await database.db
      .select()
      .from(tradeCollectorRuns)
      .where(inArray(tradeCollectorRuns.id, tradeRuns))
      .orderBy(asc(tradeCollectorRuns.startedAt));
    if (
      runs.length !== tradeRuns.length ||
      runs.some((run) => run.status === "running")
    )
      throw new Error("Missing or running collector session.");
    const tickers = [
      ...new Set(
        runs.flatMap(
          (run) => (run.config.tickers as string[] | undefined) ?? [],
        ),
      ),
    ].sort();
    if (!tickers.length || tickers.length > 100)
      throw new Error("Invalid collector universe.");
    const trades = await database.db
      .select()
      .from(marketTrades)
      .where(
        and(
          eq(marketTrades.source, "kalshi_production_public"),
          inArray(marketTrades.collectionRunId, tradeRuns),
          gte(marketTrades.executedAt, from),
          lt(marketTrades.executedAt, to),
        ),
      )
      .orderBy(asc(marketTrades.executedAt), asc(marketTrades.providerTradeId))
      .limit(100001);
    if (trades.length > 100000) throw new Error("Trade selection exceeds cap.");
    const fees = await database.db
      .select()
      .from(feeRuleSnapshots)
      .where(inArray(feeRuleSnapshots.collectionRunId, tradeRuns))
      .orderBy(asc(feeRuleSnapshots.observedAt), asc(feeRuleSnapshots.id))
      .limit(10001);
    if (fees.length > 10000) throw new Error("Fee selection exceeds cap.");
    const books = new Map<string, EvidenceBook[]>();
    const bookSnapshotCounts = new Map<string, number>();
    const orders: Ledger[] = [];
    let bookData: Awaited<ReturnType<typeof queryResearch>> | null = null;
    if (bookRuns.length)
      bookData = await queryResearch(
        database.db,
        {
          source: "kalshi_production_public",
          from,
          to,
          runIds: bookRuns,
          tickers,
          maxRows: 250000,
        },
        (ticker, rows) => {
          books.set(ticker, rows as EvidenceBook[]);
          for (const row of rows)
            bookSnapshotCounts.set(
              row.workerRunId,
              (bookSnapshotCounts.get(row.workerRunId) ?? 0) + 1,
            );
          orders.push(
            ...simulateMarket(ticker, rows as MakerObservation[], {
              scenario: "pessimistic",
              latencyMs: 1000,
              expiryMs: 30000,
            }).ledger,
          );
        },
        true,
      );
    const evidenceTrades: EvidenceTrade[] = trades.map((row) => ({
      tradeId: row.providerTradeId,
      ticker: row.ticker,
      executedAt: row.executedAt,
      yesPrice: row.yesPrice,
      quantity: row.quantity,
      aggressorSide: row.aggressorSide as EvidenceTrade["aggressorSide"],
      takerOutcomeSide: row.takerOutcomeSide as EvidenceTrade["takerOutcomeSide"],
      takerBookSide: row.takerBookSide as EvidenceTrade["takerBookSide"],
      sideProvenance: row.sideProvenance as EvidenceTrade["sideProvenance"],
      isBlockTrade: row.isBlockTrade,
    }));
    const tradesByTicker = new Map<string, EvidenceTrade[]>();
    for (const trade of evidenceTrades)
      tradesByTicker.set(trade.ticker, [
        ...(tradesByTicker.get(trade.ticker) ?? []),
        trade,
      ]);
    const queueTradesByTicker = new Map<string, EvidenceTrade[]>();
    for (const [ticker, tickerTrades] of tradesByTicker)
      queueTradesByTicker.set(
        ticker,
        queueAlignedTrades(tickerTrades, books.get(ticker) ?? []),
      );
    const evidenceTradesById = new Map(
      evidenceTrades.map((trade) => [trade.tradeId, trade]),
    );
    let pre = 0,
      post = 0,
      both = 0,
      explicit = 0,
      ambiguous = 0,
      unmatched = 0;
    const delays: number[] = [],
      relations: Record<string, number> = {};
    const tradeAlignments = [] as {
      tradeId: string;
      ticker: string;
      executedAt: Date;
      tradePrice: string;
      tradeQuantity: string;
      aggressorSide: EvidenceTrade["aggressorSide"];
      relation: ReturnType<typeof alignTrade>["relation"];
      preBookId: string | null;
      preBookReceivedAt: Date | null;
      preDelayMs: number | null;
      preBid: string | null;
      preAsk: string | null;
      preBidSize: string | null;
      preAskSize: string | null;
      postBookId: string | null;
      postBookReceivedAt: Date | null;
      postDelayMs: number | null;
      postBid: string | null;
      postAsk: string | null;
      postBidSize: string | null;
      postAskSize: string | null;
    }[];
    for (const trade of evidenceTrades) {
      const match = alignTrade(trade, books.get(trade.ticker) ?? []);
      tradeAlignments.push({
        tradeId: trade.tradeId,
        ticker: trade.ticker,
        executedAt: trade.executedAt,
        tradePrice: trade.yesPrice,
        tradeQuantity: trade.quantity,
        aggressorSide: trade.aggressorSide,
        relation: match.relation,
        preBookId: match.pre?.id ?? null,
        preBookReceivedAt: match.pre?.bookReceivedAt ?? null,
        preDelayMs: match.preDelayMs,
        preBid: match.pre?.yesBid ?? null,
        preAsk: match.pre?.yesAsk ?? null,
        preBidSize: match.pre?.yesBidSize ?? null,
        preAskSize: match.pre?.yesAskSize ?? null,
        postBookId: match.post?.id ?? null,
        postBookReceivedAt: match.post?.bookReceivedAt ?? null,
        postDelayMs: match.postDelayMs,
        postBid: match.post?.yesBid ?? null,
        postAsk: match.post?.yesAsk ?? null,
        postBidSize: match.post?.yesBidSize ?? null,
        postAskSize: match.post?.yesAskSize ?? null,
      });
      if (match.pre) {
        pre++;
        delays.push(match.preDelayMs!);
      }
      if (match.post) {
        post++;
        delays.push(match.postDelayMs!);
      }
      if (match.pre && match.post) both++;
      if (trade.sideProvenance === "provider_explicit") explicit++;
      else if (match.relation === "unmatched") unmatched++;
      else ambiguous++;
      relations[match.relation] = (relations[match.relation] ?? 0) + 1;
    }
    const posted = orders.filter(
      (order) =>
        order.orderActiveAt &&
        order.status !== "rejected" &&
        order.status !== "suppressed",
    );
    let flow = 0,
      queueConsumed = 0,
      fillReached = 0,
      unobservable = 0;
    const orderQueueEvidence = [] as {
      candidateId: string;
      simulationId: string;
      ticker: string;
      eventTicker: string | null;
      family: string;
      activationTime: string;
      expiryTime: string;
      limitPrice: string;
      queueAhead: string | null;
      queueConsumed: string;
      queueFullyConsumed: boolean;
      queueSupportedHypotheticalFill: boolean;
      supportingTradeIds: string[];
      relevantExecutedQuantity: string;
      ourOneContractThresholdReached: boolean;
      relevantDirectedTrades: {
        tradeId: string;
        executedAt: string;
        yesPrice: string;
        quantity: string;
        takerOutcomeSide: EvidenceTrade["takerOutcomeSide"];
        takerBookSide: EvidenceTrade["takerBookSide"];
        aggressorSide: EvidenceTrade["aggressorSide"];
        preBookId: string;
        postBookId: string;
      }[];
      unknownReason: string | null;
    }[];
    const alignmentsById = new Map(
      tradeAlignments.map((alignment) => [alignment.tradeId, alignment]),
    );
    for (const order of posted) {
      const expiryTime = new Date(
        Date.parse(order.scheduledActiveAt) + order.expiryMs,
      );
      const evidence = queueConsumption({
        queueAhead: order.displayedQueueAhead,
        orderedTrades: queueTradesByTicker.get(order.ticker) ?? [],
        limitPrice: order.entryLimitPrice,
        side: "yes_buy",
        activationTime: new Date(order.orderActiveAt!),
        expiryTime,
      });
      orderQueueEvidence.push({
        candidateId: order.simulationId,
        simulationId: order.simulationId,
        ticker: order.ticker,
        eventTicker: order.eventTicker ?? null,
        family:
          identify(order.ticker, order.eventTicker ?? null).family ?? "unknown",
        activationTime: order.orderActiveAt!,
        expiryTime: expiryTime.toISOString(),
        limitPrice: order.entryLimitPrice,
        queueAhead: order.displayedQueueAhead,
        queueConsumed: evidence.queueConsumed,
        queueFullyConsumed: evidence.queueFullyConsumed,
        queueSupportedHypotheticalFill: evidence.ourFillReached,
        supportingTradeIds: evidence.supportingTradeIds,
        relevantExecutedQuantity: evidence.queueConsumed,
        ourOneContractThresholdReached: evidence.ourFillReached,
        relevantDirectedTrades: evidence.supportingTradeIds.map((tradeId) => {
          const trade = evidenceTradesById.get(tradeId)!;
          const alignment = alignmentsById.get(tradeId)!;
          return {
            tradeId,
            executedAt: trade.executedAt.toISOString(),
            yesPrice: trade.yesPrice,
            quantity: trade.quantity,
            takerOutcomeSide: trade.takerOutcomeSide ?? null,
            takerBookSide: trade.takerBookSide ?? null,
            aggressorSide: trade.aggressorSide,
            preBookId: alignment.preBookId!,
            postBookId: alignment.postBookId!,
          };
        }),
        unknownReason: evidence.unknownReason,
      });
      if (evidence.supportingTradeIds.length) flow++;
      else unobservable++;
      if (evidence.queueFullyConsumed) queueConsumed++;
      if (evidence.ourFillReached) fillReached++;
    }
    const familyCounts = (
      rows: Array<{ family: string }>,
    ): Array<{ family: string; count: number; sharePct: number | null }> => {
      const counts = new Map<string, number>();
      for (const row of rows)
        counts.set(row.family, (counts.get(row.family) ?? 0) + 1);
      return [...counts]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([family, count]) => ({
          family,
          count,
          sharePct: pct(count, rows.length),
        }));
    };
    const tradeFamilies = trades.map((trade) => ({
      family: identify(trade.ticker, trade.eventTicker ?? null).family ?? "unknown",
    }));
    const candidateFamilies = posted.map((order) => ({
      family: identify(order.ticker, order.eventTicker ?? null).family ?? "unknown",
    }));
    const flowIds = new Set(
      orderQueueEvidence
        .filter((evidence) => evidence.supportingTradeIds.length > 0)
        .map((evidence) => evidence.simulationId),
    );
    const flowFamilies = orderQueueEvidence
      .filter((evidence) => flowIds.has(evidence.simulationId))
      .map((evidence) => ({ family: evidence.family }));
    const fillFamilies = orderQueueEvidence
      .filter((evidence) => evidence.queueSupportedHypotheticalFill)
      .map((evidence) => ({ family: evidence.family }));
    const concentration = (rows: Array<{ family: string }>) => {
      const sorted = familyCounts(rows).sort((a, b) => b.count - a.count);
      return {
        byFamily: sorted,
        largestFamilySharePct: sorted[0]?.sharePct ?? null,
        largestThreeSharePct:
          rows.length === 0
            ? null
            : pct(sorted.slice(0, 3).reduce((sum, row) => sum + row.count, 0), rows.length),
      };
    };
    const queueFillStatuses = orderQueueEvidence
      .filter((evidence) => evidence.queueSupportedHypotheticalFill)
      .map((evidence) => ({
        simulationId: evidence.simulationId,
        eventTicker: evidence.eventTicker,
        family: evidence.family,
        classification: evidence.eventTicker
          ? classifyFeeWindow(
              fees as FeeEvidence[],
              evidence.eventTicker,
              new Date(evidence.activationTime),
              new Date(evidence.expiryTime),
            )
          : "fee_unknown" as const,
      }));
    const families = new Map<string, number>();
    for (const row of trades) {
      const event = fees.find(
        (fee) =>
          fee.eventTicker === row.eventTicker &&
          fee.sourceType === "official_event_api",
      );
      const series = event?.seriesTicker ?? row.eventTicker ?? "unknown";
      families.set(series, (families.get(series) ?? 0) + 1);
    }
    const feeEvidence = fees as FeeEvidence[];
    const events = [
      ...new Set(
        trades
          .map((trade) => trade.eventTicker)
          .filter((e): e is string => Boolean(e)),
      ),
    ];
    const feeEvents = events.map((event) => ({
      eventTicker: event,
      classification: classifyFeeWindow(feeEvidence, event, from, to),
    }));
    const feeKnownEvents = feeEvents.filter(
      (e) => e.classification === "fee_known",
    ).length;
    const feeConflictingEvents = feeEvents.filter(
      (e) => e.classification === "fee_conflicting",
    ).length;
    const completedContexts = orders.filter(
      (order) =>
        order.status === "completed" &&
        order.entryFillAt &&
        order.exitFillAt &&
        order.eventTicker,
    );
    const feeKnownCandidateContexts = completedContexts.filter(
      (order) =>
        classifyFeeWindow(
          feeEvidence,
          order.eventTicker!,
          new Date(order.entryFillAt!),
          new Date(order.exitFillAt!),
        ) === "fee_known",
    ).length;
    const stableFields = trades.filter(
      (t) => t.providerTradeId && t.executedAt && t.yesPrice && t.quantity,
    ).length;
    const directedRelevant = evidenceTrades.filter(
      (t) => t.sideProvenance === "provider_explicit",
    ).length;
    const gates = {
      sample:
        trades.length >= 500 &&
        [...families.values()].filter((count) => count >= 50).length >= 3,
      fields:
        pct(stableFields, trades.length)! >= 80 &&
        runs.every((run) => run.status !== "failed" && !run.error),
      alignment: pct(both, trades.length)! >= 60,
      direction: pct(directedRelevant, trades.length)! >= 50,
      queue: flow >= 50 && fillReached >= 1,
      fees:
        completedContexts.length > 0 &&
        pct(feeKnownCandidateContexts, completedContexts.length)! >= 80,
    };
    const verdict =
      stableFields < trades.length * 0.8 ||
      (trades.length >= 500 && explicit === 0)
        ? "TRADE DATA INSUFFICIENT FOR QUEUE MODELING"
        : Object.values(gates).every(Boolean)
          ? "PROCEED TO MAKER-SIMULATOR-V2"
          : "COLLECT MORE EVIDENCE";
    const legacy = values["exp003-ledger"]
      ? await readExp003(values["exp003-ledger"], queueTradesByTicker)
      : { compared: 0, changed: 0, changes: [] };
    const report = {
      provenance: {
        gitCommit,
        gitDirty,
        protocolCommit: PROTOCOL_SHA,
        protocolSha256: createHash("sha256")
          .update(protocolBytes)
          .digest("hex"),
        tradeRunIds: tradeRuns,
        bookRunIds: bookRuns,
        from: from.toISOString(),
        toExclusive: to.toISOString(),
        tradeDataSha256: hash(trades),
        bookDataSha256: bookData?.datasetSha256 ?? null,
        feeDataSha256: hash(fees),
      },
      collection: {
        markets: tickers.length,
        events: events.length,
        seriesFamilies: [...families],
        trades: trades.length,
        nonBlockTrades: trades.filter((trade) => !trade.isBlockTrade).length,
        uniqueTradeIds: new Set(trades.map((t) => t.providerTradeId)).size,
        duplicatesSuppressed: runs.reduce(
          (n, run) => n + run.duplicatesSeen,
          0,
        ),
        tradesPerMinute:
          trades.length / ((to.getTime() - from.getTime()) / 60000),
        stableFieldPct: pct(stableFields, trades.length),
        maxExchangeToReceiptLagMs: trades.length
          ? trades.reduce(
              (max, trade) =>
                Math.max(
                  max,
                  trade.receivedAt.getTime() - trade.executedAt.getTime(),
                ),
              Number.NEGATIVE_INFINITY,
            )
          : null,
        collectorRuns: runs.map((r) => {
          const runTrades = trades.filter(
            (trade) => trade.collectionRunId === r.id,
          );
          return {
            id: r.id,
            startedAt: r.startedAt,
            stoppedAt: r.stoppedAt,
            status: r.status,
            error: r.error,
            gitCommit: r.gitCommit,
            gitDirty: r.gitDirty,
            tradesWritten: r.tradesWritten,
            duplicatesSeen: r.duplicatesSeen,
            selectedTrades: runTrades.length,
            selectedNonBlockTrades: runTrades.filter(
              (trade) => !trade.isBlockTrade,
            ).length,
            paginationPages: Number(
              (r.config.collectionMetrics as
                | { paginationPages?: number }
                | undefined)?.paginationPages ?? 0,
            ),
            config: r.config,
          };
        }),
        bookRuns: (bookData?.runs ?? []).map((r) => ({
          id: r.id,
          startedAt: r.startedAt,
          stoppedAt: r.stoppedAt,
          status: r.status,
          error: r.error,
          gitCommit: r.gitCommit,
          gitDirty: r.gitDirty,
          snapshots: bookSnapshotCounts.get(r.id) ?? 0,
        })),
      },
      direction: {
        providerExplicit: explicit,
        providerExplicitPct: pct(explicit, trades.length),
        reconstructed: 0,
        reconstructedPct: 0,
        ambiguous,
        ambiguousPct: pct(ambiguous, trades.length),
        unmatched,
        unmatchedPct: pct(unmatched, trades.length),
        priceRelations: relations,
      },
      alignment: {
        pre,
        prePct: pct(pre, trades.length),
        post,
        postPct: pct(post, trades.length),
        both,
        bothPct: pct(both, trades.length),
        medianDelayMs: median(delays),
      },
      tradeAlignments,
      queue: {
        candidateOrders: posted.length,
        observableRelevantFlow: flow,
        queueFullyConsumed: queueConsumed,
        queueSupportedHypotheticalFills: fillReached,
        unobservable,
        concentration: {
          candidates: concentration(candidateFamilies),
          relevantFlow: concentration(flowFamilies),
          queueSupportedHypotheticalFills: concentration(fillFamilies),
        },
      },
      orderQueueEvidence,
      fees: {
        eventsKnown: feeKnownEvents,
        eventsUnknown: events.length - feeKnownEvents - feeConflictingEvents,
        eventsConflicting: feeConflictingEvents,
        eventClassifications: feeEvents,
        candidateCompletedContexts: completedContexts.length,
        candidateContextKnownPct: pct(
          feeKnownCandidateContexts,
          completedContexts.length,
        ),
        queueSupportedContexts: {
          total: queueFillStatuses.length,
          feeKnown: queueFillStatuses.filter((row) => row.classification === "fee_known").length,
          feeUnknown: queueFillStatuses.filter((row) => row.classification === "fee_unknown").length,
          feeConflicting: queueFillStatuses.filter((row) => row.classification === "fee_conflicting").length,
          feeKnownCoveragePct: pct(
            queueFillStatuses.filter((row) => row.classification === "fee_known").length,
            queueFillStatuses.length,
          ),
          byFamily: queueFillStatuses,
        },
        concentration: {
          publicTrades: concentration(tradeFamilies),
          candidateOrders: concentration(candidateFamilies),
          relevantFlowCandidates: concentration(flowFamilies),
          queueSupportedHypotheticalFills: concentration(fillFamilies),
        },
        sourceSnapshots: fees.map((f) => ({
          eventTicker: f.eventTicker,
          seriesTicker: f.seriesTicker,
          sourceType: f.sourceType,
          sourceUrl: f.sourceUrl,
          observedAt: f.observedAt,
          retrievedAt: f.observedAt,
          effectiveFrom: f.effectiveFrom,
          effectiveTo: f.effectiveTo,
          feeType: f.feeType,
          feeMultiplier: f.feeMultiplier,
          makerFeeApplicable:
            f.makerMultiplier === null
              ? null
              : Number(f.makerMultiplier) !== 0,
          makerMultiplier: f.makerMultiplier,
          takerMultiplier: f.takerMultiplier,
          evidenceLayer:
            f.sourceType === "official_fee_schedule"
              ? "formula_known_applicability_unproven"
              : "official_applicability_evidence",
          rawResponseHash: hash(f.rawMetadata),
          rawMetadataSha256: hash(f.rawMetadata),
          rationale:
            f.sourceType === "official_series_fee_change_api"
              ? "Official scheduled historical series fee change; maker/taker multipliers remain unknown unless corroborated by an effective fee schedule."
              : f.sourceType === "official_event_fee_change_api"
                ? "Official scheduled event override change; applies over the series rule only within its dated interval."
                : f.sourceType === "official_fee_schedule"
                  ? "Dated general schedule formula retained separately from product applicability."
                  : "Official current metadata snapshot; current state alone does not establish historical applicability.",
          rawMetadata: f.rawMetadata,
        })),
      },
      exp003Retrospective: legacy,
      gates,
      verdict,
    };
    await writeFile(values.json, JSON.stringify(report, null, 2), {
      flag: "wx",
    });
    console.log(
      JSON.stringify({
        verdict,
        collection: report.collection,
        direction: report.direction,
        alignment: report.alignment,
        queue: report.queue,
        fees: {
          eventsKnown: feeKnownEvents,
          eventsUnknown: report.fees.eventsUnknown,
        },
      }),
    );
  } finally {
    await database.close();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
