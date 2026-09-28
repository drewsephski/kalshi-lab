import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { createDatabase } from "@kalshi-lab/db";
import { queryResearch, validateSelection } from "../queries.ts";
import { gitProvenance } from "../report.ts";
import { simulateMarket } from "./execution.ts";
import { concentration, grouped, metrics } from "./metrics.ts";
import { decision, readManifest, validateSplit } from "./protocol.ts";
import { identify } from "./strategy.ts";
import {
  SETTINGS,
  SIMULATOR_VERSION,
  STRATEGY_VERSION,
  type Ledger,
} from "./types.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      json: { type: "string" },
      ledger: { type: "string" },
      formal: { type: "boolean", default: false },
    },
  });
  if (!values.manifest || !values.json || !values.ledger)
    throw new Error(
      "Usage: --manifest PATH --json PATH --ledger PATH [--formal]",
    );
  const manifest = readManifest(values.manifest),
    git = gitProvenance();
  const selection = {
    source: "kalshi_production_public" as const,
    from: new Date(manifest.from),
    to: new Date(manifest.toExclusive),
    runIds: [...manifest.developmentRuns, ...manifest.evaluationRuns],
    tickers: [],
    maxRows: 250000,
  };
  validateSelection(selection);
  const protocolPath = "experiments/EXP-003-maker-fill-simulator/README.md";
  const protocolBytes = execFileSync("git", [
    "show",
    `${manifest.protocolCommit}:${protocolPath}`,
  ]);
  const protocolSha256 = createHash("sha256")
    .update(protocolBytes)
    .digest("hex");
  if (values.formal) {
    if (git.gitDirty)
      throw new Error("Formal simulation requires a clean checkout.");
    execFileSync("git", [
      "merge-base",
      "--is-ancestor",
      manifest.protocolCommit,
      "HEAD",
    ]);
    const headProtocol = execFileSync("git", ["show", `HEAD:${protocolPath}`]);
    if (!protocolBytes.equals(headProtocol))
      throw new Error("Immutable protocol changed.");
    const committedManifest = execFileSync("git", [
      "ls-files",
      "--error-unmatch",
      values.manifest,
    ]);
    if (!committedManifest.length)
      throw new Error("Commit the selection manifest first.");
    if (
      manifest.developmentRuns.length !== 1 ||
      manifest.developmentRuns[0] !== "e6a6d78b-7708-4155-8f6b-77e90a3fff53"
    )
      throw new Error("Formal EXP-003 development split is frozen.");
  }
  const all: Ledger[][] = SETTINGS.map(() => []);
  const coverage: {
    ticker: string;
    eventTicker: string | null;
    family: string | null;
    category: string | null;
    runIds: string[];
    firstObservation: string;
    lastObservation: string;
    total: number;
    eligible: number;
    exclusions: Record<string, number>;
  }[] = [];
  const db = createDatabase();
  let dataset;
  try {
    dataset = await queryResearch(
      db.db,
      selection,
      (ticker, rows) => {
        const enriched = rows as import("./types.ts").MakerObservation[];
        const first = enriched[0]!;
        const identity = identify(ticker, first.eventTicker ?? null);
        SETTINGS.forEach((setting, index) => {
          const result = simulateMarket(
            ticker,
            enriched,
            setting,
            manifest.fees,
          );
          all[index]!.push(...result.ledger);
          if (all[index]!.length > 250000)
            throw new Error("Ledger cap exceeded; no partial result.");
          if (index === 0)
            coverage.push({
              ...identity,
              runIds: [...new Set(rows.map((r) => r.workerRunId))].sort(),
              firstObservation: first.observedAt.toISOString(),
              lastObservation: enriched.at(-1)!.observedAt.toISOString(),
              ...result.quality,
            });
        });
      },
      true,
    );
  } finally {
    await db.close();
  }
  validateSplit(dataset.runs, manifest);
  if (values.formal) {
    const protocolTime =
      Number(
        execFileSync(
          "git",
          ["show", "-s", "--format=%ct", manifest.protocolCommit],
          { encoding: "utf8" },
        ).trim(),
      ) * 1000;
    for (const r of dataset.runs) {
      if (
        r.gitDirty ||
        r.config.once !== false ||
        r.config.snapshotIntervalMs !== 5000 ||
        r.config.maxMarkets !== 25 ||
        !Array.isArray(r.config.tickers) ||
        r.config.tickers.length
      )
        throw new Error("Formal run config or clean collection gate failed.");
      if (
        manifest.evaluationRuns.includes(r.id) &&
        r.startedAt.getTime() <= protocolTime
      )
        throw new Error("Evaluation predates frozen protocol.");
    }
    if (JSON.stringify(gitProvenance()) !== JSON.stringify(git))
      throw new Error("Git state changed during simulation.");
  }
  const devFamilies = new Set(
    coverage
      .filter((c) => c.runIds.some((r) => manifest.developmentRuns.includes(r)))
      .map((c) => c.family)
      .filter((f) => f !== null),
  );
  const devEvents = new Set(
    coverage
      .filter((c) => c.runIds.some((r) => manifest.developmentRuns.includes(r)))
      .map((c) => c.eventTicker),
  );
  const independent = (l: Ledger) =>
    manifest.evaluationRuns.includes(l.workerRunId) &&
    l.family !== null &&
    !devFamilies.has(l.family) &&
    !devEvents.has(l.eventTicker);
  const summary = (rows: Ledger[]) => ({
    aggregate: metrics(rows),
    concentration: concentration(rows),
    grossConcentration: concentration(rows, "family", "grossPnl"),
    eventTickerConcentration: concentration(rows, "eventTicker"),
    byMarket: grouped(rows, "ticker"),
    byEvent: grouped(rows, "eventTicker"),
    byFamily: grouped(rows, "family"),
    byCategory: grouped(rows, "category"),
    bySession: grouped(rows, "workerRunId"),
  });
  const scenarios = SETTINGS.map((settings, i) => ({
    settings,
    development: summary(
      all[i]!.filter((l) => manifest.developmentRuns.includes(l.workerRunId)),
    ),
    evaluation: summary(
      all[i]!.filter((l) => manifest.evaluationRuns.includes(l.workerRunId)),
    ),
    independentEvaluation: summary(all[i]!.filter(independent)),
    excludedDependentEvaluationSignals: all[i]!.filter(
      (l) => manifest.evaluationRuns.includes(l.workerRunId) && !independent(l),
    ).length,
  }));
  const primaryIndex = SETTINGS.findIndex(
    (s) =>
      s.scenario === "base" && s.latencyMs === 1000 && s.expiryMs === 30000,
  );
  const evaluationCoverage = coverage.filter((c) =>
    c.runIds.some((r) => manifest.evaluationRuns.includes(r)),
  );
  const independentFamilies = new Set(
    evaluationCoverage
      .map((c) => c.family)
      .filter((f) => f !== null && !devFamilies.has(f)),
  );
  const verdict = decision(
    all[primaryIndex]!.filter(independent),
    [500, 2500].map((ms) =>
      all[
        SETTINGS.findIndex(
          (s) =>
            s.scenario === "base" && s.latencyMs === ms && s.expiryMs === 30000,
        )
      ]!.filter(independent),
    ),
    dataset.runs.filter((r) => manifest.evaluationRuns.includes(r.id)),
    independentFamilies.size,
  );
  const ledgerText =
    all
      .flat()
      .sort((a, b) => a.simulationId.localeCompare(b.simulationId))
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n";
  const report = {
    provenance: {
      ...git,
      formal: values.formal,
      strategyVersion: STRATEGY_VERSION,
      simulatorVersion: SIMULATOR_VERSION,
      protocolSha256,
      manifestSha256: createHash("sha256")
        .update(await readFile(values.manifest))
        .digest("hex"),
      manifest,
      ...dataset,
    },
    units: {
      money: "dollars, exact decimal strings",
      midpointMovement: "half of $0.0001",
      rates: "percent, approximate",
      means: "exact rational dollars",
    },
    coverage: {
      markets: coverage,
      developmentFamilies: [...devFamilies].sort(),
      independentEvaluationFamilies: [...independentFamilies].sort(),
      evaluationEventCount: new Set(
        evaluationCoverage.map((c) => c.eventTicker).filter(Boolean),
      ).size,
      independentEvaluationFamilyCount: independentFamilies.size,
    },
    ledger: {
      path: values.ledger,
      sha256: createHash("sha256").update(ledgerText).digest("hex"),
      records: all.reduce((n, l) => n + l.length, 0),
    },
    scenarios,
    decision: verdict,
  };
  // Create-only artifacts: never replace previous evidence.
  await mkdir(dirname(values.ledger), { recursive: true });
  await mkdir(dirname(values.json), { recursive: true });
  await writeFile(values.ledger, ledgerText, { flag: "wx" });
  await writeFile(values.json, JSON.stringify(report) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        git,
        decision: verdict,
        independentFamilies: independentFamilies.size,
        primary: scenarios[primaryIndex]!.independentEvaluation.aggregate,
        report: values.json,
      },
      null,
      2,
    ),
  );
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Maker simulation failed.",
  );
  process.exitCode = 1;
});
