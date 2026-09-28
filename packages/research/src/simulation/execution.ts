import { createHash } from "node:crypto";
import { matchForward } from "../forward-returns.ts";
import { applicableFee, dollars, fee } from "./fees.ts";
import { fillEvidence, through } from "./fills.ts";
import { contracts, queueAhead } from "./queue.ts";
import {
  GAP_MS,
  HOLD_MS,
  identify,
  prepareMaker,
  qualifies,
} from "./strategy.ts";
import {
  SIMULATOR_VERSION,
  STRATEGY_VERSION,
  type FeeRule,
  type Ledger,
  type MakerObservation,
  type Sample,
  type Settings,
} from "./types.ts";
const iso = (time: number) => new Date(time).toISOString();
function atOrAfter(samples: readonly Sample[], time: number): number {
  let lo = 0,
    hi = samples.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (samples[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function passive(
  samples: readonly Sample[],
  start: number,
  scheduled: number,
  deadline: number,
  side: "buy" | "sell",
  limit: bigint,
  settings: Settings,
) {
  const origin = samples[start]!;
  let activation: Sample | null = null,
    activationIndex = -1;
  for (let j = start; j < samples.length; j++) {
    const s = samples[j]!;
    if (
      s.run !== origin.run ||
      s.segment !== origin.segment ||
      s.time >= deadline ||
      s.time > scheduled + GAP_MS
    )
      break;
    if (s.time >= scheduled && s.bookTime >= scheduled) {
      activation = s;
      activationIndex = j;
      break;
    }
  }
  if (!activation)
    return {
      activation: null,
      fill: null,
      evidence: "activation_unobservable",
      ids: [] as string[],
    };
  if (side === "buy" ? activation.ask <= limit : activation.bid >= limit)
    return {
      activation,
      fill: null,
      evidence: "post_only_would_cross",
      ids: [] as string[],
    };
  let previous = activation,
    priorThrough = false;
  for (let j = activationIndex + 1; j < samples.length; j++) {
    const s = samples[j]!;
    if (
      s.run !== origin.run ||
      s.segment !== origin.segment ||
      s.time >= deadline
    )
      break;
    const evidence = fillEvidence(
      settings.scenario,
      side,
      limit,
      previous,
      s,
      priorThrough,
    );
    if (evidence)
      return {
        activation,
        fill: s,
        evidence,
        ids: [activation.id, previous.id, s.id],
      };
    priorThrough = s.bookTime > previous.time && through(side, limit, s);
    previous = s;
  }
  return {
    activation,
    fill: null,
    evidence:
      settings.scenario === "pessimistic"
        ? "queue_depletion_unobservable"
        : "no_required_evidence_before_expiry",
    ids: [] as string[],
  };
}
export function simulateMarket(
  ticker: string,
  input: readonly MakerObservation[],
  settings: Settings,
  rules: FeeRule[] = [],
) {
  if (
    !["optimistic", "base", "pessimistic"].includes(settings.scenario) ||
    !Number.isSafeInteger(settings.latencyMs) ||
    settings.latencyMs < 0 ||
    !Number.isSafeInteger(settings.expiryMs) ||
    settings.expiryMs <= 0
  )
    throw new Error("Invalid simulation settings.");
  const prepared = prepareMaker(input);
  const samples = prepared.samples.filter((s): s is Sample => s !== null);
  const ledger: Ledger[] = [];
  let attempted = false,
    run = "",
    busyUntil = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const signal = samples[i]!;
    if (signal.run !== run) {
      run = signal.run;
      attempted = false;
      busyUntil = -Infinity;
    }
    if (signal.ask - signal.bid < 200n) {
      attempted = false;
      continue;
    }
    if (attempted || !qualifies(signal)) continue;
    attempted = true;
    const identity = identify(ticker, signal.raw.eventTicker ?? null);
    const scheduled = signal.time + settings.latencyMs,
      expiry = scheduled + settings.expiryMs;
    const target = signal.ask - 100n;
    const l: Ledger = {
      ...identity,
      simulationId: createHash("sha256")
        .update(
          JSON.stringify([
            SIMULATOR_VERSION,
            STRATEGY_VERSION,
            ticker,
            signal.run,
            signal.id,
            settings,
          ]),
        )
        .digest("hex"),
      strategyVersion: STRATEGY_VERSION,
      simulatorVersion: SIMULATOR_VERSION,
      source: "kalshi_production_public",
      workerRunId: run,
      fillScenario: settings.scenario,
      latencyMs: settings.latencyMs,
      expiryMs: settings.expiryMs,
      signalObservedAt: iso(signal.time),
      scheduledActiveAt: iso(scheduled),
      orderActiveAt: null,
      entrySide: "yes_buy",
      entryLimitPrice: dollars(signal.bid),
      displayedQueueAhead: contracts(signal.bidSize),
      entryFilled: false,
      entryFillClassification: "no_fill",
      entryFillAt: null,
      entryFillPrice: null,
      entryFillEvidence: "not_activated",
      entryEvidenceIds: [],
      targetExitPrice: dollars(target),
      exitActiveAt: null,
      exitQueueAhead: null,
      exitFilled: false,
      exitFillClassification: "no_fill",
      exitFillAt: null,
      exitFillPrice: null,
      exitFillEvidence: "no_entry",
      exitEvidenceIds: [],
      status: "not_filled",
      forcedExit: false,
      holdingDurationMs: null,
      entryFee: "0.0000",
      exitFee: "0.0000",
      totalFees: "0.0000",
      grossPnl: "0.0000",
      netPnl: "0.0000",
      wholeCentNetPnl: "0.0000",
      feeClassification: "no_execution",
      spreadAtSignal: dollars(signal.ask - signal.bid),
      bidSizeAtSignal: contracts(signal.bidSize)!,
      askSizeAtSignal: contracts(signal.askSize)!,
      postFill5s: null,
      postFill15s: null,
      postFill30s: null,
      postFill60s: null,
    };
    ledger.push(l);
    if (signal.time <= busyUntil) {
      l.status = "suppressed";
      l.entryFillEvidence = "market_busy";
      continue;
    }
    const entry = passive(
      samples,
      i,
      scheduled,
      expiry,
      "buy",
      signal.bid,
      settings,
    );
    l.entryFillEvidence = entry.evidence;
    l.entryEvidenceIds = entry.ids;
    l.orderActiveAt = entry.activation ? iso(entry.activation.time) : null;
    if (entry.activation) {
      const q = queueAhead(entry.activation, "buy", signal.bid);
      l.displayedQueueAhead =
        q === null ? null : contracts(q > signal.bidSize ? q : signal.bidSize);
    }
    busyUntil = expiry;
    if (!entry.activation || entry.evidence === "post_only_would_cross") {
      l.status = "rejected";
      continue;
    }
    if (!entry.fill) {
      if (settings.scenario === "pessimistic")
        l.entryFillClassification = "unobservable_queue";
      continue;
    }
    const fill = entry.fill;
    l.entryFilled = true;
    l.entryFillClassification =
      settings.scenario === "optimistic"
        ? "hypothetical_upper_bound"
        : "hypothetical_conservative_proxy";
    l.entryFillAt = iso(fill.time);
    l.entryFillPrice = dollars(signal.bid);
    l.status = "unresolved";
    l.grossPnl = l.netPnl = l.wholeCentNetPnl = null;
    l.entryFee = l.exitFee = l.totalFees = null;
    l.feeClassification = "unverified_event_fee_window";
    busyUntil = Infinity;
    const fillIndex = atOrAfter(samples, fill.time);
    for (const [key, horizon] of [
      ["postFill5s", 5000],
      ["postFill15s", 15000],
      ["postFill30s", 30000],
      ["postFill60s", 60000],
    ] as const) {
      const future = matchForward(samples, fillIndex, horizon, 2500);
      l[key] = future
        ? {
            elapsedMs: future.time - fill.time,
            midpointChangeHalfUnits: (
              future.bid +
              future.ask -
              fill.bid -
              fill.ask
            ).toString(),
          }
        : null;
    }
    const deadline = fill.time + HOLD_MS;
    const exit = passive(
      samples,
      fillIndex,
      fill.time + settings.latencyMs,
      deadline,
      "sell",
      target,
      settings,
    );
    l.exitActiveAt = exit.activation ? iso(exit.activation.time) : null;
    l.exitQueueAhead = exit.activation
      ? contracts(queueAhead(exit.activation, "sell", target))
      : null;
    l.exitFillEvidence = exit.evidence;
    l.exitEvidenceIds = exit.ids;
    let exitSample = exit.fill,
      exitPrice = target;
    if (!exitSample) {
      const liquidateAt = deadline + settings.latencyMs;
      // First observed executable quote only; never choose the best future bid.
      for (let j = atOrAfter(samples, liquidateAt); j < samples.length; j++) {
        const s = samples[j]!;
        if (s.run !== run || s.time > liquidateAt + GAP_MS) break;
        if (s.bookTime >= liquidateAt && s.bidSize >= 100n) {
          exitSample = s;
          break;
        }
      }
      if (exitSample) {
        exitPrice = exitSample.bid > 100n ? exitSample.bid - 100n : 0n;
        l.forcedExit = true;
        l.exitFillClassification = "hypothetical_liquidation";
        l.exitFillEvidence = "first_executable_bid_after_deadline_minus_1c";
        l.exitEvidenceIds = [exitSample.id];
      } else {
        l.exitFillEvidence = "liquidation_unobservable";
        continue;
      }
    } else {
      l.exitFilled = true;
      l.exitFillClassification =
        settings.scenario === "optimistic"
          ? "hypothetical_upper_bound"
          : "hypothetical_conservative_proxy";
    }
    l.status = "completed";
    l.exitFillAt = iso(exitSample.time);
    l.exitFillPrice = dollars(exitPrice);
    l.holdingDurationMs = exitSample.time - fill.time;
    l.grossPnl = dollars(exitPrice - signal.bid);
    busyUntil = exitSample.time;
    const rule = applicableFee(
      rules,
      identity.eventTicker,
      fill.time,
      exitSample.time,
    );
    if (rule) {
      const entryFee = fee(signal.bid, rule.makerMultiplier, "maker");
      const exitRole = l.forcedExit ? "taker" : "maker",
        multiplier = l.forcedExit ? rule.takerMultiplier : rule.makerMultiplier;
      const exitFee = fee(exitPrice, multiplier, exitRole);
      l.entryFee = dollars(entryFee);
      l.exitFee = dollars(exitFee);
      l.totalFees = dollars(entryFee + exitFee);
      l.netPnl = dollars(exitPrice - signal.bid - entryFee - exitFee);
      l.wholeCentNetPnl = dollars(
        exitPrice -
          signal.bid -
          fee(signal.bid, rule.makerMultiplier, "maker", true) -
          fee(exitPrice, multiplier, exitRole, true),
      );
      l.feeClassification = "evidence_manifest";
    }
  }
  return {
    ledger,
    quality: {
      total: prepared.total,
      eligible: prepared.eligible,
      exclusions: prepared.exclusions,
    },
  };
}
