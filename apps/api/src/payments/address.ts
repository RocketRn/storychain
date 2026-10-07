import { Address } from "@ton/core";

/**
 * The same TON address has bounceable (EQ…), non-bounceable (UQ…), testnet and raw (0:hex) spellings.
 * ALWAYS compare in raw form, never as strings.
 */
export function rawAddress(addr: string): string {
  return Address.parse(addr).toRawString();
}

export function sameAddress(a: string, b: string): boolean {
  try {
    return rawAddress(a) === rawAddress(b);
  } catch {
    return false; // unparsable addresses never match
  }
}
