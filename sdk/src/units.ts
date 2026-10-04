import { formatUnits, maxUint256, parseUnits } from "viem";
import { USDG_DECIMALS } from "@bondline/shared";

/**
 * USDG amounts: a bigint is in base units (6 decimals); a string or number is decimal USDG ("100.5").
 * Throws on negatives, more than 6 decimals, and anything that is not a plain decimal.
 */
export function parseUsdg(value: string | number | bigint): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new RangeError("amount must not be negative");
    return value;
  }
  const s = typeof value === "number" ? numberToDecimal(value) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new RangeError(`not a USDG amount: ${JSON.stringify(value)}`);
  const decimals = s.split(".")[1]?.length ?? 0;
  if (decimals > USDG_DECIMALS) throw new RangeError(`USDG has ${USDG_DECIMALS} decimals, got ${decimals} in ${s}`);
  return parseUnits(s, USDG_DECIMALS);
}

function numberToDecimal(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`not a USDG amount: ${n}`);
  // toString() can give exponent notation for tiny or huge numbers; toFixed(6) is exact enough for 6 decimals.
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(USDG_DECIMALS) : s;
}

export const formatUsdg = (units: bigint) => formatUnits(units, USDG_DECIMALS);

/** A base-unit integer given as a decimal string or bigint (stock tokens, minOut). */
export function parseBaseUnits(value: string | bigint, what = "amount"): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new RangeError(`${what} must not be negative`);
    return value;
  }
  if (!/^\d+$/.test(value.trim())) throw new RangeError(`${what} must be a base-unit integer string, got ${JSON.stringify(value)}`);
  return BigInt(value.trim());
}

/** "max" (or the max uint256) sells the account's whole balance. */
export const SELL_ALL = maxUint256;

/** JSON-safe copy of a value: bigints become decimal strings. */
export function toJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
