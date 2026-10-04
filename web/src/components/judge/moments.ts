// The on-chain moments for /judge, derived from chain events (never typed in): an offer created and funded in one
// transaction, a cover bought, an AI trade with its reasoning, a refusal, and a claim paid.
import "server-only";
import { decodeFunctionData, getAddress, parseAbiItem, type Address, type Hex } from "viem";
import { BLOCK_REASONS, bondlineMarketAbi, deployment, TEAM_WALLETS, type MarketKey } from "@bondline/shared";
import gapDemo from "@/data/gap-demo.json";
import { MARKET_KEYS, publicClient } from "@/lib/bondline/book";
import { verifyDecision } from "@/lib/bondline/receipts";
import { errorMessage, getBook } from "@/components/market/data";
import { refusalDetail } from "@/components/market/fmt";
import { gapSettleTx, readGapDemo } from "./gap";

const ev = {
  offerCreated: parseAbiItem(
    "event OfferCreated(uint256 indexed id, address indexed cover, address indexed underwriter, address agent, (address agent, uint16 minLimitBps, uint16 maxLimitBps, uint16 feeBps, uint16 maxStockBps, string name) terms)",
  ),
  offerFunded: parseAbiItem("event OfferFunded(uint256 indexed id, address indexed underwriter, uint256 bond)"),
  opened: parseAbiItem(
    "event Opened(address indexed account, address indexed user, uint16 limitBps, (uint8 assetMask, uint16 maxStockBps, uint16 maxTradeBps, uint32 maxDailyBps, uint16 maxSlippageBps, uint32 maxPriceAge) rules)",
  ),
  deposited: parseAbiItem(
    "event Deposited(address indexed account, address indexed from, uint256 amount, uint256 fee, uint256 net, uint256 reserveAdded)",
  ),
  settled: parseAbiItem(
    "event Settled(address indexed account, address indexed user, address indexed caller, uint256 value, uint256 loss, uint256 limit, uint256 payout)",
  ),
  traded: parseAbiItem(
    "event Traded(address indexed asset, bool isBuy, uint256 usdAmount, uint256 amountIn, uint256 amountOut, uint256 price, uint256 valueAfter, uint256 stockValueAfter, bytes32 indexed decisionHash)",
  ),
  blocked: parseAbiItem(
    "event Blocked(address indexed asset, bool isBuy, uint256 usdAmount, uint8 reason, uint256 observed, uint256 limit, bytes32 indexed decisionHash)",
  ),
};

const CHUNK = 50_000n;
const MAX_UINT = (1n << 256n) - 1n;
const symbolByAddress = new Map(Object.entries(deployment.assets).map(([s, a]) => [a.toLowerCase(), s]));
const reasonKeyOf = (n: number) => BLOCK_REASONS[n]?.key ?? null;

interface Base {
  txHash: Hex;
  blockNumber: number;
  timestamp: number | null;
  market: MarketKey | null;
}

export interface OfferMoment extends Base {
  id: number;
  name: string;
  agent: Address;
  underwriter: Address;
  bond: bigint;
  feeBps: number;
  /** The transaction called createOfferWithAuthorization: one USDG signature, one transaction. */
  withSignature: boolean;
}
export interface CoverMoment extends Base {
  account: Address;
  user: Address;
  limitBps: number;
  amount: bigint;
  fee: bigint;
  net: bigint;
  reserveAdded: bigint;
}
export interface DecisionMoment extends Base {
  account: Address;
  asset: string;
  isBuy: boolean;
  usd: number | null;
  reasonKey: string | null;
  detail: string | null;
  decision: string | null;
  parsed: Record<string, unknown> | null;
  matches: boolean | null;
}
/** The scripted gap's steps, from deployments/gap-demo.json, shown only when its settle tx is on this chain. */
export interface GapStory {
  fridayDrawdownBps: number | null;
  fridayValue: string | null;
  weekendSeconds: number | null;
  maxPriceAge: number | null;
  mondayDrawdownBps: number | null;
  settledBy: string | null;
}
export interface ClaimMoment extends Base {
  account: Address;
  user: Address;
  caller: Address;
  callerRole: string | null;
  /** value + loss: the principal at the settle. */
  principal: bigint;
  value: bigint;
  loss: bigint;
  limit: bigint;
  payout: bigint;
  scripted: boolean;
  story: GapStory | null;
}

export type Moments =
  | {
      ok: true;
      offer: OfferMoment | null;
      cover: CoverMoment | null;
      trade: DecisionMoment | null;
      refusal: DecisionMoment | null;
      claim: ClaimMoment | null;
      claims: number;
      outside: { underwriters: number; buyers: number };
    }
  | { ok: false; error: string };

async function chunkedLogs<T>(fetch: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  const ranges: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += CHUNK) ranges.push([s, s + CHUNK - 1n > to ? to : s + CHUNK - 1n]);
  return (await Promise.all(ranges.map(([a, b]) => fetch(a, b)))).flat();
}

const byPosition = (a: { blockNumber: bigint; logIndex: number }, b: { blockNumber: bigint; logIndex: number }) =>
  Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex;

export async function readMoments(): Promise<Moments> {
  const read = await getBook();
  if (!read.ok) return read;
  const { book, block } = read;
  try {
    const markets = MARKET_KEYS.map((k) => deployment.markets[k].address).filter((a): a is Address => Boolean(a));
    const starts = MARKET_KEYS.map((k) => deployment.markets[k].deployBlock).filter((b): b is number => b != null);
    const from = BigInt(Math.min(...starts));
    const to = block.number;
    const covers = book.offers.map((o) => o.cover);
    const accounts = book.offers.flatMap((o) => o.accounts.map((a) => a.address));
    const marketOfAddress = new Map<string, MarketKey>();
    for (const k of MARKET_KEYS) {
      const a = deployment.markets[k].address;
      if (a) marketOfAddress.set(a.toLowerCase(), k);
    }
    for (const o of book.offers) {
      marketOfAddress.set(o.cover.toLowerCase(), o.market);
      for (const a of o.accounts) marketOfAddress.set(a.address.toLowerCase(), o.market);
    }

    const [created, funded, opened, deposited, settled, traded, blocked] = await Promise.all([
      chunkedLogs((a, b) => publicClient.getLogs({ address: markets, event: ev.offerCreated, fromBlock: a, toBlock: b }), from, to),
      chunkedLogs((a, b) => publicClient.getLogs({ address: markets, event: ev.offerFunded, fromBlock: a, toBlock: b }), from, to),
      covers.length
        ? chunkedLogs((a, b) => publicClient.getLogs({ address: covers, event: ev.opened, fromBlock: a, toBlock: b }), from, to)
        : Promise.resolve([]),
      covers.length
        ? chunkedLogs((a, b) => publicClient.getLogs({ address: covers, event: ev.deposited, fromBlock: a, toBlock: b }), from, to)
        : Promise.resolve([]),
      covers.length
        ? chunkedLogs((a, b) => publicClient.getLogs({ address: covers, event: ev.settled, fromBlock: a, toBlock: b }), from, to)
        : Promise.resolve([]),
      accounts.length
        ? chunkedLogs((a, b) => publicClient.getLogs({ address: accounts, event: ev.traded, fromBlock: a, toBlock: b }), from, to)
        : Promise.resolve([]),
      accounts.length
        ? chunkedLogs((a, b) => publicClient.getLogs({ address: accounts, event: ev.blocked, fromBlock: a, toBlock: b }), from, to)
        : Promise.resolve([]),
    ]);
    const marketOf = (address: string) => marketOfAddress.get(address.toLowerCase()) ?? null;

    // 1. An offer created and funded in one transaction (prefer one made with a USDG signature).
    let offer: OfferMoment | null = null;
    const createdTx = new Map(created.map((l) => [l.transactionHash, l]));
    for (const f of [...funded].sort(byPosition)) {
      const c = createdTx.get(f.transactionHash);
      if (!c) continue;
      const tx = await publicClient.getTransaction({ hash: f.transactionHash });
      let withSignature = false;
      try {
        withSignature = decodeFunctionData({ abi: bondlineMarketAbi, data: tx.input }).functionName === "createOfferWithAuthorization";
      } catch {
        withSignature = false;
      }
      offer = {
        txHash: f.transactionHash,
        blockNumber: Number(f.blockNumber),
        timestamp: null,
        market: marketOf(f.address),
        id: Number(f.args.id),
        name: c.args.terms?.name ?? "",
        agent: getAddress(c.args.agent!),
        underwriter: getAddress(f.args.underwriter!),
        bond: f.args.bond ?? 0n,
        feeBps: Number(c.args.terms?.feeBps ?? 0),
        withSignature,
      };
      if (withSignature) break;
    }

    // 2. A cover bought: the first Opened, with the deposit in the same transaction.
    let cover: CoverMoment | null = null;
    const firstOpen = [...opened].sort(byPosition)[0];
    if (firstOpen) {
      const dep = deposited.find(
        (d) => d.transactionHash === firstOpen.transactionHash && d.args.account?.toLowerCase() === firstOpen.args.account?.toLowerCase(),
      );
      cover = {
        txHash: firstOpen.transactionHash,
        blockNumber: Number(firstOpen.blockNumber),
        timestamp: null,
        market: marketOf(firstOpen.address),
        account: getAddress(firstOpen.args.account!),
        user: getAddress(firstOpen.args.user!),
        limitBps: Number(firstOpen.args.limitBps),
        amount: dep?.args.amount ?? 0n,
        fee: dep?.args.fee ?? 0n,
        net: dep?.args.net ?? 0n,
        reserveAdded: dep?.args.reserveAdded ?? 0n,
      };
    }

    // 3 and 4. The latest trade and the latest refusal, with the decision decoded from the transaction input.
    const decisionMoment = async (
      l: (typeof traded)[number] | (typeof blocked)[number] | undefined,
      kind: "trade" | "refusal",
    ): Promise<DecisionMoment | null> => {
      if (!l) return null;
      const check = await verifyDecision(l.transactionHash, l.args.decisionHash!).catch(() => null);
      const reasonKey = kind === "refusal" ? reasonKeyOf(Number((l.args as { reason?: number }).reason)) : null;
      const a = l.args as { asset?: Address; isBuy?: boolean; usdAmount?: bigint; observed?: bigint; limit?: bigint };
      return {
        txHash: l.transactionHash,
        blockNumber: Number(l.blockNumber),
        timestamp: null,
        market: marketOf(l.address),
        account: getAddress(l.address),
        asset: symbolByAddress.get((a.asset ?? "").toLowerCase()) ?? a.asset ?? "",
        isBuy: Boolean(a.isBuy),
        usd: a.usdAmount == null || a.usdAmount === MAX_UINT ? null : Number(a.usdAmount) / 1e6,
        reasonKey,
        detail: reasonKey ? refusalDetail(reasonKey, a.observed, a.limit, Boolean(a.isBuy)) : null,
        decision: check?.decision ?? null,
        parsed: check?.parsed ?? null,
        matches: check?.decision == null ? null : check.matches,
      };
    };
    const [trade, refusal] = await Promise.all([
      decisionMoment([...traded].sort(byPosition).at(-1), "trade"),
      decisionMoment([...blocked].sort(byPosition).at(-1), "refusal"),
    ]);

    // 5. The claim paid: the scripted gap's settle if it happened on this chain, else the latest settle.
    const gap = await readGapDemo();
    const recordTx = gapSettleTx(gap);
    const scriptedTxs = new Set(
      [recordTx, (gapDemo as { settleTx?: string | null }).settleTx?.toLowerCase() ?? null].filter(
        (t): t is string => Boolean(t),
      ),
    );
    const sortedClaims = [...settled].sort(byPosition);
    const c = sortedClaims.find((l) => scriptedTxs.has(l.transactionHash.toLowerCase())) ?? sortedClaims.at(-1);
    const isRecord = Boolean(c && recordTx && c.transactionHash.toLowerCase() === recordTx);
    const claim: ClaimMoment | null = c
      ? {
          txHash: c.transactionHash,
          blockNumber: Number(c.blockNumber),
          timestamp: null,
          market: marketOf(c.address),
          account: getAddress(c.args.account!),
          user: getAddress(c.args.user!),
          caller: getAddress(c.args.caller!),
          callerRole: TEAM_WALLETS[c.args.caller!.toLowerCase()] ?? null,
          principal: (c.args.value ?? 0n) + (c.args.loss ?? 0n),
          value: c.args.value ?? 0n,
          loss: c.args.loss ?? 0n,
          limit: c.args.limit ?? 0n,
          payout: c.args.payout ?? 0n,
          scripted: scriptedTxs.has(c.transactionHash.toLowerCase()),
          story:
            isRecord && gap
              ? {
                  fridayDrawdownBps: gap.friday?.lossBps ?? gap.friday?.drawdownBps ?? null,
                  fridayValue: gap.friday?.valueAfter ?? null,
                  weekendSeconds: gap.weekend?.seconds ?? null,
                  maxPriceAge: gap.weekend?.marketMaxPriceAge ?? null,
                  mondayDrawdownBps: gap.monday?.drawdownBps ?? null,
                  settledBy: gap.settle?.settledBy ?? null,
                }
              : null,
        }
      : null;

    // Block times, once each.
    const all = [offer, cover, trade, refusal, claim].filter(Boolean) as Base[];
    const times = new Map<number, number>();
    await Promise.all(
      [...new Set(all.map((m) => m.blockNumber))].map(async (n) => {
        const b = await publicClient.getBlock({ blockNumber: BigInt(n) });
        times.set(n, Number(b.timestamp));
      }),
    );
    for (const m of all) m.timestamp = times.get(m.blockNumber) ?? null;

    return {
      ok: true,
      offer,
      cover,
      trade,
      refusal,
      claim,
      claims: settled.length,
      outside: { underwriters: book.totals.underwriters.outside, buyers: book.totals.buyers.outside },
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
