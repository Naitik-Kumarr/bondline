// Small display helpers shared by /market, /agent and /judge. Pure: safe on the server and the client.
import { BLOCK_REASONS } from "@bondline/shared/constants";

const en = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-US", opts);

/** USDG base units (6 decimals, bigint or decimal string) to dollars as a JS number. Display only. */
export function usdgToUsd(amount: bigint | string | number): number {
  const v = typeof amount === "bigint" ? amount : BigInt(amount);
  const whole = v / 1_000_000n;
  const frac = v % 1_000_000n;
  return Number(whole) + Number(frac) / 1e6;
}

/** `$1,234.57`; whole dollars when there are no cents. */
export function usd(value: number, opts: { cents?: boolean } = {}): string {
  const cents = opts.cents ?? !Number.isInteger(Math.round(value * 100) / 100);
  return en({
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(value);
}

/** USDG units straight to `$1,234.57`. */
export const usdOf = (amount: bigint | string | number, opts?: { cents?: boolean }) => usd(usdgToUsd(amount), opts);

/** A share (0–1) as a percent: 0.1694 -> `16.9%`. */
export function pct(share: number, digits = 1): string {
  return `${en({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(share * 100)}%`;
}

/** Basis points as a percent: 1000 -> `10%`, 125 -> `1.25%`. */
export function bpsPct(bps: number, maxDigits = 2): string {
  return `${en({ maximumFractionDigits: maxDigits }).format(bps / 100)}%`;
}

/** Basis points with one decimal, for model prices: 13.093 -> `13.1 bps`. */
export function bpsText(bps: number, digits = 1): string {
  return `${en({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(bps)} bps`;
}

/** A model price in basis points as a percent of the amount covered: 13.09 -> `0.13%`, 174.7 -> `1.75%`. */
export function modelPct(bps: number): string {
  return `${en({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(bps / 100)}%`;
}

export function int(value: number | bigint): string {
  return en({ maximumFractionDigits: 0 }).format(value);
}

/** `1h 4m`, `3m 12s`, `45s`, `2d 3h`. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** `3 Oct, 19:44 UTC`: stable on the server and the client (always UTC). */
export function utcTime(unixSeconds: number, opts: { seconds?: boolean; date?: boolean } = {}): string {
  const d = new Date(unixSeconds * 1000);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: opts.seconds ? "2-digit" : undefined,
    hour12: false,
    timeZone: "UTC",
  }).format(d);
  return opts.date === false ? `${time} UTC` : `${date}, ${time} UTC`;
}

/** Display name for a team agent role or an offer name. */
export function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const MAX_UINT = (1n << 256n) - 1n;

/**
 * A refusal in plain words: which rule, and the two numbers the contract compared (`observed` broke `limit`).
 * Units depend on the rule (see AgentAccount._plan): USDG amounts, basis points, seconds or flags.
 */
export function refusalDetail(
  reasonKey: string,
  observedRaw: bigint | string | null | undefined,
  limitRaw: bigint | string | null | undefined,
  isBuy: boolean,
): string | null {
  if (observedRaw == null || limitRaw == null) return null;
  const observed = BigInt(observedRaw);
  const limit = BigInt(limitRaw);
  const $ = (v: bigint) => usdOf(v, { cents: true });
  switch (reasonKey) {
    case "TradeTooLarge":
      return `${$(observed)} trade; the per trade limit was ${$(limit)}`;
    case "DailyLimit":
      return `${$(observed)} traded today with this one; the daily limit was ${$(limit)}`;
    case "InsufficientCash":
      return `${$(observed)} needed; ${$(limit)} cash in the account`;
    case "InsufficientStock":
      return `${$(observed)} to sell; ${$(limit)} of the stock held`;
    case "StockShare":
      return `${bpsPct(Number(observed))} in stocks after the trade; the rule allows ${bpsPct(Number(limit))}`;
    case "Slippage":
      return `fill ${bpsPct(Number(observed))} off the oracle price; the rule allows ${bpsPct(Number(limit))}`;
    case "PriceStale":
      if (observed === MAX_UINT) return `no valid price; prices may be at most ${int(limit)}s old`;
      if (limit >= 100_000_000n) return "the demo exchange quoted a different price than the oracle";
      return `price ${int(observed)}s old; the rule allows ${int(limit)}s`;
    case "MinOut":
    case "NoLiquidity":
      return isBuy ? null : `${$(observed)} out; ${reasonKey === "MinOut" ? "minimum" : "available"} ${$(limit)}`;
    default:
      return null;
  }
}

export const reasonLabel = (key: string) => BLOCK_REASONS.find((r) => r.key === key)?.label ?? key;

/** Known model ids in decision JSON, shown by name. Anything else is shown as given. */
export function modelName(id: unknown): string | null {
  if (typeof id !== "string" || !id) return null;
  if (id === "mock") return "Mock (pipeline test)";
  if (id.startsWith("claude-haiku-4-5")) return "Claude Haiku 4.5";
  return id;
}

/** `1 claim`, `2 claims`: the noun follows the count. */
export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
