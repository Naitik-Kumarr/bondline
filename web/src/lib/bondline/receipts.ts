// Completed trades and rule-check refusals, with the AI's decision JSON decoded from the transaction input. Anyone can check
// a receipt: keccak256(decision bytes from the input) must equal the event's decisionHash.
import { decodeFunctionData, hexToString, keccak256, parseAbiItem, type Address, type Hex } from "viem";
import { agentAccountAbi, BLOCK_REASONS, deployment } from "@bondline/shared";
import { publicClient } from "./book";

const traded = parseAbiItem(
  "event Traded(address indexed asset, bool isBuy, uint256 usdAmount, uint256 amountIn, uint256 amountOut, uint256 price, uint256 valueAfter, uint256 stockValueAfter, bytes32 indexed decisionHash)",
);
const blocked = parseAbiItem(
  "event Blocked(address indexed asset, bool isBuy, uint256 usdAmount, uint8 reason, uint256 observed, uint256 limit, bytes32 indexed decisionHash)",
);

export interface Receipt {
  kind: "trade" | "refusal";
  account: Address;
  asset: Address;
  isBuy: boolean;
  usdAmount: bigint;
  /** Trades: fill and the account after it. */
  amountOut?: bigint;
  price?: bigint;
  valueAfter?: bigint;
  stockValueAfter?: bigint;
  /** Refusals: which rule, and the two numbers it compared. */
  reason?: (typeof BLOCK_REASONS)[number];
  observed?: bigint;
  limit?: bigint;
  decisionHash: Hex;
  txHash: Hex;
  blockNumber: bigint;
  timestamp?: number;
}

const CHUNK = 50_000n;

async function logsFor(accounts: Address[], fromBlock: bigint) {
  const latest = await publicClient.getBlockNumber();
  const out: Receipt[] = [];
  for (let start = fromBlock; start <= latest; start += CHUNK) {
    const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
    const [t, b] = await Promise.all([
      publicClient.getLogs({ address: accounts, event: traded, fromBlock: start, toBlock: end }),
      publicClient.getLogs({ address: accounts, event: blocked, fromBlock: start, toBlock: end }),
    ]);
    for (const l of t) {
      out.push({
        kind: "trade",
        account: l.address,
        asset: l.args.asset!,
        isBuy: l.args.isBuy!,
        usdAmount: l.args.usdAmount!,
        amountOut: l.args.amountOut,
        price: l.args.price,
        valueAfter: l.args.valueAfter,
        stockValueAfter: l.args.stockValueAfter,
        decisionHash: l.args.decisionHash!,
        txHash: l.transactionHash,
        blockNumber: l.blockNumber,
      });
    }
    for (const l of b) {
      out.push({
        kind: "refusal",
        account: l.address,
        asset: l.args.asset!,
        isBuy: l.args.isBuy!,
        usdAmount: l.args.usdAmount!,
        reason: BLOCK_REASONS[l.args.reason!],
        observed: l.args.observed,
        limit: l.args.limit,
        decisionHash: l.args.decisionHash!,
        txHash: l.transactionHash,
        blockNumber: l.blockNumber,
      });
    }
  }
  return out.sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

/** Receipts for a set of accounts, newest first. */
export async function readReceipts(accounts: Address[], limit = 50): Promise<Receipt[]> {
  if (accounts.length === 0) return [];
  const from = BigInt(
    Math.min(...(["live", "replay"] as const).map((m) => deployment.markets[m].deployBlock ?? Number.MAX_SAFE_INTEGER)),
  );
  const all = await logsFor(accounts, from);
  const latest = all.slice(0, limit);
  const blocks = await Promise.all(
    [...new Set(latest.map((r) => r.blockNumber))].map((n) => publicClient.getBlock({ blockNumber: n })),
  );
  const timeOf = new Map(blocks.map((b) => [b.number, Number(b.timestamp)]));
  for (const r of latest) r.timestamp = timeOf.get(r.blockNumber);
  return latest;
}

export interface DecisionCheck {
  decision: string | null;
  parsed: Record<string, unknown> | null;
  computedHash: Hex | null;
  matches: boolean;
}

/** Fetches a receipt's transaction, decodes the trade() input and re-hashes the decision bytes. */
export async function verifyDecision(txHash: Hex, decisionHash: Hex): Promise<DecisionCheck> {
  const tx = await publicClient.getTransaction({ hash: txHash });
  try {
    const { functionName, args } = decodeFunctionData({ abi: agentAccountAbi, data: tx.input });
    if (functionName !== "trade") return { decision: null, parsed: null, computedHash: null, matches: false };
    const bytes = args[4] as Hex;
    const computedHash = keccak256(bytes);
    const decision = hexToString(bytes);
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(decision);
    } catch {
      parsed = null;
    }
    return { decision, parsed, computedHash, matches: computedHash === decisionHash };
  } catch {
    return { decision: null, parsed: null, computedHash: null, matches: false };
  }
}
