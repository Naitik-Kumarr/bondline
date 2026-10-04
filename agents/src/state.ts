// What an agent sees before it decides: its covered accounts, their value, holdings, rules, loss against the limit,
// and recent prices from the market's feeds. All of it is read from the chain.
import { erc20Abi, type Address, type PublicClient } from "viem";
import { agentAccountAbi, bondlineCoverAbi, bondlineMarketAbi, COVER_STATUS, mirrorFeedAbi, type MarketKey, type StockSymbol } from "@bondline/shared";
import { nowSec, replayTimeAt, type MarketInfo, type NetConfig } from "./config.ts";

export const ACTIVE = COVER_STATUS.indexOf("Active");
const PRICE_SCALE = 10n ** 20n; // stock (18 dec) x price (8 dec) / 1e20 = USDG (6 dec)
const BPS = 10_000n;

export const usdForStock = (amount: bigint, price: bigint) => (amount * price) / PRICE_SCALE;
export const stockForUsdUp = (usd: bigint, price: bigint) => (usd * PRICE_SCALE + price - 1n) / price;

export interface Rules {
  assetMask: number;
  maxStockBps: number;
  maxTradeBps: number;
  maxDailyBps: number;
  maxSlippageBps: number;
  maxPriceAge: number;
}

export interface FeedNow {
  symbol: StockSymbol;
  feed: Address;
  roundId: bigint;
  answer: bigint;
  updatedAt: number;
  age: number;
}

export interface Holding {
  symbol: StockSymbol;
  token: Address;
  balance: bigint;
  value: bigint;
  price: bigint;
  allowed: boolean;
}

export interface AccountState {
  marketKey: MarketKey;
  market: MarketInfo;
  cover: Address;
  account: Address;
  status: number;
  paused: boolean;
  stopped: boolean;
  rules: Rules;
  value: bigint;
  cash: bigint;
  stockValue: bigint;
  stockBps: number;
  holdings: Holding[];
  principal: bigint;
  loss: bigint;
  limit: bigint;
  limitBps: number;
  dayVolume: bigint;
  feeds: FeedNow[];
  /** The oldest price age this account's trades accept right now: min(market, rules). */
  maxAge: number;
  fresh: boolean;
  /** The reference "now" for price ages: max(wall clock, latest block time). */
  now: number;
  limits: { maxBuy: bigint; maxSell: Record<StockSymbol, bigint>; maxTrade: bigint; dailyLeft: bigint; stockRoom: bigint };
}

/** Accounts covered by offers behind `agent` in one market. Account lists only grow, so they are cached. */
export class AccountBook {
  private covers = new Map<Address, Address[]>();
  constructor(private readonly client: PublicClient) {}

  async accountsFor(market: MarketInfo, agent: Address): Promise<{ cover: Address; account: Address }[]> {
    const offers = await this.client.readContract({ address: market.address, abi: bondlineMarketAbi, functionName: "offers" });
    const out: { cover: Address; account: Address }[] = [];
    for (const o of offers) {
      if (o.agent.toLowerCase() !== agent.toLowerCase()) continue;
      const list = this.covers.get(o.cover) ?? [];
      const count = Number(await this.client.readContract({ address: o.cover, abi: bondlineCoverAbi, functionName: "accountCount" }));
      for (let i = list.length; i < count; i++) {
        list.push(await this.client.readContract({ address: o.cover, abi: bondlineCoverAbi, functionName: "accountAt", args: [BigInt(i)] }));
      }
      this.covers.set(o.cover, list);
      for (const account of list) out.push({ cover: o.cover, account });
    }
    return out;
  }
}

/** Recent rounds of each feed. Rounds never change once pushed, so they are cached by id. */
export class FeedHistory {
  private rounds = new Map<Address, Map<bigint, { answer: bigint; updatedAt: number }>>();
  constructor(
    private readonly client: PublicClient,
    private readonly depth: number,
  ) {}

  async update(feed: Address, latest: bigint): Promise<void> {
    const m = this.rounds.get(feed) ?? new Map<bigint, { answer: bigint; updatedAt: number }>();
    const from = latest > BigInt(this.depth) ? latest - BigInt(this.depth) + 1n : 1n;
    const missing: bigint[] = [];
    for (let id = from; id <= latest; id++) if (!m.has(id)) missing.push(id);
    for (let i = 0; i < missing.length; i += 6) {
      const chunk = missing.slice(i, i + 6);
      const res = await Promise.all(
        chunk.map((id) => this.client.readContract({ address: feed, abi: mirrorFeedAbi, functionName: "getRoundData", args: [id] })),
      );
      res.forEach(([, answer, , updatedAt], j) => m.set(chunk[j], { answer, updatedAt: Number(updatedAt) }));
    }
    for (const id of [...m.keys()]) if (id < from) m.delete(id);
    this.rounds.set(feed, m);
  }

  /** Price changes since `since`, oldest first: the first round of every run of equal answers. */
  changes(feed: Address, since = 0): { answer: bigint; updatedAt: number }[] {
    const m = this.rounds.get(feed);
    if (!m) return [];
    const sorted = [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, r]) => r)
      .filter((r) => r.updatedAt >= since);
    const out: { answer: bigint; updatedAt: number }[] = [];
    for (const r of sorted) if (!out.length || out[out.length - 1].answer !== r.answer) out.push(r);
    return out;
  }
}

/** Market time for a feed timestamp: replay time on the replay market, real time on the live market. */
export function marketTime(cfg: NetConfig, key: MarketKey, updatedAt: number): number {
  if (key === "live") return updatedAt;
  return replayTimeAt(cfg.replay, updatedAt) ?? updatedAt;
}

export async function readFeeds(client: PublicClient, market: MarketInfo, now: number): Promise<FeedNow[]> {
  return Promise.all(
    market.assets.map(async (a) => {
      const [roundId, answer, , updatedAt] = await client.readContract({ address: a.feed, abi: mirrorFeedAbi, functionName: "latestRoundData" });
      return { symbol: a.symbol, feed: a.feed, roundId: BigInt(roundId), answer, updatedAt: Number(updatedAt), age: now - Number(updatedAt) };
    }),
  );
}

export async function chainNow(client: PublicClient): Promise<number> {
  const block = await client.getBlock({ blockTag: "latest" });
  return Math.max(nowSec(), Number(block.timestamp));
}

export async function readAccount(
  client: PublicClient,
  market: MarketInfo,
  cover: Address,
  account: Address,
  feeds: FeedNow[],
  now: number,
  headroom: number,
  /** On the replay market: prices count only if pushed inside the current replay window [from, to). */
  window?: { from: number; to: number },
): Promise<AccountState> {
  const acc = { address: account, abi: agentAccountAbi } as const;
  const [pos, h, v, rulesRaw, paused, stopped, day, ...balances] = await Promise.all([
    client.readContract({ address: cover, abi: bondlineCoverAbi, functionName: "position", args: [account] }),
    client.readContract({ address: cover, abi: bondlineCoverAbi, functionName: "health", args: [account] }),
    client.readContract({ ...acc, functionName: "valuation" }),
    client.readContract({ ...acc, functionName: "rules" }),
    client.readContract({ ...acc, functionName: "paused" }),
    client.readContract({ ...acc, functionName: "stopped" }),
    client.readContract({ ...acc, functionName: "dayVolume" }),
    ...market.assets.map((a) => client.readContract({ address: a.address, abi: erc20Abi, functionName: "balanceOf", args: [account] })),
  ]);
  const rules: Rules = {
    assetMask: Number(rulesRaw.assetMask),
    maxStockBps: Number(rulesRaw.maxStockBps),
    maxTradeBps: Number(rulesRaw.maxTradeBps),
    maxDailyBps: Number(rulesRaw.maxDailyBps),
    maxSlippageBps: Number(rulesRaw.maxSlippageBps),
    maxPriceAge: Number(rulesRaw.maxPriceAge),
  };
  const holdings: Holding[] = market.assets.map((a, i) => {
    const price = feeds[i].answer;
    const balance = balances[i] as bigint;
    return { symbol: a.symbol, token: a.address, balance, price, value: price > 0n ? usdForStock(balance, price) : 0n, allowed: ((rules.assetMask >> a.index) & 1) === 1 };
  });
  const maxAge = Math.min(market.maxPriceAge, rules.maxPriceAge);
  const margin = Math.min(headroom, Math.floor(maxAge / 4));
  const fresh = feeds.every(
    (f) =>
      f.answer > 0n &&
      f.updatedAt > 0 &&
      f.age <= maxAge - margin &&
      (!window || (f.updatedAt >= window.from && f.updatedAt < window.to)),
  );

  // The largest trades the rules allow right now, with a 1% margin for prices moving before the trade lands.
  const value = v.value;
  const maxTrade = (value * BigInt(rules.maxTradeBps)) / BPS;
  const maxDaily = (value * BigInt(rules.maxDailyBps)) / BPS;
  const dailyLeft = maxDaily > day[1] ? maxDaily - day[1] : 0n;
  const cap = (value * BigInt(rules.maxStockBps)) / BPS;
  const stockRoom = cap > v.stockValue ? cap - v.stockValue : 0n;
  const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
  const shave = (x: bigint) => (x * 99n) / 100n;
  const maxBuy = shave(min(v.cash, maxTrade, dailyLeft, stockRoom));
  const maxSell = Object.fromEntries(holdings.map((hh) => [hh.symbol, shave(min(hh.value, maxTrade, dailyLeft))])) as Record<StockSymbol, bigint>;

  return {
    marketKey: market.key,
    market,
    cover,
    account,
    status: pos.status,
    paused,
    stopped,
    rules,
    value,
    cash: v.cash,
    stockValue: v.stockValue,
    stockBps: value > 0n ? Number((v.stockValue * BPS) / value) : 0,
    holdings,
    principal: pos.principal,
    loss: h.loss,
    limit: h.limit,
    limitBps: pos.limitBps,
    dayVolume: day[1],
    feeds,
    maxAge,
    fresh,
    now,
    limits: { maxBuy, maxSell, maxTrade, dailyLeft, stockRoom },
  };
}
