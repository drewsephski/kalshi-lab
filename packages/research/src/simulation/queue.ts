import { fixed } from "../spread.ts";
import type { Sample } from "./types.ts";
/** Queue includes better prices; absent levels beyond the retained ladder are
 * unknown. A limit improving the best quote has zero displayed queue only. */
export function queueAhead(
  s: Sample,
  side: "buy" | "sell",
  limit: bigint,
): bigint | null {
  const best = side === "buy" ? s.bid : s.ask;
  if ((side === "buy" && limit > best) || (side === "sell" && limit < best))
    return 0n;
  if (limit === best) return side === "buy" ? s.bidSize : s.askSize;
  try {
    const depth = s.raw.supplemental.depth as
      Record<string, unknown> | undefined;
    const raw = depth?.[side === "buy" ? "yesTop10" : "noTop10"];
    if (!Array.isArray(raw) || !raw.length || raw.length > 10) return null;
    const levels = raw
      .map((l: unknown) => {
        if (!Array.isArray(l) || l.length !== 2)
          throw new Error("Invalid ladder.");
        const p = fixed(l[0], 4),
          size = fixed(l[1], 2);
        if (p > 10000n || size <= 0n || size >= 10n ** 24n)
          throw new Error("Invalid level.");
        return { p: side === "buy" ? p : 10000n - p, size };
      })
      .sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
    if (new Set(levels.map((l) => l.p.toString())).size !== levels.length)
      return null;
    const top = side === "buy" ? levels.at(-1)! : levels[0]!;
    if (top.p !== best || top.size !== (side === "buy" ? s.bidSize : s.askSize))
      return null;
    if (
      (side === "buy" && levels[0]!.p > limit) ||
      (side === "sell" && levels.at(-1)!.p < limit)
    )
      return null;
    return levels
      .filter((l) => (side === "buy" ? l.p >= limit : l.p <= limit))
      .reduce((sum, l) => sum + l.size, 0n);
  } catch {
    return null;
  }
}
export const contracts = (q: bigint | null) =>
  q === null ? null : `${q / 100n}.${(q % 100n).toString().padStart(2, "0")}`;
