/** Linear interpolation at index (n-1)*p; empty distributions are unavailable. */
export function percentile(
  sorted: readonly number[],
  p: number,
): number | null {
  if (p < 0 || p > 1 || !Number.isFinite(p))
    throw new Error("Invalid percentile.");
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lower = sorted[Math.floor(index)]!;
  return lower + (sorted[Math.ceil(index)]! - lower) * (index % 1);
}
export function stats(values: readonly number[]) {
  if (values.some((v) => !Number.isFinite(v)))
    throw new Error("Nonfinite statistic.");
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    mean: values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
}
export function percentage(
  numerator: number,
  denominator: number,
): number | null {
  return denominator ? (100 * numerator) / denominator : null;
}
