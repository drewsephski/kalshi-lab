export const HORIZONS = [5000, 15000, 30000, 60000] as const;
export interface Timed {
  time: number;
  segment: number;
}
/** O(log n) nearest future sample; ties use earlier. No crossing quality gaps. */
export function matchForward<T extends Timed>(
  rows: readonly T[],
  index: number,
  horizonMs: number,
  toleranceMs: number,
): T | null {
  if (horizonMs <= 0 || toleranceMs < 0)
    throw new Error("Invalid horizon/tolerance.");
  const current = rows[index];
  if (!current) throw new Error("Invalid index.");
  const target = current.time + horizonMs;
  let lo = index + 1,
    hi = rows.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid]!.time < target) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [rows[lo - 1], rows[lo]].filter(
    (row): row is T =>
      !!row &&
      row.time > current.time &&
      row.segment === current.segment &&
      Math.abs(row.time - target) <= toleranceMs,
  );
  candidates.sort(
    (a, b) =>
      Math.abs(a.time - target) - Math.abs(b.time - target) || a.time - b.time,
  );
  return candidates[0] ?? null;
}
