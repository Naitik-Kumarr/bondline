"use client";

import { aggregatorV3Abi, agentAccountAbi, bondlineCoverAbi, bondlineMarketAbi, usdgAbi } from "@bondline/shared/abis";
import { robinhoodTestnet } from "@bondline/shared/chain";
import { COVER_STATUS, USDG } from "@bondline/shared/constants";
import { erc20Abi, type Address, type ContractFunctionParameters } from "viem";
import { useReadContracts } from "wagmi";
import type { Rules } from "@/lib/bondline/actions";
import { marketOf, symbolOf, type MarketInfo } from "./kit/bondline";
import type { OfferTerms } from "./kit/useOffers";

const chainId = robinhoodTestnet.id;
const POLL = 6_000;

export interface Holding {
  token: Address;
  symbol: string;
  balance: bigint;
  /** USDG value at the oracle price (6 decimals); undefined without a valid price. */
  value: bigint | undefined;
  price: bigint | undefined;
  updatedAt: number | undefined;
}

export interface AccountData {
  owner: Address;
  agent: Address;
  cover: Address;
  market: MarketInfo;
  paused: boolean;
  stopped: boolean;
  released: boolean;
  rules: Rules;
  status: (typeof COVER_STATUS)[number];
  fresh: boolean;
  settleable: boolean;
  limitBps: number;
  principal: bigint;
  value: bigint;
  cash: bigint;
  stockValue: bigint;
  loss: bigint;
  limit: bigint;
  payoutNow: bigint;
  reserve: bigint;
  oldestUpdate: number;
  terms: OfferTerms;
  underwriter: Address;
  offerId: number | undefined;
  usdgBalance: bigint;
  holdings: Holding[];
}

type R = { status: "success" | "failure"; result?: unknown } | undefined;
const ok = <T,>(r: R) => (r?.status === "success" ? (r.result as T) : undefined);

/**
 * Everything the account page shows, live: the account's own state, its position and health in the cover, the
 * offer's terms, its token balances and their prices. `invalid` when the address isn't a Bondline covered account.
 */
export function useAccountData(account: Address) {
  const base = useReadContracts({
    allowFailure: true,
    contracts: (["owner", "agent", "cover", "market", "paused", "stopped", "released", "rules", "valuation", "assets", "feeds"] as const).map(
      (functionName) => ({ address: account, abi: agentAccountAbi, functionName, chainId }) as const,
    ),
    query: { refetchInterval: POLL },
  });
  const b = base.data as R[] | undefined;
  const cover = ok<Address>(b?.[2]);
  const market = marketOf(ok<Address>(b?.[3]));
  const assets = ok<readonly Address[]>(b?.[9]) ?? [];
  const feeds = ok<readonly Address[]>(b?.[10]) ?? [];

  const detailContracts = (
    cover && market
      ? [
          { address: cover, abi: bondlineCoverAbi, functionName: "health", args: [account], chainId },
            { address: cover, abi: bondlineCoverAbi, functionName: "terms", chainId },
            { address: cover, abi: bondlineCoverAbi, functionName: "underwriter", chainId },
            { address: market.address, abi: bondlineMarketAbi, functionName: "isOffer", args: [cover], chainId },
            { address: market.address, abi: bondlineMarketAbi, functionName: "idOf", args: [cover], chainId },
            { address: USDG, abi: usdgAbi, functionName: "balanceOf", args: [account], chainId },
            ...assets.map((a) => ({ address: a, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId }) as const),
            ...feeds.map((f) => ({ address: f, abi: aggregatorV3Abi, functionName: "latestRoundData", chainId }) as const),
          ]
      : []
  ) as unknown as ContractFunctionParameters[];
  // The list's length depends on the account's assets, so wagmi can't type each result; they're read with ok<T>().
  const detail = useReadContracts({
    allowFailure: true,
    contracts: detailContracts,
    query: { enabled: Boolean(cover && market), refetchInterval: POLL },
  });
  const d = detail.data as R[] | undefined;

  // Not an account: the calls answered, but not as a Bondline account would (a transport error is not "invalid").
  const invalidBase = Boolean(b) && (!ok(b?.[0]) || !cover || !market);
  const health = ok<{
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
  }>(d?.[0]);
  const isOffer = ok<boolean>(d?.[3]);
  const invalidDetail = Boolean(d) && (isOffer === false || (health !== undefined && health.status === 0));

  let data: AccountData | undefined;
  const valuation = ok<{ value: bigint; cash: bigint; stockValue: bigint; oldestUpdate: bigint; pricesValid: boolean }>(b?.[8]);
  const rules = ok<Rules>(b?.[7]);
  const terms = ok<OfferTerms>(d?.[1]);
  if (!invalidBase && !invalidDetail && cover && market && health && valuation && rules && terms) {
    const n = assets.length;
    const holdings: Holding[] = assets.map((token, i) => {
      const balance = ok<bigint>(d?.[6 + i]) ?? 0n;
      const round = ok<readonly [bigint, bigint, bigint, bigint, bigint]>(d?.[6 + n + i]);
      const price = round && round[1] > 0n ? round[1] : undefined;
      return {
        token,
        symbol: symbolOf(token),
        balance,
        price,
        updatedAt: round ? Number(round[3]) : undefined,
        // stock (18 decimals) x price (8 decimals) / 1e20 = USDG (6 decimals)
        value: price !== undefined ? (balance * price) / 10n ** 20n : undefined,
      };
    });
    data = {
      owner: ok<Address>(b?.[0])!,
      agent: ok<Address>(b?.[1])!,
      cover,
      market,
      paused: ok<boolean>(b?.[4]) ?? false,
      stopped: ok<boolean>(b?.[5]) ?? false,
      released: ok<boolean>(b?.[6]) ?? false,
      rules,
      status: COVER_STATUS[health.status] ?? "None",
      fresh: health.fresh,
      settleable: health.settleable,
      limitBps: health.limitBps,
      principal: health.principal,
      value: health.value,
      cash: valuation.cash,
      stockValue: health.stockValue,
      loss: health.loss,
      limit: health.limit,
      payoutNow: health.payoutNow,
      reserve: health.reserve,
      oldestUpdate: Number(valuation.oldestUpdate),
      terms,
      underwriter: ok<Address>(d?.[2])!,
      offerId: ok<bigint>(d?.[4]) !== undefined ? Number(ok<bigint>(d?.[4])) : undefined,
      usdgBalance: ok<bigint>(d?.[5]) ?? valuation.cash,
      holdings,
    };
  }

  return {
    data,
    invalid: invalidBase || invalidDetail,
    error: base.error ?? detail.error,
    refetch: () => {
      void base.refetch();
      void detail.refetch();
    },
  };
}
