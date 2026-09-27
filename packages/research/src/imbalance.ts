import { fixed, priceUnits } from "./spread.ts";
export const BUCKETS = [
  "strong sell-heavy",
  "moderate sell-heavy",
  "balanced",
  "moderate buy-heavy",
  "strong buy-heavy",
] as const;
export type Bucket = (typeof BUCKETS)[number];
function bucket(difference: bigint, total: bigint): Bucket {
  if (5n * difference < -3n * total) return BUCKETS[0];
  if (5n * difference < -total) return BUCKETS[1];
  if (5n * difference <= total) return BUCKETS[2];
  if (5n * difference <= 3n * total) return BUCKETS[3];
  return BUCKETS[4];
}
function ladder(raw: unknown): { price: number; size: bigint }[] {
  if (!Array.isArray(raw) || raw.length > 10)
    throw new Error("Missing/invalid ladder.");
  const levels = raw
    .map((level: unknown) => {
      if (!Array.isArray(level) || level.length !== 2)
        throw new Error("Invalid level.");
      const price = priceUnits(level[0]);
      const size = fixed(level[1], 2);
      if (size <= 0n || size >= 10n ** 24n)
        throw new Error("Invalid level quantity.");
      return { price, size };
    })
    .sort((a, b) => b.price - a.price);
  if (new Set(levels.map((l) => l.price)).size !== levels.length)
    throw new Error("Duplicate price level.");
  return levels;
}
export function imbalance(
  supplemental: Record<string, unknown>,
  bid: number,
  ask: number,
  bidSize: string | null,
  askSize: string | null,
) {
  try {
    const depth = supplemental.depth;
    if (!depth || typeof depth !== "object" || Array.isArray(depth))
      return null;
    const record = depth as Record<string, unknown>;
    const yes = ladder(record.yesTop10);
    const no = ladder(record.noTop10);
    if (
      bidSize === null ||
      askSize === null ||
      yes[0]?.price !== bid ||
      no[0]?.price !== 10000 - ask ||
      yes[0]?.size !== fixed(bidSize, 2) ||
      no[0]?.size !== fixed(askSize, 2)
    )
      return null;
    const buy = yes.slice(0, 3).reduce((sum, l) => sum + l.size, 0n);
    const sell = no.slice(0, 3).reduce((sum, l) => sum + l.size, 0n);
    const total = buy + sell;
    if (!total) return null;
    return {
      buyDepth: Number(buy) / 100,
      sellDepth: Number(sell) / 100,
      value: Number(buy - sell) / Number(total),
      bucket: bucket(buy - sell, total),
    };
  } catch {
    return null;
  }
}
