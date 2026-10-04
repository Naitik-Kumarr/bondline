"use client";

import { robinhoodTestnet } from "@bondline/shared/chain";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { useAccount, useConfig, type Config } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { TxState } from "@/components/ui/TxStatus";
import { explainTxError } from "./errors";

export interface TxView {
  state: TxState;
  hash?: Hex;
  /** A plain-language error, ready for <TxStatus error={...}>. */
  error?: Error;
}

export interface ContractCall {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

// wagmi's action types are generic over the ABI; these flows pass ABIs around as values, so call them loosely.
const simulate = simulateContract as unknown as (
  config: Config,
  params: Record<string, unknown>,
) => Promise<{ request: Record<string, unknown> }>;
const write = writeContract as unknown as (config: Config, params: Record<string, unknown>) => Promise<Hex>;

/**
 * One chain action's lifecycle: simulate (so a refusal is explained before the wallet asks), ask the wallet,
 * wait for the block, then refresh every chain read. Always on Robinhood Chain testnet.
 */
export function useTx() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const [view, setView] = useState<TxView>({ state: "idle" });

  const send = useCallback(
    async (call: ContractCall): Promise<TransactionReceipt | null> => {
      if (!address) {
        setView({ state: "error", error: new Error("Connect a wallet first.") });
        return null;
      }
      let hash: Hex | undefined;
      setView({ state: "signing" });
      try {
        const { request } = await simulate(config, { ...call, account: address, chainId: robinhoodTestnet.id });
        hash = await write(config, request);
        setView({ state: "pending", hash });
        const receipt = await waitForTransactionReceipt(config, {
          hash,
          chainId: robinhoodTestnet.id,
          pollingInterval: 1_000,
        });
        if (receipt.status !== "success") throw new Error("The transaction reverted onchain.");
        setView({ state: "success", hash });
        void queryClient.invalidateQueries();
        return receipt;
      } catch (error) {
        setView({ state: "error", hash, error: new Error(explainTxError(error)) });
        return null;
      }
    },
    [address, config, queryClient],
  );

  /** A wallet request that isn't a transaction (a signature): only the signing and error states apply. */
  const sign = useCallback(async <T,>(request: () => Promise<T>): Promise<T | null> => {
    setView({ state: "signing" });
    try {
      const out = await request();
      setView({ state: "idle" });
      return out;
    } catch (error) {
      setView({ state: "error", error: new Error(explainTxError(error)) });
      return null;
    }
  }, []);

  const reset = useCallback(() => setView({ state: "idle" }), []);

  return { ...view, busy: view.state === "signing" || view.state === "pending", send, sign, reset };
}
