"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { Button } from "@/components/ui/Button";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type Log = { address: string; topics: Hex[] };
type Fetched = { input: Hex; logs: Log[]; via: "rpc" | "server" };

type State =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "done"; match: boolean; computed: Hex; onChain: Hex | null; bytes: number; via: "rpc" | "server" }
  | { status: "error"; message: string };

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

/** The transaction and its receipt, straight from the RPC (plain JSON-RPC, no wallet libraries). */
async function fromRpc(txHash: Hex): Promise<Fetched> {
  const { robinhoodTestnet } = await import("@bondline/shared/chain");
  const url = process.env.NEXT_PUBLIC_RH_RPC_URL || robinhoodTestnet.rpcUrls.default.http[0];
  const call = async (method: string) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [txHash] }),
    });
    if (!res.ok) throw new Error(`RPC answered ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error || !body.result) throw new Error(body.error?.message ?? "transaction not found");
    return body.result as Record<string, unknown>;
  };
  const [tx, receipt] = await Promise.all([call("eth_getTransactionByHash"), call("eth_getTransactionReceipt")]);
  return { input: tx.input as Hex, logs: (receipt.logs as Log[]) ?? [], via: "rpc" };
}

/** Fallback when the browser can't reach the RPC: our server relays the raw transaction; the browser still hashes. */
async function fromServer(txHash: Hex, account: Address): Promise<Fetched> {
  const res = await fetch(`/api/verify?tx=${txHash}&account=${account}`);
  const body = (await res.json()) as { input?: Hex; logs?: Log[]; error?: string };
  if (!res.ok || !body.input) throw new Error(body.error ?? `server answered ${res.status}`);
  return { input: body.input, logs: body.logs ?? [], via: "server" };
}

/**
 * Verify: fetch the transaction and its receipt, decode the decision bytes from the trade() input, keccak256 them in
 * this browser, and compare with the decisionHash in the account's Traded or Blocked event. viem loads on click.
 */
export function VerifyButton({
  txHash,
  account,
  className,
  size = "sm",
}: {
  txHash: Hex;
  account: Address;
  className?: string;
  /** "md" (44px tall) where it's the main control, as on the tour. */
  size?: "sm" | "md";
}) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function run() {
    setState({ status: "checking" });
    try {
      const [viem, fetched] = await Promise.all([
        import("viem"),
        fromRpc(txHash).catch(() => fromServer(txHash, account)),
      ]);
      const { decodeFunctionData, keccak256, parseAbi, toEventSelector } = viem;
      const abi = parseAbi([
        "function trade(address asset, bool isBuy, uint256 usdAmount, uint256 minOut, bytes decision) returns (bool executed)",
      ]);
      const topics = new Set([
        toEventSelector("Traded(address,bool,uint256,uint256,uint256,uint256,uint256,uint256,bytes32)"),
        toEventSelector("Blocked(address,bool,uint256,uint8,uint256,uint256,bytes32)"),
      ]);
      const call = decodeFunctionData({ abi, data: fetched.input });
      const bytes = call.args[4] as Hex;
      const computed = keccak256(bytes);
      const log = fetched.logs.find(
        (l) => l.address.toLowerCase() === account.toLowerCase() && l.topics[0] && topics.has(l.topics[0]),
      );
      const onChain = log?.topics[2] ?? null;
      setState({
        status: "done",
        match: onChain !== null && computed.toLowerCase() === onChain.toLowerCase(),
        computed,
        onChain,
        bytes: (bytes.length - 2) / 2,
        via: fetched.via,
      });
    } catch (e) {
      const message = e instanceof Error ? (e as Error & { shortMessage?: string }).shortMessage || e.message : String(e);
      setState({
        status: "error",
        message: /signature|decode/i.test(message)
          ? "This transaction isn't a direct trade() call, so there's no decision in its input to check."
          : `Couldn't check it just now: ${message.slice(0, 160)}`,
      });
    }
  }

  const id = `verify-${txHash}`;
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div>
        <Button
          size={size}
          variant="secondary"
          onClick={run}
          loading={state.status === "checking"}
          loadingLabel="Rehashing the decision"
          aria-describedby={state.status === "done" || state.status === "error" ? id : undefined}
        >
          {state.status === "done" ? "Verify again" : "Verify"}
        </Button>
      </div>
      {state.status === "done" ? (
        <div
          id={id}
          role="status"
          className={cn(
            "flex items-start gap-2.5 rounded-field px-3.5 py-3 text-[13px] leading-relaxed",
            state.match ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative",
          )}
        >
          {state.match ? <CheckIcon size={16} className="mt-0.5 shrink-0" /> : <AlertIcon size={16} className="mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <p className="font-medium">{state.match ? "Match" : "Mismatch"}</p>
            <p className="mt-0.5 text-ink-2">
              {state.via === "rpc"
                ? "Your browser fetched this transaction from the RPC, took the "
                : "Our server relayed this transaction from the RPC (your browser couldn't reach it); your browser took the "}
              <span className="num">{state.bytes}</span> decision bytes from its input and hashed them:
            </p>
            <p className="num mt-1 break-all text-[12px] text-ink">keccak256 = {short(state.computed)}</p>
            <p className="num break-all text-[12px] text-ink">event hash = {state.onChain ? short(state.onChain) : "not found"}</p>
          </div>
        </div>
      ) : state.status === "error" ? (
        <p id={id} role="alert" className="rounded-field bg-negative-soft px-3.5 py-2.5 text-[13px] text-negative">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
