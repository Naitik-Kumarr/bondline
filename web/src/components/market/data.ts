// Server-side data for /market and /agent: the live book from the chain (lib/bondline/book.ts), the static agent
// records (shared/src/records, written by `npm run record`), and a few extra chain reads (feed prices, the stock
// share after every trade). Every number on those pages comes from here.
import "server-only";
import { cache } from "react";
import { getAddress, parseAbiItem, type Address } from "viem";
import {
  deployment,
  isTeamWallet,
  mirrorFeedAbi,
  PRICING_MODEL,
  RECORDS_INDEX,
  REFERENCE_LIMIT_BPS,
  referencePrices,
  sigmaOf,
  STOCK_SYMBOLS,
  TEAM_WALLETS,
  type AgentRecord,
  type MarketKey,
  type RecordSummary,
  type StockSymbol,
} from "@bondline/shared";
import { MARKET_KEYS, publicClient, readBook, type Book, type OfferView, type Totals } from "@/lib/bondline/book";
import { titleCase } from "./fmt";

export const errorMessage = (e: unknown) =>
  e instanceof Error ? (e as Error & { shortMessage?: string }).shortMessage || e.message : String(e);

// ------------------------------------------------------------------ the book, once per request

export type BookRead =
  | { ok: true; book: Book; block: { number: bigint; timestamp: number } }
  | { ok: false; error: string };

/** readBook() plus the block it was read at. Never throws: a failed read is a state the page shows. */
export const getBook = cache(async (): Promise<BookRead> => {
  try {
    const [book, block] = await Promise.all([readBook(), publicClient.getBlock({ blockTag: "latest" })]);
    return { ok: true, book, block: { number: block.number, timestamp: Number(block.timestamp) } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
});

// ------------------------------------------------------------------ agents

const indexByAgent = new Map(RECORDS_INDEX.agents.map((a) => [a.agent.toLowerCase(), a]));

export const summaryOf = (agent: string): RecordSummary | null => indexByAgent.get(agent.toLowerCase()) ?? null;

/** Team role of a wallet ("careful", "bold", "underwriter", ...), or null. */
export const roleOf = (address: string): string | null => TEAM_WALLETS[address.toLowerCase()] ?? null;

/** Careful, Bold, or the record's name; otherwise the first offer's name; otherwise a short address. */
export function agentName(agent: string, offers: Pick<OfferView, "terms">[] = []): string {
  const summary = summaryOf(agent);
  if (summary?.name) return summary.name;
  const role = roleOf(agent);
  if (role === "careful" || role === "bold") return titleCase(role);
  const named = offers.find((o) => o.terms.name?.trim());
  if (named) return named.terms.name.trim();
  return `Agent ${agent.slice(0, 6)}…${agent.slice(-4)}`;
}

/** The full record JSON for an agent, bundled at build time; null when the agent has none. */
export async function loadRecord(agent: string): Promise<AgentRecord | null> {
  const summary = summaryOf(agent);
  if (!summary) return null;
  try {
    const mod = await import(`../../../../shared/src/records/${summary.file}`);
    return (mod.default ?? mod) as AgentRecord;
  } catch {
    return null;
  }
}

export interface AgentPrices {
  limitBps: number;
  termDays: number;
  sigma: number;
  sigmaAsset: StockSymbol;
  /** w = the rules' maximum stock share. */
  worstCaseBps: number | null;
  worstCaseShare: number | null;
  /** w = the agent's observed exposure (p95). Null with no record. */
  recordBps: number | null;
  recordShare: number | null;
  /** Where the worst case came from. */
  source: "record" | "offer terms" | null;
}

/**
 * The two reference prices, at a 10% limit and 30 days as on the board. From the agent's record when it has one;
 * otherwise the reference price at the maximum stock share its offers' rules allow after a buy (offer terms), and no record price.
 */
export function agentPrices(agent: string, offers: Pick<OfferView, "terms">[]): AgentPrices {
  const s = summaryOf(agent);
  if (s && s.worstCaseBps != null) {
    return {
      limitBps: s.limitBps,
      termDays: s.termDays,
      sigma: s.sigma,
      sigmaAsset: s.sigmaAsset,
      worstCaseBps: s.worstCaseBps,
      worstCaseShare: s.rulesMax,
      recordBps: s.recordBps,
      recordShare: s.recordBps != null ? s.exposureP95 : null,
      source: "record",
    };
  }
  const sigma = sigmaOf(STOCK_SYMBOLS);
  const base = {
    limitBps: REFERENCE_LIMIT_BPS,
    termDays: PRICING_MODEL.termDays,
    sigma: sigma.sigma,
    sigmaAsset: sigma.symbol,
  };
  if (offers.length === 0) {
    return { ...base, worstCaseBps: null, worstCaseShare: null, recordBps: null, recordShare: null, source: null };
  }
  const maxStockShare = Math.max(...offers.map((o) => o.terms.maxStockBps)) / 10_000;
  const ref = referencePrices({
    maxStockShare,
    observedStockShare: null,
    sigma: sigma.sigma,
    limit: REFERENCE_LIMIT_BPS / 10_000,
  });
  return {
    ...base,
    worstCaseBps: ref.worstCase.bps.fair,
    worstCaseShare: maxStockShare,
    recordBps: null,
    recordShare: null,
    source: "offer terms",
  };
}

// ------------------------------------------------------------------ the stock share after every trade

const traded = parseAbiItem(
  "event Traded(address indexed asset, bool isBuy, uint256 usdAmount, uint256 amountIn, uint256 amountOut, uint256 price, uint256 valueAfter, uint256 stockValueAfter, bytes32 indexed decisionHash)",
);
const CHUNK = 50_000n;

export interface SharePoint {
  account: Address;
  blockNumber: number;
  logIndex: number;
  /** stockValueAfter ÷ valueAfter from the Traded event. */
  share: number;
}

/** Every trade's stock share for these accounts, oldest first. One getLogs per 50k blocks. */
export async function readShareSeries(accounts: Address[], toBlock?: bigint): Promise<SharePoint[]> {
  if (accounts.length === 0) return [];
  const starts = MARKET_KEYS.map((m) => deployment.markets[m].deployBlock).filter((b): b is number => b != null);
  if (starts.length === 0) return [];
  const from = BigInt(Math.min(...starts));
  const latest = toBlock ?? (await publicClient.getBlockNumber());
  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= latest; start += CHUNK) {
    ranges.push([start, start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n]);
  }
  const parts = await Promise.all(
    ranges.map(([fromBlock, to]) => publicClient.getLogs({ address: accounts, event: traded, fromBlock, toBlock: to })),
  );
  const out: SharePoint[] = [];
  for (const logs of parts) {
    for (const l of logs) {
      const value = l.args.valueAfter ?? 0n;
      if (value <= 0n) continue;
      out.push({
        account: getAddress(l.address),
        blockNumber: Number(l.blockNumber),
        logIndex: l.logIndex,
        share: Number(l.args.stockValueAfter ?? 0n) / Number(value),
      });
    }
  }
  return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

// ------------------------------------------------------------------ feed prices

export interface FeedPrice {
  symbol: StockSymbol;
  feed: Address;
  price: number | null;
  updatedAt: number | null;
}

/** The latest price on each market's feeds (8 decimals), one multicall. */
export const getFeedPrices = cache(async (): Promise<Record<MarketKey, FeedPrice[]>> => {
  const slots = MARKET_KEYS.flatMap((market) =>
    STOCK_SYMBOLS.flatMap((symbol) => {
      const feed = deployment.markets[market].feeds[symbol];
      return feed ? [{ market, symbol, feed }] : [];
    }),
  );
  const empty = { live: [], replay: [] } as Record<MarketKey, FeedPrice[]>;
  if (slots.length === 0) return empty;
  try {
    const res = await publicClient.multicall({
      allowFailure: true,
      contracts: slots.map((s) => ({ address: s.feed, abi: mirrorFeedAbi, functionName: "latestRoundData" }) as const),
    });
    slots.forEach((s, i) => {
      const r = res[i];
      const ok = r.status === "success" && r.result[1] > 0n;
      empty[s.market].push({
        symbol: s.symbol,
        feed: s.feed,
        price: ok ? Number(r.result[1]) / 1e8 : null,
        updatedAt: ok ? Number(r.result[3]) : null,
      });
    });
  } catch {
    // Prices are context, not the board: show none rather than fail the page.
  }
  return empty;
});

// ------------------------------------------------------------------ the board

export interface BoardAgent {
  agent: Address;
  name: string;
  team: boolean;
  summary: RecordSummary | null;
  prices: AgentPrices;
  /** Stock share after each trade, both markets, oldest first (at most the last 60). */
  series: number[];
}

export interface BoardMarket {
  key: MarketKey;
  maxPriceAge: number;
  prices: FeedPrice[];
  offers: OfferView[];
  /** Agents with offers in this market, ranked by score (no record last). */
  agents: { agent: BoardAgent; offers: OfferView[] }[];
  bond: bigint;
  free: bigint;
  covers: number;
}

export type Board =
  | {
      ok: true;
      deployed: boolean;
      block: { number: bigint; timestamp: number };
      totals: Totals;
      markets: BoardMarket[];
    }
  | { ok: false; error: string };

const byScore = (a: BoardAgent, b: BoardAgent) =>
  (b.summary?.score ?? -1) - (a.summary?.score ?? -1) || a.name.localeCompare(b.name);

export const getBoard = cache(async (): Promise<Board> => {
  const read = await getBook();
  if (!read.ok) return read;
  const { book, block } = read;
  const [prices, series] = await Promise.all([
    getFeedPrices(),
    readShareSeries(
      book.offers.flatMap((o) => o.accounts.map((a) => a.address)),
      block.number,
    ).catch(() => [] as SharePoint[]),
  ]);

  // Which agent each covered account trades for.
  const agentOfAccount = new Map<string, string>();
  for (const o of book.offers) for (const a of o.accounts) agentOfAccount.set(a.address.toLowerCase(), o.agent.toLowerCase());

  const agents = new Map<string, BoardAgent>();
  const agentFor = (address: Address): BoardAgent => {
    const key = address.toLowerCase();
    let a = agents.get(key);
    if (!a) {
      const offers = book.offers.filter((o) => o.agent.toLowerCase() === key);
      a = {
        agent: getAddress(address),
        name: agentName(address, offers),
        team: isTeamWallet(address),
        summary: summaryOf(address),
        prices: agentPrices(address, offers),
        series: series
          .filter((p) => agentOfAccount.get(p.account.toLowerCase()) === key)
          .map((p) => p.share)
          .slice(-60),
      };
      agents.set(key, a);
    }
    return a;
  };

  const markets: BoardMarket[] = MARKET_KEYS.map((key) => {
    const offers = book.offers.filter((o) => o.market === key);
    const groups = new Map<string, { agent: BoardAgent; offers: OfferView[] }>();
    for (const o of offers) {
      const k = o.agent.toLowerCase();
      const g = groups.get(k) ?? { agent: agentFor(o.agent), offers: [] };
      g.offers.push(o);
      groups.set(k, g);
    }
    return {
      key,
      maxPriceAge: deployment.markets[key].maxPriceAge,
      prices: prices[key],
      offers,
      agents: [...groups.values()].sort((a, b) => byScore(a.agent, b.agent)),
      bond: offers.reduce((s, o) => s + o.bond, 0n),
      free: offers.reduce((s, o) => s + o.free, 0n),
      covers: offers.reduce((s, o) => s + o.accounts.length, 0),
    };
  });

  return { ok: true, deployed: book.deployed, block, totals: book.totals, markets };
});
