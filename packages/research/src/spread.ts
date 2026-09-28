export const THRESHOLDS = [100, 200, 300] as const;
/** Parse without rounding. All classifications use fixed point, not float. */
export function fixed(value: unknown, scale: number): bigint {
  if (
    typeof value !== "string" ||
    !/^\d+(\.\d+)?$/.test(value) ||
    value.length > 40
  )
    throw new Error("Invalid unsigned decimal.");
  const [whole = "", fraction = ""] = value.split(".");
  if (fraction.length > scale) throw new Error("Excess decimal precision.");
  return (
    BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"))
  );
}
export function priceUnits(value: string): number {
  const amount = fixed(value, 4);
  if (amount > 10000n) throw new Error("Price outside binary range.");
  return Number(amount);
}
export function spreadUnits(bid: string, ask: string): number {
  const result = priceUnits(ask) - priceUnits(bid);
  if (result < 0) throw new Error("Crossed quote.");
  return result;
}
export function quantity(value: string | null): number | null {
  if (value === null) return null;
  // Quantities are exact for parsing/imbalance; reported summary numbers are approximate.
  const amount = fixed(value, 2);
  if (amount >= 10n ** 24n)
    throw new Error("Quantity exceeds storage precision.");
  return Number(amount) / 100;
}
