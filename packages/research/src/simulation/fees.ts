import { fixed } from "../spread.ts";
import type { FeeRule } from "./types.ts";
/** Dollar amounts are serialized losslessly; all computations are bigint. */
export function dollars(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const digits = (units < 0n ? -units : units).toString().padStart(5, "0");
  return `${sign}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}
export function money(value: string): bigint {
  return value.startsWith("-") ? -fixed(value.slice(1), 4) : fixed(value, 4);
}
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
/** Official July 7 2026 schedule: centicent rounding. One whole contract.
 * Its position cost is already an integer centicent, so fee+cost rounding
 * equals fee rounding. Never use this helper for fractional contracts.
 */
export function fee(
  price: bigint,
  multiplier: string,
  role: "maker" | "taker",
  wholeCent = false,
): bigint {
  if (price < 0n || price > 10000n) throw new Error("Invalid fee price.");
  const m = fixed(multiplier, 4);
  if (m > 1000000n) throw new Error("Invalid fee multiplier.");
  const numerator =
    m * (role === "maker" ? 175n : 700n) * price * (10000n - price);
  const quantum = wholeCent ? 100n : 1n;
  return ceil(numerator, 1000000000000n * quantum) * quantum;
}
export function parseFeeRules(input: unknown): FeeRule[] {
  if (!Array.isArray(input) || input.length > 1000)
    throw new Error("Invalid fee manifest.");
  return input.map((raw: unknown) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid fee rule.");
    const r = raw as FeeRule;
    for (const value of [r.eventTicker, r.seriesTicker, r.rationale])
      if (typeof value !== "string" || !value.trim())
        throw new Error("Missing fee evidence.");
    if (
      !Array.isArray(r.evidence) ||
      !r.evidence.length ||
      r.evidence.some(
        (s) =>
          typeof s !== "string" ||
          !/^https:\/\/(docs\.kalshi\.com|kalshi\.com|external-api\.kalshi\.com)\//.test(
            s,
          ),
      )
    )
      throw new Error("Fee evidence must identify official sources.");
    if (
      !r.from?.endsWith("Z") ||
      !r.toExclusive?.endsWith("Z") ||
      !(Date.parse(r.from) < Date.parse(r.toExclusive))
    )
      throw new Error("Invalid fee window.");
    fee(5000n, r.makerMultiplier, "maker");
    fee(5000n, r.takerMultiplier, "taker");
    return r;
  });
}
export function applicableFee(
  rules: FeeRule[],
  event: string | null,
  entry: number,
  exit: number,
): FeeRule | null {
  const matches = rules.filter(
    (r) =>
      r.eventTicker === event &&
      Date.parse(r.from) <= entry &&
      Date.parse(r.toExclusive) > exit,
  );
  return matches.length === 1 ? matches[0]! : null;
}
