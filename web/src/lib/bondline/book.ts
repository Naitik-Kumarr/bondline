// Server-side reads of the whole Bondline book, straight from the chain. Used by server components and route
// handlers; every number the site shows comes from here or from receipts.ts.
import { createPublicClient, http, type Address } from "viem";
import {
  bondlineCoverAbi,
  bondlineMarketAbi,
  COVER_STATUS,
  deployment,
  isDeployed,
  isTeamWallet,
  robinhoodTestnet,
  type MarketKey,
} from "@bondline/shared";

export const publicClient = createPublicClient({
  chain: robinhoodTestnet,
  transport: http(process.env.RH_TESTNET_RPC_URL || undefined, { retryCount: 3, timeout: 20_000 }),
  batch: { multicall: true },
});

export const MARKET_KEYS: MarketKey[] = ["replay", "live"];

export interface Terms {
  agent: Address;
  minLimitBps: number;
  maxLimitBps: number;
  feeBps: number;
  maxStockBps: number;
  name: string;
}

export interface Health {
  status: (typeof COVER_STATUS)[number];
  fresh: boolean;
  settleable: boolean;
  limitBps: number;
  principal: bigint;
  value: bigint;
  stockValue: bigint;
  loss: bigint;
  limit: bigint;
  payoutNow: bigint;
  reserve: bigint;
}

export interface AccountView {
  address: Address;
  cover: Address;
  market: MarketKey;
  user: Address;
  team: boolean;
  limitBps: number;
  health: Health;
}

export interface OfferView {
  market: MarketKey;
  id: number;
  cover: Address;
  underwriter: Address;
  agent: Address;
  listed: boolean;
  team: boolean;
  terms: Terms;
  bond: bigint;
  reserved: bigint;
  free: bigint;
  premiums: bigint;
  claimsPaid: bigint;
  accounts: AccountView[];
}

export interface Totals {
  usdgBonded: bigint;
  coverSold: bigint;
  inForce: bigint;
  premiums: bigint;
  claimsPaid: bigint;
  offers: number;
  covers: number;
  activeCovers: number;
  underwriters: { team: number; outside: number };
  buyers: { team: number; outside: number };
}

export interface Book {
  deployed: boolean;
  readAt: number;
  offers: OfferView[];
  totals: Totals;
}

const toHealth = (h: {
  status: number;
  fresh: boolean;
  settleable: boolean;
  limitBps: number;
  principal: bigint;
  value: bigint;
  stockValue: bigint;
  loss: bigint;
  limit: bigint;
  payoutNow: bigint;
  reserve: bigint;
}): Health => ({ ...h, status: COVER_STATUS[h.status] ?? "None" });

/** Reads every offer, cover and account in both markets. A handful of multicalls. */
export async function readBook(): Promise<Book> {
  const empty: Totals = {
    usdgBonded: 0n,
    coverSold: 0n,
    inForce: 0n,
    premiums: 0n,
    claimsPaid: 0n,
    offers: 0,
    covers: 0,
    activeCovers: 0,
    underwriters: { team: 0, outside: 0 },
    buyers: { team: 0, outside: 0 },
  };
  if (!isDeployed) return { deployed: false, readAt: Date.now(), offers: [], totals: empty };

  const offers: OfferView[] = [];
  for (const market of MARKET_KEYS) {
    const address = deployment.markets[market].address;
    if (!address) continue;
    const list = await publicClient.readContract({ address, abi: bondlineMarketAbi, functionName: "offers" });
    const covers = list.map((o) => o.cover);
    const fields = ["terms", "bond", "reserved", "free", "premiums", "claimsPaid", "accountCount"] as const;
    const reads = await publicClient.multicall({
      allowFailure: false,
      contracts: covers.flatMap((cover) =>
        fields.map((functionName) => ({ address: cover, abi: bondlineCoverAbi, functionName }) as const),
      ),
    });
    for (let i = 0; i < list.length; i++) {
      const r = reads.slice(i * fields.length, (i + 1) * fields.length) as unknown[];
      offers.push({
        market,
        id: i,
        cover: list[i].cover,
        underwriter: list[i].underwriter,
        agent: list[i].agent,
        listed: list[i].listed,
        team: isTeamWallet(list[i].underwriter),
        terms: r[0] as Terms,
        bond: r[1] as bigint,
        reserved: r[2] as bigint,
        free: r[3] as bigint,
        premiums: r[4] as bigint,
        claimsPaid: r[5] as bigint,
        accounts: new Array(Number(r[6] as bigint)).fill(null),
      });
    }
  }

  // Accounts, then each account's position and health.
  const slots = offers.flatMap((o) => o.accounts.map((_, j) => ({ o, j })));
  const addresses = await publicClient.multicall({
    allowFailure: false,
    contracts: slots.map(({ o, j }) => ({
      address: o.cover,
      abi: bondlineCoverAbi,
      functionName: "accountAt",
      args: [BigInt(j)],
    }) as const),
  });
  const details = await publicClient.multicall({
    allowFailure: false,
    contracts: slots.flatMap(({ o }, k) => [
      { address: o.cover, abi: bondlineCoverAbi, functionName: "position", args: [addresses[k]] } as const,
      { address: o.cover, abi: bondlineCoverAbi, functionName: "health", args: [addresses[k]] } as const,
    ]),
  });
  slots.forEach(({ o, j }, k) => {
    const position = details[2 * k] as { user: Address; limitBps: number };
    const health = details[2 * k + 1] as Parameters<typeof toHealth>[0];
    o.accounts[j] = {
      address: addresses[k],
      cover: o.cover,
      market: o.market,
      user: position.user,
      team: isTeamWallet(position.user),
      limitBps: position.limitBps,
      health: toHealth(health),
    };
  });

  return { deployed: true, readAt: Date.now(), offers, totals: summarize(offers) };
}

/** Real totals. "Cover sold" is USDG covered (principal) across every cover ever opened. */
export function summarize(offers: OfferView[]): Totals {
  const t: Totals = {
    usdgBonded: 0n,
    coverSold: 0n,
    inForce: 0n,
    premiums: 0n,
    claimsPaid: 0n,
    offers: offers.length,
    covers: 0,
    activeCovers: 0,
    underwriters: { team: 0, outside: 0 },
    buyers: { team: 0, outside: 0 },
  };
  const underwriters = new Set<string>();
  const buyers = new Set<string>();
  for (const o of offers) {
    t.usdgBonded += o.bond;
    t.premiums += o.premiums;
    t.claimsPaid += o.claimsPaid;
    underwriters.add(o.underwriter.toLowerCase());
    for (const a of o.accounts) {
      t.covers += 1;
      t.coverSold += a.health.principal;
      if (a.health.status === "Active") {
        t.activeCovers += 1;
        t.inForce += a.health.principal;
      }
      buyers.add(a.user.toLowerCase());
    }
  }
  for (const u of underwriters) {
    if (isTeamWallet(u)) t.underwriters.team++;
    else t.underwriters.outside++;
  }
  for (const b of buyers) {
    if (isTeamWallet(b)) t.buyers.team++;
    else t.buyers.outside++;
  }
  return t;
}

/** JSON-safe copy (bigint → string) for client components. */
export function serialize<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
