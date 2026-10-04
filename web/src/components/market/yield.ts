// Live underwriter APY per offer, computed from the chain and nothing else:
//   net      = premiums earned − claims paid (both are the cover contract's own counters)
//   capital  = bond − premiums + claims paid (the USDG the underwriter has in, net of releases)
//   age      = now − the block time of the offer's OfferCreated event
//   APY      = net ÷ capital × (365 days ÷ age): simple annualisation, not compounded.
// Testnet, short windows: the figure swings with a single premium or claim, so the page always shows the window.
import "server-only";
import { cache } from "react";
import { parseAbiItem } from "viem";
import { deployment } from "@bondline/shared";
import { MARKET_KEYS, publicClient, type OfferView } from "@/lib/bondline/book";
import { getBook } from "./data";

const offerCreated = parseAbiItem(
  "event OfferCreated(uint256 indexed id, address indexed cover, address indexed underwriter, address agent, (address agent, uint16 minLimitBps, uint16 maxLimitBps, uint16 feeBps, uint16 maxStockBps, string name) terms)",
);
const CHUNK = 50_000n;
const YEAR = 365 * 86_400;

export interface OfferYield {
  /** Seconds from the offer's creation to the block this was read at. */
  windowSeconds: number;
  premiums: bigint;
  claims: bigint;
  capital: bigint;
  /** Net return over the window (a share, 0.01 = 1%). Null with no capital. */
  periodReturn: number | null;
  /** Simple annualised return (a share). Null with no capital or a zero window. */
  apy: number | null;
}

export const offerKey = (o: Pick<OfferView, "market" | "id">) => `${o.market}:${o.id}`;

export function computeYield(o: OfferView, createdAt: number, now: number): OfferYield {
  const windowSeconds = Math.max(0, now - createdAt);
  const capital = o.bond - o.premiums + o.claimsPaid;
  const net = o.premiums - o.claimsPaid;
  const periodReturn = capital > 0n ? Number(net) / Number(capital) : null;
  const apy = periodReturn != null && windowSeconds > 0 ? periodReturn * (YEAR / windowSeconds) : null;
  return { windowSeconds, premiums: o.premiums, claims: o.claimsPaid, capital, periodReturn, apy };
}

/** Yield for every offer in both markets, keyed "market:id". Null when the chain can't be read. */
export const getOfferYields = cache(async (): Promise<Map<string, OfferYield> | null> => {
  const read = await getBook();
  if (!read.ok) return null;
  try {
    const { book, block } = read;
    const created = new Map<string, number>();
    for (const market of MARKET_KEYS) {
      const m = deployment.markets[market];
      if (!m.address || m.deployBlock == null) continue;
      const ranges: [bigint, bigint][] = [];
      for (let s = BigInt(m.deployBlock); s <= block.number; s += CHUNK) {
        ranges.push([s, s + CHUNK - 1n > block.number ? block.number : s + CHUNK - 1n]);
      }
      const logs = (
        await Promise.all(
          ranges.map(([fromBlock, toBlock]) => publicClient.getLogs({ address: m.address!, event: offerCreated, fromBlock, toBlock })),
        )
      ).flat();
      const blocks = await Promise.all(
        [...new Set(logs.map((l) => l.blockNumber))].map((n) => publicClient.getBlock({ blockNumber: n })),
      );
      const timeOf = new Map(blocks.map((b) => [b.number, Number(b.timestamp)]));
      for (const l of logs) created.set(`${market}:${Number(l.args.id)}`, timeOf.get(l.blockNumber) ?? 0);
    }
    const out = new Map<string, OfferYield>();
    for (const o of book.offers) {
      const at = created.get(offerKey(o));
      if (at) out.set(offerKey(o), computeYield(o, at, block.timestamp));
    }
    return out;
  } catch {
    return null;
  }
});
