import type { Sample, Scenario } from "./types.ts";
export function fillEvidence(
  scenario: Scenario,
  side: "buy" | "sell",
  limit: bigint,
  previous: Sample,
  current: Sample,
  priorThrough: boolean,
): string | null {
  if (scenario === "pessimistic") return null; // No complete trade tape in this adapter.
  if (
    previous.segment !== current.segment ||
    current.time <= previous.time ||
    current.bookTime <= previous.time ||
    current.tickerTime <= previous.time
  )
    return null;
  if (
    previous.volume === null ||
    current.volume === null ||
    current.volume <= previous.volume
  )
    return null;
  if ((side === "buy" ? current.askSize : current.bidSize) < 100n) return null;
  if (scenario === "optimistic") {
    const touched =
      side === "buy" ? current.ask <= limit : current.bid >= limit;
    return touched ? "opposite_quote_with_volume_proxy" : null;
  }
  return priorThrough && through(side, limit, current)
    ? "persistent_through_with_volume_proxy"
    : null;
}
export function through(
  side: "buy" | "sell",
  limit: bigint,
  s: Sample,
): boolean {
  return (
    (side === "buy" ? s.ask < limit : s.bid > limit) &&
    (side === "buy" ? s.askSize : s.bidSize) >= 100n
  );
}
