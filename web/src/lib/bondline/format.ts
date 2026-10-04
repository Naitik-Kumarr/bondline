// Formatting for amounts and rates. Amounts are always shown in mono, tabular figures.
import { formatUnits } from "viem";

/** USDG (6 decimals) as dollars: 1234567890n -> "1,234.57". */
export function usdg(amount: bigint | string | number, decimals = 2): string {
  const n = Number(formatUnits(BigInt(amount), 6));
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** USDG as a number of dollars, for NumberFlow. */
export function usdgNumber(amount: bigint | string | number): number {
  return Number(formatUnits(BigInt(amount), 6));
}

/** Basis points as a percentage: 1000 -> "10%", 125 -> "1.25%". */
export function bps(value: number | bigint): string {
  const pct = Number(value) / 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** An 8-decimal oracle price: 37045000000n -> "370.45". */
export function price(value: bigint | string): string {
  return Number(formatUnits(BigInt(value), 8)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ago(unixSeconds: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(now - unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
