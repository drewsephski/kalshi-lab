import { readFileSync } from "node:fs";
import { parseFeeRules, money } from "./fees.ts";
import { concentration, grouped, metrics } from "./metrics.ts";
import type { FeeRule, Ledger } from "./types.ts";
export interface Manifest {
  protocolCommit: string;
  from: string;
  toExclusive: string;
  developmentRuns: string[];
  evaluationRuns: string[];
  fees: FeeRule[];
}
export interface Run {
  id: string;
  startedAt: Date;
  stoppedAt: Date | null;
  status: string;
  gitCommit: string;
  gitDirty: boolean;
  config: Record<string, unknown>;
}
export function readManifest(path: string): Manifest {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!raw || typeof raw !== "object") throw new Error("Invalid manifest.");
  const r = raw as Manifest;
  if (
    !/^[a-f0-9]{40}$/.test(r.protocolCommit) ||
    !r.from?.endsWith("Z") ||
    !r.toExclusive?.endsWith("Z")
  )
    throw new Error("Invalid manifest provenance.");
  if (
    !Array.isArray(r.developmentRuns) ||
    !Array.isArray(r.evaluationRuns) ||
    !r.developmentRuns.length ||
    !r.evaluationRuns.length
  )
    throw new Error("Both chronological splits required.");
  const ids = [...r.developmentRuns, ...r.evaluationRuns];
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate/overlapping split membership.");
  r.fees = parseFeeRules(r.fees);
  return r;
}
export function validateSplit(runs: Run[], manifest: Manifest) {
  const ids = [...manifest.developmentRuns, ...manifest.evaluationRuns];
  if (
    runs.length !== ids.length ||
    ids.some((id) => !runs.some((r) => r.id === id))
  )
    throw new Error("Missing/extra selected runs.");
  const sorted = [...runs].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  );
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    if (!r.stoppedAt || r.status === "running" || r.stoppedAt < r.startedAt)
      throw new Error("All runs must be stopped.");
    if (i && sorted[i - 1]!.stoppedAt! > r.startedAt)
      throw new Error("Overlapping recorder sessions.");
    if (
      Date.parse(manifest.from) > r.startedAt.getTime() ||
      Date.parse(manifest.toExclusive) <= r.stoppedAt.getTime()
    )
      throw new Error("Selection must cover complete runs.");
  }
  const lastDev = Math.max(
    ...runs
      .filter((r) => manifest.developmentRuns.includes(r.id))
      .map((r) => r.stoppedAt!.getTime()),
  );
  if (
    runs.some(
      (r) =>
        manifest.evaluationRuns.includes(r.id) &&
        r.startedAt.getTime() <= lastDev,
    )
  )
    throw new Error("Evaluation must be strictly after development.");
}
export function decision(
  primary: Ledger[],
  sensitivities: Ledger[][],
  sessions: Run[],
  collectionFamilies: number,
) {
  const m = metrics(primary),
    c = concentration(primary),
    byFamily = grouped(primary, "family"),
    byRun = grouped(primary, "workerRunId");
  const substantialFamilies = Object.entries(byFamily).filter(
    ([k, v]) => k !== "unknown" && v.feeKnownTrades >= 10,
  ).length;
  const enough =
    m.feeKnownTrades >= 100 &&
    substantialFamilies >= 5 &&
    collectionFamilies >= 3 &&
    sessions.length >= 2 &&
    sessions.every(
      (r) =>
        r.stoppedAt && r.stoppedAt.getTime() - r.startedAt.getTime() >= 600000,
    ) &&
    m.completedTrades > 0 &&
    m.feeKnownTrades * 100 >= 95 * m.completedTrades &&
    m.unresolved === 0;
  if (!enough)
    return {
      verdict: "COLLECT MORE DATA",
      profitabilityConclusion: "INSUFFICIENT INDEPENDENT DATA",
      reason:
        "Frozen sample, independent-family, session, fee coverage or unresolved-position gate not met.",
    };
  const sessionValues = sessions.map((r) => byRun[r.id]?.netPnl ?? null);
  const positive = m.netPnl !== null && money(m.netPnl) > 0n;
  const sensitivityPass = sensitivities.every((rows) => {
    const s = metrics(rows);
    return (
      s.feeKnownTrades > 0 &&
      s.unresolved === 0 &&
      s.unknownFeeTrades === 0 &&
      s.netPnl !== null &&
      money(s.netPnl) >= 0n
    );
  });
  if (
    positive &&
    sessionValues.every((v) => v !== null && money(v) > 0n) &&
    sensitivityPass &&
    m.wholeCentNetPnl !== null &&
    money(m.wholeCentNetPnl) > 0n &&
    (c.largestPositiveSharePct ?? 100) < 40 &&
    (c.largestThreePositiveSharePct ?? 100) < 80
  )
    return {
      verdict: "PROCEED TO DEMO FORWARD TEST",
      profitabilityConclusion:
        "POSITIVE UNDER PREDEFINED SIMULATION ASSUMPTIONS",
      reason: "All frozen continuation gates met; fills remain hypothetical.",
    };
  if (
    m.netPnl !== null &&
    money(m.netPnl) <= -100n * BigInt(m.feeKnownTrades) &&
    sessionValues.every((v) => v !== null && money(v) < 0n)
  )
    return {
      verdict: "REJECT STRATEGY V1",
      profitabilityConclusion:
        "NEGATIVE UNDER PREDEFINED SIMULATION ASSUMPTIONS",
      reason: "Meaningful sample and predefined negative expectancy gate met.",
    };
  return {
    verdict: "COLLECT MORE DATA",
    profitabilityConclusion: "INCONCLUSIVE",
    reason: "Coverage met but continuation/rejection gates not met.",
  };
}
