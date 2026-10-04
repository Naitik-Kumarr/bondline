import { formatUnits } from "viem";

const USDG_DECIMALS = 6;

/** `0x1234…abcd` */
export function shortAddress(address: string, chars = 4) {
  if (!address || address.length < 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/** `0x12ab…cdef` for transaction hashes. */
export const shortHash = (hash: string) => shortAddress(hash, 4);

/** USDG base units (6 decimals) to a JS number of dollars. Fine for display; keep bigint for maths. */
export function usdgToNumber(amount: bigint) {
  return Number(formatUnits(amount, USDG_DECIMALS));
}

/** Intl format options for NumberFlow and Intl.NumberFormat: whole dollars unless there are cents. */
export function usdFormat(value: number, opts: { cents?: boolean } = {}): Intl.NumberFormatOptions {
  const cents = opts.cents ?? !Number.isInteger(value);
  return {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  };
}

/** `$1,000` or `$12.50` */
export function formatUsd(value: number, opts: { cents?: boolean } = {}) {
  return new Intl.NumberFormat("en-US", usdFormat(value, opts)).format(value);
}

/** `1,000.00 USDG` from base units. */
export function formatUsdg(amount: bigint, opts: { decimals?: number } = {}) {
  const decimals = opts.decimals ?? 2;
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(usdgToNumber(amount))} USDG`;
}

/** Basis points to a percent number: 1000 -> 10. */
export const bpsToPercent = (bps: number) => bps / 100;

/** Basis points to text: 1000 -> `10%`, 250 -> `2.5%`, with an optional sign (uses a true minus). */
export function formatBps(bps: number, opts: { signed?: boolean; negative?: boolean } = {}) {
  const pct = bpsToPercent(Math.abs(bps));
  const text = `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(pct)}%`;
  if (opts.negative || bps < 0) return `−${text}`;
  if (opts.signed && bps > 0) return `+${text}`;
  return text;
}
