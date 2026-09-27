/** Exact decimal arithmetic. API dollars have four decimals; counts have two. */
export function units(value: unknown, scale: number, signed = false): bigint {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^-?\d+(?:\.\d+)?$/.test(value)
  ) {
    throw new Error("Invalid fixed-point decimal string.");
  }
  if (!signed && value.startsWith("-")) throw new Error("Negative quantity.");
  const negative = value.startsWith("-");
  const [whole = "", fraction = ""] = value.replace(/^-/, "").split(".");
  if (fraction.length > scale)
    throw new Error("Unsupported decimal precision.");
  const result =
    BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
  return negative ? -result : result;
}

export function decimal(value: bigint, scale: number): string {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

export function price(value: unknown): string {
  const amount = units(value, 4);
  if (amount > 10_000n) throw new Error("Binary contract price exceeds $1.");
  return decimal(amount, 4);
}

export function count(value: unknown): string {
  const amount = units(value, 2);
  if (amount >= 10n ** 24n)
    throw new Error("Contract count exceeds storage precision.");
  return decimal(amount, 2);
}

export function complement(value: string | null): string | null {
  return value === null ? null : decimal(10_000n - units(value, 4), 4);
}
