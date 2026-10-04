// Server-side data for /live and /party: one market's covers (health read from the chain), its feed prices, and its
// Settled events. Reuses the cached book and feed reads of /market, so a request reads the chain once.
import "server-only";
import { cache } from "react";
import { parseAbiItem, type Address } from "viem";
import { deployment, type MarketKey } from "@bondline/shared";
import { publicClient, type OfferView } from "@/lib/bondline/book";
import { agentName, getBook, getFeedPrices, errorMessage, type FeedPrice } from "@/components/market/data";
import type { CoverRow } from "./CoverList";

export interface MarketView {
  key: MarketKey;
  maxPriceAge: number;
  block: { number: bigint; timestamp: number };
  prices: FeedPrice[];
  offers: OfferView[];
  rows: CoverRow[];
  bond: bigint;
  free: bigint;
  reserved: bigint;
  active: number;
  pastLimit: number;
  settled: number;
}

export type MarketRead = { ok: true; view: MarketView } | { ok: false; error: string };

const order = { Active: 0, Settled: 1, Closed: 2, None: 3 } as const;

/** Past its limit: an Active cover whose loss exceeds its limit (settleable only when every price is fresh). */
export const isPastLimit = (a: { health: { status: string; loss: bigint; limit: bigint } }) =>
  a.health.status === "Active" && a.health.loss > a.health.limit;

export const readMarket = cache(async (key: MarketKey): Promise<MarketRead> => {
  const read = await getBook();
  if (!read.ok) return read;
  try {
    const prices = (await getFeedPrices())[key];
    const offers = read.book.offers.filter((o) => o.market === key);
    const rows: CoverRow[] = offers
      .flatMap((o) =>
        o.accounts.map((account) => ({
          account,
          agent: agentName(o.agent, [o]),
          offerName: o.terms.name?.trim() || `Offer ${o.id}`,
        })),
      )
      .sort(
        (a, b) =>
          order[a.account.health.status] - order[b.account.health.status] ||
          Number(isPastLimit(b.account)) - Number(isPastLimit(a.account)),
      );
    const accounts = rows.map((r) => r.account);
    return {
      ok: true,
      view: {
        key,
        maxPriceAge: deployment.markets[key].maxPriceAge,
        block: read.block,
        prices,
        offers,
        rows,
        bond: offers.reduce((s, o) => s + o.bond, 0n),
        free: offers.reduce((s, o) => s + o.free, 0n),
        reserved: offers.reduce((s, o) => s + o.reserved, 0n),
        active: accounts.filter((a) => a.health.status === "Active").length,
        pastLimit: accounts.filter(isPastLimit).length,
        settled: accounts.filter((a) => a.health.status === "Settled").length,
      },
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
});

// ------------------------------------------------------------------ payouts

const settledEvent = parseAbiItem(
  "event Settled(address indexed account, address indexed user, address indexed caller, uint256 value, uint256 loss, uint256 limit, uint256 payout)",
);
const CHUNK = 50_000n;

export interface Payout {
  account: Address;
  user: Address;
  caller: Address;
  value: bigint;
  loss: bigint;
  limit: bigint;
  payout: bigint;
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
}

/** Every Settled event from a market's covers, oldest first, with block times. */
export const readPayouts = cache(async (key: MarketKey, toBlock: bigint): Promise<Payout[]> => {
  const read = await getBook();
  if (!read.ok) return [];
  const covers = read.book.offers.filter((o) => o.market === key).map((o) => o.cover);
  const start = deployment.markets[key].deployBlock;
  if (covers.length === 0 || start == null) return [];
  const ranges: [bigint, bigint][] = [];
  for (let s = BigInt(start); s <= toBlock; s += CHUNK) ranges.push([s, s + CHUNK - 1n > toBlock ? toBlock : s + CHUNK - 1n]);
  const logs = (
    await Promise.all(
      ranges.map(([fromBlock, to]) => publicClient.getLogs({ address: covers, event: settledEvent, fromBlock, toBlock: to })),
    )
  ).flat();
  logs.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
  const blocks = await Promise.all(
    [...new Set(logs.map((l) => l.blockNumber))].map((n) => publicClient.getBlock({ blockNumber: n })),
  );
  const timeOf = new Map(blocks.map((b) => [b.number, Number(b.timestamp)]));
  return logs.map((l) => ({
    account: l.args.account!,
    user: l.args.user!,
    caller: l.args.caller!,
    value: l.args.value ?? 0n,
    loss: l.args.loss ?? 0n,
    limit: l.args.limit ?? 0n,
    payout: l.args.payout ?? 0n,
    txHash: l.transactionHash,
    blockNumber: Number(l.blockNumber),
    timestamp: timeOf.get(l.blockNumber) ?? null,
  }));
});

