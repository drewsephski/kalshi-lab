import type { Observation } from "../microstructure.ts";
export const STRATEGY_VERSION = "passive-yes-v1";
export const SIMULATOR_VERSION = "maker-simulator-v1";
export const SCENARIOS = ["optimistic", "base", "pessimistic"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export type FillClassification =
  | "no_fill"
  | "unobservable_queue"
  | "hypothetical_upper_bound"
  | "hypothetical_conservative_proxy"
  | "hypothetical_liquidation";
export interface Settings {
  scenario: Scenario;
  latencyMs: number;
  expiryMs: number;
}
export const SETTINGS: Settings[] = SCENARIOS.flatMap((scenario) => [
  ...[0, 250, 500, 1000, 2500, 5000].map((latencyMs) => ({
    scenario,
    latencyMs,
    expiryMs: 30000,
  })),
  ...[10000, 60000].map((expiryMs) => ({
    scenario,
    latencyMs: 1000,
    expiryMs,
  })),
]);
export interface MakerObservation extends Observation {
  eventTicker?: string | null;
  bookReceivedAt?: Date | null;
  tickerReceivedAt?: Date;
}
export interface Sample {
  id: string;
  run: string;
  time: number;
  segment: number;
  bookTime: number;
  tickerTime: number;
  bid: bigint;
  ask: bigint;
  bidSize: bigint;
  askSize: bigint;
  volume: bigint | null;
  raw: MakerObservation;
}
export interface Identity {
  ticker: string;
  eventTicker: string | null;
  family: string | null;
  category: string | null;
}
export interface FeeRule {
  eventTicker: string;
  seriesTicker: string;
  makerMultiplier: string;
  takerMultiplier: string;
  from: string;
  toExclusive: string;
  evidence: string[];
  rationale: string;
}
export interface Movement {
  elapsedMs: number;
  midpointChangeHalfUnits: string;
}
export interface Ledger extends Identity {
  simulationId: string;
  strategyVersion: string;
  simulatorVersion: string;
  source: "kalshi_production_public";
  workerRunId: string;
  fillScenario: Scenario;
  latencyMs: number;
  expiryMs: number;
  signalObservedAt: string;
  scheduledActiveAt: string;
  orderActiveAt: string | null;
  entrySide: "yes_buy";
  entryLimitPrice: string;
  displayedQueueAhead: string | null;
  entryFilled: boolean;
  entryFillClassification: FillClassification;
  entryFillAt: string | null;
  entryFillPrice: string | null;
  entryFillEvidence: string;
  entryEvidenceIds: string[];
  targetExitPrice: string;
  exitActiveAt: string | null;
  exitQueueAhead: string | null;
  exitFilled: boolean;
  exitFillClassification: FillClassification;
  exitFillAt: string | null;
  exitFillPrice: string | null;
  exitFillEvidence: string;
  exitEvidenceIds: string[];
  status: "suppressed" | "rejected" | "not_filled" | "unresolved" | "completed";
  forcedExit: boolean;
  holdingDurationMs: number | null;
  entryFee: string | null;
  exitFee: string | null;
  totalFees: string | null;
  grossPnl: string | null;
  netPnl: string | null;
  wholeCentNetPnl: string | null;
  feeClassification: string;
  spreadAtSignal: string;
  bidSizeAtSignal: string;
  askSizeAtSignal: string;
  postFill5s: Movement | null;
  postFill15s: Movement | null;
  postFill30s: Movement | null;
  postFill60s: Movement | null;
}
