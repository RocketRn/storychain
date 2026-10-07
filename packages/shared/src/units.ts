/** Convert a human decimal string ("0.5") to smallest units as bigint. No float math. */
export function toUnits(value: string, decimals: number): bigint {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`Invalid amount: "${value}"`);
  const [whole = "0", frac = ""] = v.split(".");
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) {
    throw new Error(`Too many decimal places (max ${decimals}): "${value}"`);
  }
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole + fracPadded);
}

/** Convert smallest units to a human decimal string, trimming trailing zeros. */
export function fromUnits(units: bigint | string, decimals: number): string {
  const n = typeof units === "bigint" ? units : BigInt(units);
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
