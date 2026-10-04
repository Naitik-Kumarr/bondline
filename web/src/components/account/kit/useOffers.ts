"use client";

import { bondlineCoverAbi, bondlineMarketAbi } from "@bondline/shared/abis";
import { robinhoodTestnet } from "@bondline/shared/chain";
import { COVER_STATUS } from "@bondline/shared/constants";
import { isDeployed, isTeamWallet, type MarketKey } from "@bondline/shared/deployment";
import { useQuery } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { MARKETS } from "./bondline";

export interface OfferTerms {
  agent: Address;
  minLimitBps: number;
  maxLimitBps: number;
  feeBps: number;
  maxStockBps: number;
  name: string;
}

export interface CoveredAccount {
  address: Address;
  user: Address;
  limitBps: number;
  status: (typeof COVER_STATUS)[number];
  principal: bigint;
  reserve: bigint;
}

export interface LiveOffer {
  market: MarketKey;
  marketAddress: Address;
  id: number;
  cover: Address;
  underwriter: Address;
  agent: Address;
  listed: boolean;
  team: boolean;
  terms: OfferTerms;
  bond: bigint;
  reserved: bigint;
  free: bigint;
  premiums: bigint;
  claimsPaid: bigint;
  accountCount: number;
  /** Filled only when read `withAccounts`. */
  accounts?: CoveredAccount[];
}

/** Every offer in both markets, read from the chain in a few multicalls; optionally each covered account too. */
export async function readOffers(client: PublicClient, withAccounts: boolean): Promise<LiveOffer[]> {
  const lists = await Promise.all(
    MARKETS.map((m) => client.readContract({ address: m.address, abi: bondlineMarketAbi, functionName: "offers" })),
  );
  const base = MARKETS.flatMap((m, i) => lists[i].map((o, id) => ({ m, o, id })));
  const fields = ["terms", "bond", "reserved", "free", "premiums", "claimsPaid", "accountCount"] as const;
  const reads = await client.multicall({
    allowFailure: false,
    contracts: base.flatMap(({ o }) =>
      fields.map((functionName) => ({ address: o.cover, abi: bondlineCoverAbi, functionName }) as const),
    ),
  });
  const offers: LiveOffer[] = base.map(({ m, o, id }, i) => {
    const r = reads.slice(i * fields.length, (i + 1) * fields.length) as unknown[];
    return {
      market: m.key,
      marketAddress: m.address,
      id,
      cover: o.cover,
      underwriter: o.underwriter,
      agent: o.agent,
      listed: o.listed,
      team: isTeamWallet(o.underwriter),
      terms: r[0] as OfferTerms,
      bond: r[1] as bigint,
      reserved: r[2] as bigint,
      free: r[3] as bigint,
      premiums: r[4] as bigint,
      claimsPaid: r[5] as bigint,
      accountCount: Number(r[6] as bigint),
    };
  });
  if (!withAccounts) return offers;

  const slots = offers.flatMap((o) => Array.from({ length: o.accountCount }, (_, j) => ({ o, j })));
  if (slots.length === 0) return offers.map((o) => ({ ...o, accounts: [] }));
  const addresses = (await client.multicall({
    allowFailure: false,
    contracts: slots.map(({ o, j }) => ({
      address: o.cover,
      abi: bondlineCoverAbi,
      functionName: "accountAt",
      args: [BigInt(j)],
    }) as const),
  })) as Address[];
  const positions = await client.multicall({
    allowFailure: false,
    contracts: slots.map(({ o }, k) => ({
      address: o.cover,
      abi: bondlineCoverAbi,
      functionName: "position",
      args: [addresses[k]],
    }) as const),
  });
  const byCover = new Map<Address, CoveredAccount[]>();
  slots.forEach(({ o }, k) => {
    const p = positions[k] as { user: Address; limitBps: number; status: number; principal: bigint; reserve: bigint };
    const list = byCover.get(o.cover) ?? [];
    list.push({
      address: addresses[k],
      user: p.user,
      limitBps: p.limitBps,
      status: COVER_STATUS[p.status] ?? "None",
      principal: p.principal,
      reserve: p.reserve,
    });
    byCover.set(o.cover, list);
  });
  return offers.map((o) => ({ ...o, accounts: byCover.get(o.cover) ?? [] }));
}

/** Live offers, refreshed every 15 seconds and after every transaction. */
export function useOffers({ withAccounts = false }: { withAccounts?: boolean } = {}) {
  const client = usePublicClient({ chainId: robinhoodTestnet.id });
  return useQuery({
    queryKey: ["bondline", "offers", withAccounts],
    queryFn: () => readOffers(client as unknown as PublicClient, withAccounts),
    enabled: Boolean(client) && isDeployed,
    refetchInterval: 15_000,
  });
}
