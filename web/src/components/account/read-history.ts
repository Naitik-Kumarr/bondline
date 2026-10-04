import { cache } from "react";
// Server only. A covered account's life from chain events: opened, deposits, withdrawals, pause and resume, the
// settle (with the payout) or close, and sweeps. Read with the same server client as the rest of the book.
import { agentAccountAbi, bondlineCoverAbi } from "@bondline/shared/abis";
import { deployment } from "@bondline/shared/deployment";
import type { Address, Hex } from "viem";
import { publicClient } from "@/lib/bondline/book";

export type HistoryKind = "opened" | "deposited" | "withdrawn" | "paused" | "resumed" | "settled" | "closed" | "swept";

export interface HistoryItem {
  kind: HistoryKind;
  txHash: Hex;
  blockNumber: string;
  logIndex: number;
  timestamp: number | null;
  /** USDG amounts as decimal strings (6 decimals), so the list is JSON-safe. */
  amount?: string;
  fee?: string;
  net?: string;
  principal?: string;
  payout?: string;
  loss?: string;
  limit?: string;
  limitBps?: number;
  caller?: Address;
  token?: Address;
}

const CHUNK = 50_000n;

export async function readAccountHistory(account: Address): Promise<{ cover: Address; items: HistoryItem[] }> {
  const cover = await publicClient.readContract({ address: account, abi: agentAccountAbi, functionName: "cover" });
  const from = BigInt(
    Math.min(...(["live", "replay"] as const).map((m) => deployment.markets[m].deployBlock ?? Number.MAX_SAFE_INTEGER)),
  );
  const latest = await publicClient.getBlockNumber();
  const items: HistoryItem[] = [];
  for (let start = from; start <= latest; start += CHUNK) {
    const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
    const [coverLogs, accountLogs] = await Promise.all([
      publicClient.getContractEvents({ address: cover, abi: bondlineCoverAbi, fromBlock: start, toBlock: end }),
      publicClient.getContractEvents({ address: account, abi: agentAccountAbi, fromBlock: start, toBlock: end }),
    ]);
    for (const l of coverLogs) {
      const args = l.args as Record<string, unknown>;
      if (typeof args.account !== "string" || args.account.toLowerCase() !== account.toLowerCase()) continue;
      const base = { txHash: l.transactionHash, blockNumber: l.blockNumber.toString(), logIndex: l.logIndex, timestamp: null };
      const s = (k: string) => (typeof args[k] === "bigint" ? (args[k] as bigint).toString() : undefined);
      if (l.eventName === "Opened") items.push({ ...base, kind: "opened", limitBps: Number(args.limitBps) });
      else if (l.eventName === "Deposited")
        items.push({ ...base, kind: "deposited", amount: s("amount"), fee: s("fee"), net: s("net") });
      else if (l.eventName === "Withdrawn")
        items.push({ ...base, kind: "withdrawn", amount: s("amount"), principal: s("principal") });
      else if (l.eventName === "Settled")
        items.push({
          ...base,
          kind: "settled",
          payout: s("payout"),
          loss: s("loss"),
          limit: s("limit"),
          caller: args.caller as Address,
        });
      else if (l.eventName === "Closed") items.push({ ...base, kind: "closed" });
    }
    for (const l of accountLogs) {
      const base = { txHash: l.transactionHash, blockNumber: l.blockNumber.toString(), logIndex: l.logIndex, timestamp: null };
      if (l.eventName === "AgentPaused") items.push({ ...base, kind: "paused" });
      else if (l.eventName === "AgentResumed") items.push({ ...base, kind: "resumed" });
      else if (l.eventName === "Swept") {
        const args = l.args as { token?: Address; amount?: bigint };
        items.push({ ...base, kind: "swept", token: args.token, amount: args.amount?.toString() });
      }
    }
  }
  items.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) || b.logIndex - a.logIndex);
  const shown = items.slice(0, 30);
  const blocks = await Promise.all(
    [...new Set(shown.map((i) => i.blockNumber))].map((n) => publicClient.getBlock({ blockNumber: BigInt(n) })),
  );
  const timeOf = new Map(blocks.map((b) => [b.number.toString(), Number(b.timestamp)]));
  for (const i of shown) i.timestamp = timeOf.get(i.blockNumber) ?? null;
  return { cover, items: shown };
}

/** One history scan per request, shared by the history list and the settled-payout figure. */
export const readAccountHistoryOnce = cache(readAccountHistory);
