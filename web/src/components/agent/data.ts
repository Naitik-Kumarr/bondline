// Server-side data for /agent/[address]: the agent's latest trades and refusals from the chain, each with the AI's
// decision JSON decoded from its transaction input (lib/bondline/receipts.ts), and the stock share after every trade.
import "server-only";
import { getAddress, type Address, type Hex } from "viem";
import { agentAccountAbi, deployment, type AgentRecord, type MarketKey } from "@bondline/shared";
import { publicClient } from "@/lib/bondline/book";
import { readReceipts, verifyDecision } from "@/lib/bondline/receipts";
import { errorMessage, readShareSeries } from "@/components/market/data";
import { refusalDetail } from "@/components/market/fmt";

const MAX_UINT = (1n << 256n) - 1n;
const symbolByAddress = new Map(Object.entries(deployment.assets).map(([s, a]) => [a.toLowerCase(), s]));
const symbolOf = (asset: string) => symbolByAddress.get(asset.toLowerCase()) ?? `${asset.slice(0, 6)}…${asset.slice(-4)}`;

export interface ReceiptView {
  kind: "trade" | "refusal";
  market: MarketKey | null;
  account: Address;
  asset: string;
  side: "buy" | "sell";
  /** USDG value; null when the agent asked to sell everything. */
  usd: number | null;
  reason: { key: string; label: string } | null;
  /** Refusals: the two numbers the contract compared, in words. */
  detail: string | null;
  decisionHash: Hex;
  txHash: Hex;
  blockNumber: number;
  timestamp: number | null;
  /** The AI's decision JSON, exactly as in the transaction input. */
  decision: string | null;
  parsed: Record<string, unknown> | null;
  /** The server's own re-hash matched the event (the Verify button re-checks it in the browser). */
  matches: boolean | null;
  /** Where this receipt was read: live from the chain, or from the static record if the chain was unreachable. */
  source: "chain" | "record";
}

export type ReceiptsRead = { ok: true; receipts: ReceiptView[]; source: "chain" | "record" } | { ok: false; error: string };

const usdOfUnits = (v: bigint) => Number(v) / 1e6;

/** The latest trades and refusals of these accounts, newest first, with decoded decisions. */
export async function readAgentReceipts(
  accounts: { address: Address; market: MarketKey }[],
  record: AgentRecord | null,
  limit = 12,
): Promise<ReceiptsRead> {
  const marketOf = new Map(accounts.map((a) => [a.address.toLowerCase(), a.market]));
  try {
    const receipts = await readReceipts(
      accounts.map((a) => a.address),
      limit,
    );
    const checks = await Promise.all(
      receipts.map((r) =>
        verifyDecision(r.txHash, r.decisionHash).catch(() => ({ decision: null, parsed: null, computedHash: null, matches: false })),
      ),
    );
    return {
      ok: true,
      source: "chain",
      receipts: receipts.map((r, i) => ({
        kind: r.kind,
        market: marketOf.get(r.account.toLowerCase()) ?? null,
        account: getAddress(r.account),
        asset: symbolOf(r.asset),
        side: r.isBuy ? "buy" : "sell",
        usd: r.usdAmount === MAX_UINT ? null : usdOfUnits(r.usdAmount),
        reason: r.reason ? { key: r.reason.key, label: r.reason.label } : null,
        detail: r.reason ? refusalDetail(r.reason.key, r.observed, r.limit, r.isBuy) : null,
        decisionHash: r.decisionHash,
        txHash: r.txHash,
        blockNumber: Number(r.blockNumber),
        timestamp: r.timestamp ?? null,
        decision: checks[i].decision,
        parsed: checks[i].parsed,
        matches: checks[i].decision == null ? null : checks[i].matches,
        source: "chain" as const,
      })),
    };
  } catch (e) {
    // The chain is unreachable: fall back to the receipts in the static record, labelled as such.
    if (record && record.recent.length > 0) {
      return {
        ok: true,
        source: "record",
        receipts: record.recent.slice(0, limit).map((r) => {
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = r.decision ? JSON.parse(r.decision) : null;
          } catch {
            parsed = null;
          }
          return {
            kind: r.type,
            market: r.market,
            account: getAddress(r.account),
            asset: r.asset,
            side: r.side,
            usd: r.usd,
            reason: r.reason ? { key: r.reason.key, label: r.reason.label } : null,
            detail: null,
            decisionHash: r.decisionHash,
            txHash: r.txHash,
            blockNumber: r.blockNumber,
            timestamp: r.timestamp,
            decision: r.decision ?? null,
            parsed,
            matches: r.decisionVerified ?? null,
            source: "record" as const,
          };
        }),
      };
    }
    return { ok: false, error: errorMessage(e) };
  }
}

export interface ExposurePoint {
  share: number;
  market: MarketKey | null;
  blockNumber: number;
}

/** The stock share after every trade of these accounts, oldest first. Never throws. */
export async function readExposure(accounts: { address: Address; market: MarketKey }[]): Promise<ExposurePoint[] | null> {
  const marketOf = new Map(accounts.map((a) => [a.address.toLowerCase(), a.market]));
  try {
    const points = await readShareSeries(accounts.map((a) => a.address));
    return points.map((p) => ({
      share: p.share,
      market: marketOf.get(p.account.toLowerCase()) ?? null,
      blockNumber: p.blockNumber,
    }));
  } catch {
    return null;
  }
}

export interface AccountRules {
  account: Address;
  market: MarketKey;
  assets: string[];
  maxStockBps: number;
  maxTradeBps: number;
  maxDailyBps: number;
  maxSlippageBps: number;
  maxPriceAge: number;
  paused: boolean;
  stopped: boolean;
}

/** Each covered account's rules, read from the account contract itself (fixed at open). Null if the read fails. */
export async function readAccountRules(accounts: { address: Address; market: MarketKey }[]): Promise<AccountRules[] | null> {
  if (accounts.length === 0) return [];
  try {
    const fields = ["rules", "assets", "paused", "stopped"] as const;
    const res = await publicClient.multicall({
      allowFailure: false,
      contracts: accounts.flatMap((a) =>
        fields.map((functionName) => ({ address: a.address, abi: agentAccountAbi, functionName }) as const),
      ),
    });
    return accounts.map((a, i) => {
      const [rules, assets, paused, stopped] = res.slice(i * 4, i * 4 + 4) as [
        { assetMask: number; maxStockBps: number; maxTradeBps: number; maxDailyBps: number; maxSlippageBps: number; maxPriceAge: number },
        readonly Address[],
        boolean,
        boolean,
      ];
      return {
        account: getAddress(a.address),
        market: a.market,
        assets: assets.filter((_, j) => (rules.assetMask & (1 << j)) !== 0).map((x) => symbolOf(x)),
        maxStockBps: Number(rules.maxStockBps),
        maxTradeBps: Number(rules.maxTradeBps),
        maxDailyBps: Number(rules.maxDailyBps),
        maxSlippageBps: Number(rules.maxSlippageBps),
        maxPriceAge: Number(rules.maxPriceAge),
        paused,
        stopped,
      };
    });
  } catch {
    return null;
  }
}
