"use client";

import { usdgAbi } from "@bondline/shared/abis";
import { robinhoodTestnet } from "@bondline/shared/chain";
import { USDG } from "@bondline/shared/constants";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { usdgControls } from "@/lib/bondline/actions";
import { RPC_URL } from "@/lib/wagmi";

// The issuer-control reads get their own client, outside wagmi's multicall batching: if paused() or isFrozen()
// can't be read, that must not take the balance and capacity reads down with it.
const controlsClient = createPublicClient({ chain: robinhoodTestnet, transport: http(RPC_URL, { retryCount: 1 }) });

/**
 * Before anyone signs: USDG's issuer controls (paused, frozen), the wallet's USDG, and ETH for gas.
 * `problem` is the plain explanation when an issuer control blocks this wallet; `controlsError` means the check
 * itself couldn't run (the flows then say so instead of claiming either way).
 */
export function useWalletFunds(wallet: Address | undefined) {
  const controls = useQuery({
    queryKey: ["bondline", "usdg-controls", wallet],
    queryFn: () => usdgControls(controlsClient as unknown as PublicClient, wallet!),
    enabled: Boolean(wallet),
    refetchInterval: 30_000,
    retry: 1,
  });
  const usdg = useReadContract({
    address: USDG,
    abi: usdgAbi,
    functionName: "balanceOf",
    args: [wallet ?? "0x0000000000000000000000000000000000000000"],
    chainId: robinhoodTestnet.id,
    query: { enabled: Boolean(wallet), refetchInterval: 20_000 },
  });
  const eth = useBalance({ address: wallet, chainId: robinhoodTestnet.id, query: { enabled: Boolean(wallet) } });
  return {
    /** The issuer-control check is still running. */
    checking: Boolean(wallet) && controls.isPending,
    controlsError: controls.error,
    paused: controls.data?.paused,
    frozen: controls.data?.frozen,
    problem: controls.data?.problem ?? null,
    usdg: usdg.data,
    eth: eth.data?.value,
    loading: Boolean(wallet) && (usdg.isPending || eth.isPending),
  };
}

export type WalletFunds = ReturnType<typeof useWalletFunds>;
