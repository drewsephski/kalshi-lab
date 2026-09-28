import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  combineCohortReports,
  type CohortReport,
} from "./replication-aggregation.ts";
import { assertRunInSessionWindow } from "./replication-validation.ts";

const PROTOCOL_PATH = "experiments/EXP-005-independent-replication/README.md";
const PROTOCOL_SHA = "6985257e03f42faa88c35b602cad2198ee56ceb7";
type Window = {
  from: string;
  toExclusive: string;
  tradeRunIds: string[];
  bookRunIds: string[];
};
type Selection = {
  experiment: "EXP-005";
  source: "kalshi_production_public";
  protocolCommit: string;
  sessions: Array<Window & {
    sessionId: string;
    collectCommit: string;
    gitDirty: false;
    markets: string[];
    eventTickers: string[];
    seriesFamilies: string[];
    exclusion?: string;
  }>;
  exp004: Window & { protocolCommit: string; analysisCommit: string };
};
type Report = CohortReport;
const sha = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ids = (values: string[]) => [...new Set(values)].sort();
const pct = (numerator: number, denominator: number) =>
  denominator ? Math.round((numerator / denominator) * 10000) / 100 : null;
function runReport(window: Window, label: string, out: string) {
  const args = [
    "research:trade-report",
    "--from", window.from,
    "--to", window.toExclusive,
    "--trade-runs", ids(window.tradeRunIds).join(","),
    "--book-runs", ids(window.bookRunIds).join(","),
    "--json", out,
    "--formal",
  ];
  const run = spawnSync("pnpm", args, {
    cwd: resolve(import.meta.dirname, "../../.."),
    encoding: "utf8",
    stdio: "inherit",
  });
  if (run.status !== 0) throw new Error(`${label} trade report failed.`);
}
const compact = (report: Report) => ({
  provenance: report.provenance,
  collection: report.collection,
  direction: report.direction,
  alignment: report.alignment,
  queue: report.queue,
  fees: {
    eventsKnown: report.fees.eventsKnown,
    eventsUnknown: report.fees.eventsUnknown,
    eventsConflicting: report.fees.eventsConflicting,
    eventClassifications: report.fees.eventClassifications,
    candidateCompletedContexts: report.fees.candidateCompletedContexts,
    candidateContextKnownPct: report.fees.candidateContextKnownPct,
    queueSupportedContexts: report.fees.queueSupportedContexts,
    concentration: report.fees.concentration,
    sourceSnapshots: report.fees.sourceSnapshots,
  },
  orderQueueEvidence: report.orderQueueEvidence,
  tradeAlignments: report.tradeAlignments,
});

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      json: { type: "string" },
      formal: { type: "boolean", default: false },
    },
  });
  if (!values.manifest || !values.json)
    throw new Error("Usage: research:replication --manifest PATH --json PATH [--formal]");
  const root = resolve(import.meta.dirname, "../../..");
  const manifestPath = resolve(process.cwd(), values.manifest);
  const manifestGitPath = relative(root, manifestPath);
  if (manifestGitPath.startsWith("../")) throw new Error("Selection manifest must be inside the repository.");
  const bytes = await readFile(manifestPath);
  const selection = JSON.parse(bytes.toString("utf8")) as Selection;
  if (
    selection.experiment !== "EXP-005" ||
    selection.source !== "kalshi_production_public" ||
    selection.protocolCommit !== PROTOCOL_SHA ||
    !selection.exp004?.tradeRunIds?.length ||
    !selection.exp004.bookRunIds.length
  ) throw new Error("Invalid EXP-005 selection manifest.");
  const included = selection.sessions.filter((session) => !session.exclusion);
  if (included.length < 3)
    throw new Error("Formal selection requires at least three included EXP-005 sessions.");
  for (const session of included) {
    if (
      session.gitDirty !== false ||
      !session.collectCommit ||
      !session.tradeRunIds.length ||
      !session.bookRunIds.length ||
      new Date(session.toExclusive) <= new Date(session.from)
    ) throw new Error(`Invalid or dirty session ${session.sessionId}.`);
  }
  const protocolBytes = execFileSync("git", ["show", `${PROTOCOL_SHA}:${PROTOCOL_PATH}`], { cwd: root });
  if (!protocolBytes.equals(await readFile(resolve(root, PROTOCOL_PATH))))
    throw new Error("EXP-005 protocol differs from the committed protocol.");
  const selectionBytes = execFileSync("git", ["show", `HEAD:${manifestGitPath}`], { cwd: root });
  if (!selectionBytes.equals(bytes))
    throw new Error("Formal selection manifest must be committed before analysis.");
  if (values.formal) {
    execFileSync("git", ["merge-base", "--is-ancestor", PROTOCOL_SHA, "HEAD"], { cwd: root });
    if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim())
      throw new Error("Formal replication requires a clean checkout.");
  }
  const analysisCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const temp = await mkdtemp(resolve(tmpdir(), "kalshi-exp005-"));
  try {
    const reports: Record<string, ReturnType<typeof compact>> = {};
    const loadReport = async (name: string, window: Window) => {
      const output = resolve(temp, `${name}.json`);
      runReport(window, name, output);
      const report = JSON.parse(await readFile(output, "utf8")) as Report;
      reports[name] = compact(report);
      if (name === "exp005") {
        const selectedRunIds = new Set(newWindow.tradeRunIds);
        const actual = report.collection.collectorRuns.filter((run) => selectedRunIds.has(run.id));
        const selectedBookIds = new Set(newWindow.bookRunIds);
        const actualBooks = report.collection.bookRuns.filter((run) => selectedBookIds.has(run.id));
        for (const session of included) {
          for (const runId of session.tradeRunIds) {
            assertRunInSessionWindow(
              actual.find((candidate) => candidate.id === runId),
              { ...session, runId, kind: "trade" },
            );
          }
          for (const runId of session.bookRunIds) {
            assertRunInSessionWindow(
              actualBooks.find((candidate) => candidate.id === runId),
              { ...session, runId, kind: "book" },
            );
          }
        }
      }
    };
    const newWindow: Window = {
      from: included.map((s) => s.from).sort()[0]!,
      toExclusive: included.map((s) => s.toExclusive).sort().at(-1)!,
      tradeRunIds: included.flatMap((s) => s.tradeRunIds),
      bookRunIds: included.flatMap((s) => s.bookRunIds),
    };
    await loadReport("exp004", selection.exp004);
    await loadReport("exp005", newWindow);
    reports.combined = compact(
      combineCohortReports(reports.exp004!, reports.exp005!),
    );
    const exp004 = reports.exp004!;
    const exp005 = reports.exp005!;
    const combinedReport = reports.combined!;
    const trades = exp005.fees.concentration as {
      publicTrades: { byFamily: Array<{ family: string; count: number; sharePct: number | null }>; largestFamilySharePct: number | null };
    };
    const fillEvidence = combinedReport.orderQueueEvidence;
    const combinedFills = fillEvidence.filter((evidence) => evidence.queueSupportedHypotheticalFill);
    const fillFamilies = new Set(combinedFills.map((evidence) => evidence.family).filter((family) => family !== "unknown"));
    const supportingTradeIds = new Set(fillEvidence.flatMap((evidence) => evidence.supportingTradeIds));
    const alignedTrades = new Map(combinedReport.tradeAlignments.map((trade) => [trade.tradeId, Boolean(trade.preBookId && trade.postBookId)]));
    const alignedQueueTrades = [...supportingTradeIds].filter((id) => alignedTrades.get(id)).length;
    const queueTradesUsed = supportingTradeIds.size;
    const feeStats = combinedReport.fees.queueSupportedContexts as { total: number; feeKnown: number; feeUnknown: number; feeConflicting: number; feeKnownCoveragePct: number | null };
    const combinedCandidates = combinedReport.queue.candidateOrders as number;
    const combinedFlow = combinedReport.queue.observableRelevantFlow as number;
    const combinedFillCount = combinedReport.queue.queueSupportedHypotheticalFills as number;
    const familyTradeCount = trades.publicTrades.byFamily.filter((row) => row.family !== "unknown").length;
    const maxFamilyShare = trades.publicTrades.largestFamilySharePct;
    const exp005Sessions = included.length;
    const exp004Sessions = selection.exp004.tradeRunIds.length;
    const totalSessions = exp004Sessions + exp005Sessions;
    const gates = {
      temporallySeparatedSessions: { pass: totalSessions >= 5 && exp005Sessions >= 3, total: totalSessions, exp005: exp005Sessions, requiredTotal: 5, requiredExp005: 3 },
      independentFamilies: { pass: familyTradeCount >= 5 && (maxFamilyShare ?? 100) <= 50, represented: familyTradeCount, largestFamilySharePct: maxFamilyShare, requiredFamilies: 5, maxSharePct: 50 },
      newUniqueNonBlockTrades: { pass: exp005.collection.nonBlockTrades >= 2500, actual: exp005.collection.nonBlockTrades, required: 2500 },
      combinedCandidateOrders: { pass: combinedCandidates >= 150, actual: combinedCandidates, required: 150 },
      combinedRelevantFlowCandidates: { pass: combinedFlow >= 50, actual: combinedFlow, required: 50 },
      combinedQueueSupportedFills: { pass: combinedFillCount >= 10 && fillFamilies.size >= 3, actual: combinedFillCount, supportingFamilies: fillFamilies.size, requiredFills: 10, requiredFamilies: 3 },
      queueTradeAlignment: { pass: queueTradesUsed > 0 && (pct(alignedQueueTrades, queueTradesUsed) ?? 0) >= 80, aligned: alignedQueueTrades, total: queueTradesUsed, coveragePct: pct(alignedQueueTrades, queueTradesUsed), requiredPct: 80 },
      historicalFeeCoverage: { pass: feeStats.total > 0 && (feeStats.feeKnownCoveragePct ?? 0) >= 80, ...feeStats, requiredPct: 80 },
      collectorContinuity: { pass: [...selection.sessions.filter((session) => !session.exclusion)].every((session) => session.gitDirty === false), selectedCleanSessions: included.length },
    };
    const allGatesPass = Object.values(gates).every((gate) => gate.pass);
    const dataGatesPass = gates.temporallySeparatedSessions.pass && gates.independentFamilies.pass && gates.newUniqueNonBlockTrades.pass && gates.combinedCandidateOrders.pass && gates.combinedRelevantFlowCandidates.pass && gates.combinedQueueSupportedFills.pass && gates.queueTradeAlignment.pass && gates.collectorContinuity.pass;
    const feeHistoryBlocked = dataGatesPass && !gates.historicalFeeCoverage.pass;
    const verdict = allGatesPass
      ? "PROCEED TO MAKER-SIMULATOR-V2"
      : feeHistoryBlocked
        ? "FEE HISTORY BLOCKED"
        : "COLLECT MORE DATA";
    const result = {
      provenance: {
        protocolCommit: PROTOCOL_SHA,
        protocolSha256: createHash("sha256").update(protocolBytes).digest("hex"),
        analysisCommit,
        gitDirty: false,
        manifestPath: manifestGitPath,
        manifestSha256: createHash("sha256").update(bytes).digest("hex"),
        reportSha256: Object.fromEntries(Object.entries(reports).map(([name, report]) => [name, sha(report)])),
      },
      exp004,
      exp005,
      combined: combinedReport,
      gates,
      verdict,
    };
    const outputPath = resolve(process.cwd(), values.json);
    await writeFile(outputPath, JSON.stringify(result, null, 2), { flag: "wx" });
    console.log(JSON.stringify({
      exp004: { trades: exp004.collection.trades, queue: exp004.queue },
      exp005: { trades: exp005.collection.trades, queue: exp005.queue },
      combined: { trades: combinedReport.collection.trades, queue: combinedReport.queue },
      output: relative(root, outputPath),
    }));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Replication analysis failed.");
  process.exitCode = 1;
});
