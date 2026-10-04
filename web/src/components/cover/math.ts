// The cover's money math, exactly as BondlineCover does it (see docs/TECHNICAL.md §2), for previews.
import { CAP_BPS } from "@bondline/shared/constants";
import { parseUnits } from "viem";

const BPS = 10_000n;
const CAP = BigInt(CAP_BPS);

export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** "12.5" → 12_500_000n; anything unparsable → null. */
export function parseUsdg(text: string): bigint | null {
  if (!/^\d+(\.\d{0,6})?$/.test(text.trim())) return null;
  try {
    return parseUnits(text.trim(), 6);
  } catch {
    return null;
  }
}

export interface DepositQuote {
  fee: bigint;
  net: bigint;
  reserveNeeded: bigint;
  /** ⌈net × limit⌉: the loss the user carries. */
  limitUsd: bigint;
  /** ⌊net × (cap − limit)⌋: the most the bond can pay on this deposit. */
  maxPayout: bigint;
}

export function quoteDeposit(amount: bigint, feeBps: number, limitBps: number): DepositQuote {
  const fee = (amount * BigInt(feeBps)) / BPS;
  const net = amount - fee;
  const band = CAP - BigInt(limitBps);
  return {
    fee,
    net,
    reserveNeeded: ceilDiv(net * band, BPS),
    limitUsd: ceilDiv(net * BigInt(limitBps), BPS),
    maxPayout: (net * band) / BPS,
  };
}

/** The contract's capacity check: the premium joins the bond first, then the free bond must cover the reserve. */
export const fits = (q: Pick<DepositQuote, "fee" | "reserveNeeded">, free: bigint) => q.reserveNeeded <= free + q.fee;

/** The largest deposit the free bond can back at this limit; null when the premium alone covers every reserve. */
export function maxDeposit(free: bigint, feeBps: number, limitBps: number): bigint | null {
  const ok = (a: bigint) => fits(quoteDeposit(a, feeBps, limitBps), free);
  const HUGE = 10n ** 18n;
  if (ok(HUGE)) return null;
  let lo = 0n;
  let hi = HUGE;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (ok(mid)) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

/** After `withdraw(amount)`: the principal shrinks by the share of value taken out (rounded down). */
export function principalAfterWithdraw(principal: bigint, value: bigint, amount: bigint) {
  if (value === 0n || amount > value) return 0n;
  return (principal * (value - amount)) / value;
}

export const limitOf = (principal: bigint, limitBps: number) => ceilDiv(principal * BigInt(limitBps), BPS);
export const payoutCapOf = (principal: bigint, limitBps: number) => (principal * (CAP - BigInt(limitBps))) / BPS;
