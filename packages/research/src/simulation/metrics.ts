import { dollars, money } from "./fees.ts";
import type { Ledger } from "./types.ts";
const sum = (v: bigint[]) => v.reduce((a, b) => a + b, 0n);
const pct = (n: number, d: number) => (d ? (100 * n) / d : null);
/** Means retain their exact rational dollar representation alongside display values. */
export function distribution(values: bigint[]) {
  const ordered = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    n = ordered.length;
  const medianNumerator = n
    ? ordered[Math.floor((n - 1) / 2)]! + ordered[Math.floor(n / 2)]!
    : null;
  return {
    count: n,
    total: dollars(sum(values)),
    mean: n ? { numerator: dollars(sum(values)), denominator: n } : null,
    median:
      medianNumerator === null
        ? null
        : { numerator: dollars(medianNumerator), denominator: 2 },
  };
}
export function maximumDrawdown(values: bigint[]): bigint {
  let peak = 0n,
    cumulative = 0n,
    drawdown = 0n;
  for (const v of values) {
    cumulative += v;
    if (cumulative > peak) peak = cumulative;
    if (peak - cumulative > drawdown) drawdown = peak - cumulative;
  }
  return drawdown;
}
export function metrics(ledger: readonly Ledger[]) {
  const completed = ledger.filter((l) => l.status === "completed");
  const known = completed
    .filter((l) => l.netPnl !== null)
    .sort(
      (a, b) =>
        a.exitFillAt!.localeCompare(b.exitFillAt!) ||
        a.simulationId.localeCompare(b.simulationId),
    );
  const net = known.map((l) => money(l.netPnl!)),
    wins = net.filter((n) => n > 0n),
    losses = net.filter((n) => n < 0n);
  const posted = ledger.filter(
    (l) => l.status !== "rejected" && l.status !== "suppressed",
  );
  const fills = ledger.filter((l) => l.entryFilled);
  const knownFees = sum(known.map((l) => money(l.totalFees!)));
  const unavailable = completed.length > 0 && known.length === 0;
  return {
    signals: ledger.length,
    suppressedSignals: ledger.filter((l) => l.status === "suppressed").length,
    ordersPosted: posted.length,
    rejectedOrders: ledger.filter((l) => l.status === "rejected").length,
    entryFills: fills.length,
    entryFillRatePct: pct(fills.length, posted.length),
    passiveExitFills: completed.filter((l) => l.exitFilled).length,
    passiveExitFillRatePct: pct(
      completed.filter((l) => l.exitFilled).length,
      fills.length,
    ),
    forcedExits: completed.filter((l) => l.forcedExit).length,
    unresolved: ledger.filter((l) => l.status === "unresolved").length,
    completedTrades: completed.length,
    feeKnownTrades: known.length,
    unknownFeeTrades: completed.length - known.length,
    grossPnl: dollars(sum(completed.map((l) => money(l.grossPnl!)))),
    feeKnownGrossPnl: unavailable
      ? null
      : dollars(sum(known.map((l) => money(l.grossPnl!)))),
    fees: unavailable ? null : dollars(knownFees),
    netPnl: unavailable ? null : dollars(sum(net)),
    wholeCentNetPnl: unavailable
      ? null
      : dollars(sum(known.map((l) => money(l.wholeCentNetPnl!)))),
    netPerTrade: distribution(net),
    winRatePct: pct(wins.length, net.length),
    lossRatePct: pct(losses.length, net.length),
    breakevenRatePct: pct(net.filter((n) => n === 0n).length, net.length),
    averageWin: distribution(wins).mean,
    averageLoss: distribution(losses).mean,
    profitFactor: losses.length
      ? { numerator: dollars(sum(wins)), denominator: dollars(-sum(losses)) }
      : null,
    profitFactorClassification: losses.length
      ? "finite"
      : wins.length
        ? "no_losses"
        : "no_trades_or_breakeven",
    maximumDrawdown: unavailable ? null : dollars(maximumDrawdown(net)),
    adverseSelection: Object.fromEntries(
      (
        ["postFill5s", "postFill15s", "postFill30s", "postFill60s"] as const
      ).map((key) => {
        const matched = fills.flatMap((l) => (l[key] ? [l[key]!] : [])),
          movements = matched.map((m) => BigInt(m.midpointChangeHalfUnits));
        const sorted = [...movements].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
          n = sorted.length;
        return [
          key,
          {
            matched: n,
            missing: fills.length - n,
            adverseMoveRatePct: pct(movements.filter((m) => m < 0n).length, n),
            meanHalfUnits: n
              ? { numerator: sum(movements).toString(), denominator: n }
              : null,
            medianHalfUnits: n
              ? {
                  numerator: (
                    sorted[Math.floor((n - 1) / 2)]! +
                    sorted[Math.floor(n / 2)]!
                  ).toString(),
                  denominator: 2,
                }
              : null,
            actualElapsedMs: matched.map((m) => m.elapsedMs),
          },
        ];
      }),
    ),
  };
}
export function grouped(
  ledger: readonly Ledger[],
  key: "ticker" | "eventTicker" | "family" | "category" | "workerRunId",
) {
  const groups = new Map<string, Ledger[]>();
  for (const l of ledger) {
    const value = l[key] ?? "unknown";
    const g = groups.get(value) ?? [];
    g.push(l);
    groups.set(value, g);
  }
  return Object.fromEntries(
    [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, rows]) => [k, metrics(rows)]),
  );
}
export function concentration(
  ledger: readonly Ledger[],
  key: "family" | "eventTicker" = "family",
  basis: "netPnl" | "grossPnl" = "netPnl",
) {
  const groups = new Map<string, { positive: bigint; net: bigint }>();
  for (const l of ledger) {
    const value = l[basis];
    if (l.status !== "completed" || value === null) continue;
    const g = groups.get(l[key] ?? "unknown") ?? { positive: 0n, net: 0n };
    const n = money(value);
    g.net += n;
    if (n > 0n) g.positive += n;
    groups.set(l[key] ?? "unknown", g);
  }
  const positive = sum([...groups.values()].map((g) => g.positive)),
    totalNet = sum([...groups.values()].map((g) => g.net));
  const ranked = [...groups].sort(([a, x], [b, y]) =>
    x.positive > y.positive
      ? -1
      : x.positive < y.positive
        ? 1
        : a.localeCompare(b),
  );
  return {
    basis,
    positivePnl: dollars(positive),
    totalPnl: dollars(totalNet),
    largestPositiveSharePct: positive
      ? (100 * Number(ranked[0]![1].positive)) / Number(positive)
      : null,
    largestThreePositiveSharePct: positive
      ? (100 * Number(sum(ranked.slice(0, 3).map(([, g]) => g.positive)))) /
        Number(positive)
      : null,
    byEvent: ranked.map(([event, g]) => ({
      event,
      positivePnl: dollars(g.positive),
      totalPnl: dollars(g.net),
      shareOfPositivePct: positive
        ? (100 * Number(g.positive)) / Number(positive)
        : null,
      shareOfTotalNetPct:
        totalNet > 0n ? (100 * Number(g.net)) / Number(totalNet) : null,
    })),
  };
}
