import type { Address, Hex } from "viem";
import { BLOCK_REASONS, STOCK_SYMBOLS, type StockSymbol } from "./constants.ts";
import type { MarketKey } from "./deployment.ts";
import { PRICING_LABEL, PRICING_MODEL, referencePrices, VOLATILITY, type PriceBreakdown } from "./pricing.ts";
import rawIndex from "./records/index.json" with { type: "json" };

/**
 * An agent's public record, rebuilt from chain events on both markets: trades and refusals, time active, exposure,
 * the worst drawdown of its covered accounts against their limits, claims, a 0–100 display score and two reference
 * prices. Pure: scripts/record.ts fetches the events, this file does the arithmetic. See docs/PRICING.md.
 */

// ------------------------------------------------------------------ events in

/** Where an event sits on chain. Events are processed in (blockNumber, logIndex) order. */
export interface EventRef {
  market: MarketKey;
  blockNumber: number;
  logIndex: number;
  txHash: Hex;
  /** Block time in unix seconds, when known. */
  timestamp?: number;
}

export interface OfferTerms {
  minLimitBps: number;
  maxLimitBps: number;
  feeBps: number;
  maxStockBps: number;
  name: string;
}

export interface AccountRules {
  assetMask: number;
  maxStockBps: number;
  maxTradeBps: number;
  maxDailyBps: number;
  maxSlippageBps: number;
  maxPriceAge: number;
}

/** BondlineMarket.OfferCreated */
export interface OfferCreatedEvent extends EventRef {
  type: "OfferCreated";
  id: number;
  cover: Address;
  underwriter: Address;
  agent: Address;
  terms: OfferTerms;
}
/** BondlineCover.Opened */
export interface OpenedEvent extends EventRef {
  type: "Opened";
  cover: Address;
  account: Address;
  user: Address;
  limitBps: number;
  rules: AccountRules;
}
/** BondlineCover.Deposited (USDG amounts, 6 decimals) */
export interface DepositedEvent extends EventRef {
  type: "Deposited";
  cover: Address;
  account: Address;
  from: Address;
  amount: bigint;
  fee: bigint;
  net: bigint;
  reserveAdded: bigint;
}
/** BondlineCover.Withdrawn */
export interface WithdrawnEvent extends EventRef {
  type: "Withdrawn";
  cover: Address;
  account: Address;
  user: Address;
  amount: bigint;
  principal: bigint;
  reserve: bigint;
}
/** BondlineCover.Settled: a claim paid. */
export interface SettledEvent extends EventRef {
  type: "Settled";
  cover: Address;
  account: Address;
  user: Address;
  caller: Address;
  value: bigint;
  loss: bigint;
  limit: bigint;
  payout: bigint;
}
/** BondlineCover.Closed */
export interface ClosedEvent extends EventRef {
  type: "Closed";
  cover: Address;
  account: Address;
  user: Address;
}
/** AgentAccount.Traded. Buy: amountIn is USDG, amountOut stock (18 decimals). Sell: the reverse. Price: 8 decimals. */
export interface TradedEvent extends EventRef {
  type: "Traded";
  account: Address;
  asset: Address;
  isBuy: boolean;
  usdAmount: bigint;
  amountIn: bigint;
  amountOut: bigint;
  price: bigint;
  valueAfter: bigint;
  stockValueAfter: bigint;
  decisionHash: Hex;
}
/** AgentAccount.Blocked: a refusal. Nothing changed. */
export interface BlockedEvent extends EventRef {
  type: "Blocked";
  account: Address;
  asset: Address;
  isBuy: boolean;
  usdAmount: bigint;
  reason: number;
  observed: bigint;
  limit: bigint;
  decisionHash: Hex;
}
/** MirrorFeed.AnswerUpdated on one of the market's feeds, tagged with the asset it prices. */
export interface AnswerUpdatedEvent extends EventRef {
  type: "AnswerUpdated";
  feed: Address;
  asset: Address;
  answer: bigint;
  roundId: bigint;
  updatedAt: number;
}

export type RecordEvent =
  | OfferCreatedEvent
  | OpenedEvent
  | DepositedEvent
  | WithdrawnEvent
  | SettledEvent
  | ClosedEvent
  | TradedEvent
  | BlockedEvent
  | AnswerUpdatedEvent;

/** A market's assets in order: bit i of an account's assetMask is asset i. */
export type MarketAssets = Partial<Record<MarketKey, readonly { address: Address; symbol: StockSymbol }[]>>;

export interface RecordInput {
  agent: Address;
  name?: string | null;
  chainId: number;
  events: readonly RecordEvent[];
  marketAssets: MarketAssets;
  /** Where the events were read from, for provenance. */
  markets?: { key: MarketKey; label: string; address: Address; fromBlock: number; toBlock: number }[];
  /** Annual σ per stock. Defaults to volatility.json. */
  sigma?: Partial<Record<StockSymbol, number>>;
  generatedAt?: string;
  /** The limit the two reference prices are quoted at. Defaults to 10%. */
  referenceLimitBps?: number;
  /** Defaults to 30 days, as on the board. */
  termDays?: number;
  /** How many of the latest trades and refusals to list. Defaults to 20. */
  recentLimit?: number;
}

// ------------------------------------------------------------------ record out (JSON-safe: no bigints)

export interface PriceView {
  stockShare: number;
  pTouchBps: number;
  gapBps: number;
  riskBps: number;
  reserveBps: number;
  fairBps: number;
}

export interface ScorePart {
  key: "exposure" | "drawdown" | "claims" | "history";
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface Score {
  /** 0–100, or null with no record. */
  value: number | null;
  label: string;
  parts: ScorePart[];
  formula: string;
}

export interface RecentAction {
  type: "trade" | "refusal";
  market: MarketKey;
  account: Address;
  txHash: Hex;
  blockNumber: number;
  logIndex: number;
  timestamp: number | null;
  asset: string;
  side: "buy" | "sell";
  /** USDG value of the trade; null when the agent asked to sell everything (usdAmount = type(uint256).max). */
  usd: number | null;
  reason: { code: number; key: string; label: string } | null;
  decisionHash: Hex;
  /** The AI's decision JSON from the transaction input; filled in by scripts/record.ts. */
  decision?: string | null;
  /** keccak256(decision) equals the event's decisionHash. */
  decisionVerified?: boolean | null;
}

export interface AccountView {
  market: MarketKey;
  cover: Address;
  account: Address;
  user: Address;
  limitBps: number;
  maxStockBps: number;
  assets: string[];
  status: "active" | "settled" | "closed";
  openedAt: number | null;
  principalUsd: number;
  depositedUsd: number;
  withdrawnUsd: number;
  trades: number;
  refusals: number;
  exposureP95: number | null;
  worstDrawdown: number;
  worstDrawdownToLimit: number;
}

export interface ClaimView {
  market: MarketKey;
  cover: Address;
  account: Address;
  user: Address;
  caller: Address;
  valueUsd: number;
  lossUsd: number;
  limitUsd: number;
  payoutUsd: number;
  drawdown: number | null;
  txHash: Hex;
  timestamp: number | null;
}

export interface AgentRecord {
  version: 1;
  agent: Address;
  name: string | null;
  generatedAt: string;
  chainId: number;
  markets: { key: MarketKey; label: string; address: Address; fromBlock: number; toBlock: number }[];
  hasRecord: boolean;
  offers: ({ market: MarketKey; id: number; cover: Address; underwriter: Address; txHash: Hex } & OfferTerms)[];
  accounts: AccountView[];
  activity: {
    trades: number;
    buys: number;
    sells: number;
    volumeUsd: number;
    tradesByAsset: Record<string, number>;
    refusals: number;
    refusalsByReason: { code: number; key: string; label: string; count: number }[];
    decisions: number;
    firstActionAt: number | null;
    lastActionAt: number | null;
    activeSeconds: number | null;
  };
  exposure: {
    p95: number | null;
    max: number | null;
    observations: number;
    fromTrades: number;
    fromPriceUpdates: number;
    rulesMax: number | null;
    rulesMaxSource: "account rules" | "offer terms" | null;
    method: string;
  };
  drawdown: {
    worst: number | null;
    worstToLimit: number | null;
    account: Address | null;
    limitBps: number | null;
  };
  claims: { count: number; paidUsd: number; list: ClaimView[] };
  score: Score;
  prices: {
    label: string;
    limitBps: number;
    termDays: number;
    sigma: { asset: StockSymbol; value: number; source: string };
    worstCase: PriceView | null;
    record: PriceView | null;
    recordSavingBps: number | null;
  };
  recent: RecentAction[];
}

export interface RecordSummary {
  agent: Address;
  name: string | null;
  file: string;
  generatedAt: string;
  hasRecord: boolean;
  score: number | null;
  trades: number;
  refusals: number;
  claims: number;
  exposureP95: number | null;
  rulesMax: number | null;
  limitBps: number;
  termDays: number;
  sigma: number;
  sigmaAsset: StockSymbol;
  worstCaseBps: number | null;
  recordBps: number | null;
}

export interface RecordsIndex {
  version: 1;
  generatedAt: string | null;
  chainId: number;
  note?: string;
  agents: RecordSummary[];
}

/** shared/src/records/index.json: one summary per agent; the full record is in records/<address>.json. */
export const RECORDS_INDEX = rawIndex as unknown as RecordsIndex;

// ------------------------------------------------------------------ the formula

/** The 0–100 display score: points per part, summed and rounded. See docs/PRICING.md. */
export const SCORE_POINTS = { exposure: 40, drawdown: 30, claims: 10, history: 20 } as const;
/** On-chain decisions (trades + refusals) for full history credit. */
export const HISTORY_FULL_CREDIT = 100;
export const EXPOSURE_PERCENTILE = 0.95;
export const REFERENCE_LIMIT_BPS = 1000;

export const SCORE_FORMULA =
  "score = 40 × (1 − p95 exposure ÷ rules' max stock share) + 30 × (1 − worst drawdown ÷ its limit) " +
  "+ 10 × (1 − accounts with a claim ÷ accounts) + 20 × min(1, on-chain decisions ÷ 100); each part clamped to " +
  "its range, the sum rounded. No trades: no record.";

export const EXPOSURE_METHOD =
  "Share of account value in stocks. One observation after every trade (stockValueAfter ÷ valueAfter from the " +
  "Traded event), and one for every active covered account at every price update on its market (holdings implied " +
  "by its trades, valued at the new price; cash from deposits, withdrawals and trades). 95th percentile, nearest rank.";

/** Nearest-rank percentile: the smallest value with at least p of the observations at or below it. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!(p > 0 && p <= 1)) throw new RangeError(`p must be in (0, 1], got ${p}`);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length - 1e-9));
  return sorted[rank - 1];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export interface ScoreInput {
  trades: number;
  refusals: number;
  /** p95 share of account value in stocks, 0–1. */
  exposureP95: number | null;
  /** The rules' maximum stock share, 0–1. */
  rulesMax: number | null;
  /** Worst drawdown ÷ that account's limit (1 = reached the limit). */
  worstDrawdownToLimit: number | null;
  worstDrawdown?: number | null;
  worstLimitBps?: number | null;
  accounts: number;
  claimedAccounts: number;
}

export function scoreRecord(s: ScoreInput): Score {
  if (s.trades === 0) {
    return { value: null, label: "no record", parts: [], formula: SCORE_FORMULA };
  }
  const exposureRatio = s.rulesMax && s.rulesMax > 0 ? (s.exposureP95 ?? 0) / s.rulesMax : 0;
  const ddRatio = s.worstDrawdownToLimit ?? 0;
  const claimRatio = s.accounts > 0 ? s.claimedAccounts / s.accounts : 0;
  const decisions = s.trades + s.refusals;

  const parts: ScorePart[] = [
    {
      key: "exposure",
      label: "Exposure against its rules",
      max: SCORE_POINTS.exposure,
      points: SCORE_POINTS.exposure * clamp01(1 - exposureRatio),
      detail:
        s.rulesMax && s.rulesMax > 0
          ? `p95 stock share ${pct(s.exposureP95 ?? 0)} of a ${pct(s.rulesMax)} maximum`
          : "no stock-share rule seen",
    },
    {
      key: "drawdown",
      label: "Worst drawdown against its limit",
      max: SCORE_POINTS.drawdown,
      points: SCORE_POINTS.drawdown * clamp01(1 - ddRatio),
      detail:
        s.worstDrawdown != null && s.worstLimitBps != null
          ? `worst drawdown ${pct(s.worstDrawdown)} against a ${pct(s.worstLimitBps / 10_000)} limit`
          : `worst drawdown ${pct(ddRatio)} of its limit`,
    },
    {
      key: "claims",
      label: "Claims",
      max: SCORE_POINTS.claims,
      points: SCORE_POINTS.claims * clamp01(1 - claimRatio),
      detail: `${s.claimedAccounts} of ${s.accounts} covered account${s.accounts === 1 ? "" : "s"} paid a claim`,
    },
    {
      key: "history",
      label: "Amount of history",
      max: SCORE_POINTS.history,
      points: SCORE_POINTS.history * Math.min(1, decisions / HISTORY_FULL_CREDIT),
      detail: `${decisions} on-chain decision${decisions === 1 ? "" : "s"}; ${HISTORY_FULL_CREDIT} for full credit`,
    },
  ];
  for (const p of parts) p.points = Math.round(p.points * 100) / 100;
  const value = Math.round(parts.reduce((sum, p) => sum + p.points, 0));
  return { value, label: `${value} / 100`, parts, formula: SCORE_FORMULA };
}

// ------------------------------------------------------------------ building a record

const ZERO = BigInt(0);
/** Stock units (18 decimals) × price (8 decimals) ÷ 1e20 = USDG units (6 decimals), as PriceMath.usdForStock. */
const PRICE_SCALE = BigInt("100000000000000000000");
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const usd = (units: bigint) => Number(units) / 1e6;
const lower = (a: string) => a.toLowerCase();
const key = (market: MarketKey, address: string) => `${market}:${lower(address)}`;

interface AccountState {
  market: MarketKey;
  cover: Address;
  account: Address;
  user: Address;
  limitBps: number;
  rules: AccountRules;
  openedAt: number | null;
  status: "active" | "settled" | "closed";
  principal: bigint;
  cash: bigint;
  deposited: bigint;
  withdrawn: bigint;
  holdings: Map<string, bigint>;
  trades: number;
  refusals: number;
  shares: number[];
  worstDrawdown: number;
}

function symbolOf(marketAssets: MarketAssets, market: MarketKey, asset: string): string {
  const hit = marketAssets[market]?.find((a) => lower(a.address) === lower(asset));
  return hit ? hit.symbol : asset;
}

function allowedSymbols(marketAssets: MarketAssets, market: MarketKey, mask: number): StockSymbol[] {
  const list = marketAssets[market] ?? [];
  return list.filter((_, i) => (mask & (1 << i)) !== 0).map((a) => a.symbol);
}

const priceView = (b: PriceBreakdown): PriceView => ({
  stockShare: b.inputs.stockShare,
  pTouchBps: b.bps.pTouch,
  gapBps: b.bps.gap,
  riskBps: b.bps.riskPart,
  reserveBps: b.bps.reservePart,
  fairBps: b.bps.fair,
});

export function buildRecord(input: RecordInput): AgentRecord {
  const agent = lower(input.agent);
  const sigmaTable = { ...VOLATILITY.sigma, ...(input.sigma ?? {}) } as Record<StockSymbol, number>;
  const limitBps = input.referenceLimitBps ?? REFERENCE_LIMIT_BPS;
  const termDays = input.termDays ?? PRICING_MODEL.termDays;
  const recentLimit = input.recentLimit ?? 20;

  const events = [...input.events].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  const offers: AgentRecord["offers"] = [];
  const covers = new Set<string>();
  const accounts = new Map<string, AccountState>();
  const prices = new Map<string, bigint>();
  const claims: ClaimView[] = [];
  const refusalsByReason = new Map<number, number>();
  const tradesByAsset: Record<string, number> = {};
  const actions: (TradedEvent | BlockedEvent)[] = [];
  const shares: number[] = [];
  let fromTrades = 0;
  let fromPriceUpdates = 0;
  let buys = 0;
  let sells = 0;
  let volume = ZERO;

  const observeDrawdown = (a: AccountState, value: bigint) => {
    if (a.principal <= ZERO) return;
    const dd = Math.max(0, Number(a.principal - value) / Number(a.principal));
    if (dd > a.worstDrawdown) a.worstDrawdown = dd;
  };

  const revalue = (a: AccountState): { value: bigint; stockValue: bigint } | null => {
    let stockValue = ZERO;
    for (const [asset, amount] of a.holdings) {
      if (amount <= ZERO) continue;
      const price = prices.get(key(a.market, asset));
      if (price === undefined || price <= ZERO) return null;
      stockValue += (amount * price) / PRICE_SCALE;
    }
    return { value: a.cash + stockValue, stockValue };
  };

  for (const ev of events) {
    switch (ev.type) {
      case "OfferCreated": {
        if (lower(ev.agent) !== agent) break;
        covers.add(key(ev.market, ev.cover));
        offers.push({ market: ev.market, id: ev.id, cover: ev.cover, underwriter: ev.underwriter, txHash: ev.txHash, ...ev.terms });
        break;
      }
      case "Opened": {
        if (!covers.has(key(ev.market, ev.cover))) break;
        accounts.set(key(ev.market, ev.account), {
          market: ev.market,
          cover: ev.cover,
          account: ev.account,
          user: ev.user,
          limitBps: ev.limitBps,
          rules: ev.rules,
          openedAt: ev.timestamp ?? null,
          status: "active",
          principal: ZERO,
          cash: ZERO,
          deposited: ZERO,
          withdrawn: ZERO,
          holdings: new Map(),
          trades: 0,
          refusals: 0,
          shares: [],
          worstDrawdown: 0,
        });
        break;
      }
      case "Deposited": {
        const a = accounts.get(key(ev.market, ev.account));
        if (!a) break;
        a.principal += ev.net;
        a.cash += ev.net;
        a.deposited += ev.amount;
        break;
      }
      case "Withdrawn": {
        const a = accounts.get(key(ev.market, ev.account));
        if (!a) break;
        a.cash -= ev.amount;
        a.principal = ev.principal;
        a.withdrawn += ev.amount;
        break;
      }
      case "Traded": {
        const a = accounts.get(key(ev.market, ev.account));
        if (!a) break;
        const asset = lower(ev.asset);
        const held = a.holdings.get(asset) ?? ZERO;
        if (ev.isBuy) {
          a.holdings.set(asset, held + ev.amountOut);
          a.cash -= ev.amountIn;
          buys++;
        } else {
          a.holdings.set(asset, held - ev.amountIn);
          a.cash += ev.amountOut;
          sells++;
        }
        prices.set(key(ev.market, asset), ev.price);
        a.trades++;
        volume += ev.usdAmount;
        const symbol = symbolOf(input.marketAssets, ev.market, ev.asset);
        tradesByAsset[symbol] = (tradesByAsset[symbol] ?? 0) + 1;
        actions.push(ev);
        if (ev.valueAfter > ZERO) {
          const share = Number(ev.stockValueAfter) / Number(ev.valueAfter);
          a.shares.push(share);
          shares.push(share);
          fromTrades++;
        }
        observeDrawdown(a, ev.valueAfter);
        break;
      }
      case "Blocked": {
        const a = accounts.get(key(ev.market, ev.account));
        if (!a) break;
        a.refusals++;
        refusalsByReason.set(ev.reason, (refusalsByReason.get(ev.reason) ?? 0) + 1);
        actions.push(ev);
        break;
      }
      case "AnswerUpdated": {
        prices.set(key(ev.market, ev.asset), ev.answer);
        for (const a of accounts.values()) {
          if (a.market !== ev.market || a.status !== "active" || a.principal <= ZERO) continue;
          const v = revalue(a);
          if (!v || v.value <= ZERO) continue;
          const share = Number(v.stockValue) / Number(v.value);
          a.shares.push(share);
          shares.push(share);
          fromPriceUpdates++;
          observeDrawdown(a, v.value);
        }
        break;
      }
      case "Settled": {
        const a = accounts.get(key(ev.market, ev.account));
        if (!a) break;
        observeDrawdown(a, ev.value);
        a.status = "settled";
        claims.push({
          market: ev.market,
          cover: ev.cover,
          account: ev.account,
          user: ev.user,
          caller: ev.caller,
          valueUsd: usd(ev.value),
          lossUsd: usd(ev.loss),
          limitUsd: usd(ev.limit),
          payoutUsd: usd(ev.payout),
          drawdown: a.principal > ZERO ? Number(ev.loss) / Number(a.principal) : null,
          txHash: ev.txHash,
          timestamp: ev.timestamp ?? null,
        });
        break;
      }
      case "Closed": {
        const a = accounts.get(key(ev.market, ev.account));
        if (a) a.status = "closed";
        break;
      }
    }
  }

  // ---- aggregates
  const accountList = [...accounts.values()];
  const trades = buys + sells;
  const refusals = [...refusalsByReason.values()].reduce((s, n) => s + n, 0);
  const times = actions.map((a) => a.timestamp).filter((t): t is number => typeof t === "number");
  const firstActionAt = times.length ? Math.min(...times) : null;
  const lastActionAt = times.length ? Math.max(...times) : null;

  let rulesMax: number | null = null;
  let rulesMaxSource: AgentRecord["exposure"]["rulesMaxSource"] = null;
  if (accountList.length > 0) {
    rulesMax = Math.max(...accountList.map((a) => a.rules.maxStockBps)) / 10_000;
    rulesMaxSource = "account rules";
  } else if (offers.length > 0) {
    rulesMax = Math.max(...offers.map((o) => o.maxStockBps)) / 10_000;
    rulesMaxSource = "offer terms";
  }

  let worst: { a: AccountState; ratio: number } | null = null;
  for (const a of accountList) {
    const ratio = a.worstDrawdown / (a.limitBps / 10_000);
    if (!worst || ratio > worst.ratio) worst = { a, ratio };
  }

  const exposureP95 = percentile(shares, EXPOSURE_PERCENTILE);
  const claimedAccounts = new Set(claims.map((c) => key(c.market, c.account))).size;

  const score = scoreRecord({
    trades,
    refusals,
    exposureP95,
    rulesMax,
    worstDrawdownToLimit: worst?.ratio ?? null,
    worstDrawdown: worst?.a.worstDrawdown ?? null,
    worstLimitBps: worst?.a.limitBps ?? null,
    accounts: accountList.length,
    claimedAccounts,
  });

  // σ of the most volatile stock the agent may trade: from its accounts' rules, else its markets, else all.
  let symbols: StockSymbol[] = [];
  for (const a of accountList) symbols.push(...allowedSymbols(input.marketAssets, a.market, a.rules.assetMask));
  if (symbols.length === 0) {
    for (const o of offers) symbols.push(...(input.marketAssets[o.market] ?? []).map((x) => x.symbol));
  }
  if (symbols.length === 0) symbols = [...STOCK_SYMBOLS];
  let sigma = { asset: symbols[0], value: -1 };
  for (const s of new Set(symbols)) {
    const v = sigmaTable[s];
    if (typeof v === "number" && v > sigma.value) sigma = { asset: s, value: v };
  }
  if (sigma.value < 0) throw new Error(`no σ for ${symbols.join(", ")}`);
  const vol = VOLATILITY.assets[sigma.asset];
  const sigmaSource =
    input.sigma?.[sigma.asset] !== undefined
      ? "given"
      : `Chainlink ${sigma.asset}/USD on Robinhood Chain mainnet, ${vol.window.from} to ${vol.window.to} ` +
        `(${vol.window.returns} daily returns, annualised with √252)`;

  const hasRecord = trades > 0;
  const ref =
    rulesMax !== null
      ? referencePrices({
          maxStockShare: rulesMax,
          observedStockShare: hasRecord ? exposureP95 : null,
          sigma: sigma.value,
          limit: limitBps / 10_000,
          termDays,
        })
      : null;

  const recent: RecentAction[] = actions
    .slice(-recentLimit)
    .reverse()
    .map((ev) => {
      const reason =
        ev.type === "Blocked"
          ? { code: ev.reason, key: BLOCK_REASONS[ev.reason]?.key ?? `Reason${ev.reason}`, label: BLOCK_REASONS[ev.reason]?.label ?? "Unknown reason" }
          : null;
      return {
        type: ev.type === "Traded" ? "trade" : "refusal",
        market: ev.market,
        account: ev.account,
        txHash: ev.txHash,
        blockNumber: ev.blockNumber,
        logIndex: ev.logIndex,
        timestamp: ev.timestamp ?? null,
        asset: symbolOf(input.marketAssets, ev.market, ev.asset),
        side: ev.isBuy ? "buy" : "sell",
        usd: ev.usdAmount === MAX_UINT256 ? null : usd(ev.usdAmount),
        reason,
        decisionHash: ev.decisionHash,
      } satisfies RecentAction;
    });

  return {
    version: 1,
    agent: input.agent,
    name: input.name ?? null,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    chainId: input.chainId,
    markets: input.markets ?? [],
    hasRecord,
    offers,
    accounts: accountList.map((a) => ({
      market: a.market,
      cover: a.cover,
      account: a.account,
      user: a.user,
      limitBps: a.limitBps,
      maxStockBps: a.rules.maxStockBps,
      assets: allowedSymbols(input.marketAssets, a.market, a.rules.assetMask),
      status: a.status,
      openedAt: a.openedAt,
      principalUsd: usd(a.principal),
      depositedUsd: usd(a.deposited),
      withdrawnUsd: usd(a.withdrawn),
      trades: a.trades,
      refusals: a.refusals,
      exposureP95: percentile(a.shares, EXPOSURE_PERCENTILE),
      worstDrawdown: a.worstDrawdown,
      worstDrawdownToLimit: a.worstDrawdown / (a.limitBps / 10_000),
    })),
    activity: {
      trades,
      buys,
      sells,
      volumeUsd: usd(volume),
      tradesByAsset,
      refusals,
      refusalsByReason: [...refusalsByReason.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([code, count]) => ({
          code,
          key: BLOCK_REASONS[code]?.key ?? `Reason${code}`,
          label: BLOCK_REASONS[code]?.label ?? "Unknown reason",
          count,
        })),
      decisions: trades + refusals,
      firstActionAt,
      lastActionAt,
      activeSeconds: firstActionAt !== null && lastActionAt !== null ? lastActionAt - firstActionAt : null,
    },
    exposure: {
      p95: exposureP95,
      max: shares.length ? Math.max(...shares) : null,
      observations: shares.length,
      fromTrades,
      fromPriceUpdates,
      rulesMax,
      rulesMaxSource,
      method: EXPOSURE_METHOD,
    },
    drawdown: {
      worst: worst ? worst.a.worstDrawdown : null,
      worstToLimit: worst ? worst.ratio : null,
      account: worst ? worst.a.account : null,
      limitBps: worst ? worst.a.limitBps : null,
    },
    claims: { count: claims.length, paidUsd: claims.reduce((s, c) => s + c.payoutUsd, 0), list: claims },
    score,
    prices: {
      label: PRICING_LABEL,
      limitBps,
      termDays,
      sigma: { asset: sigma.asset, value: sigma.value, source: sigmaSource },
      worstCase: ref ? priceView(ref.worstCase) : null,
      record: ref?.record ? priceView(ref.record) : null,
      recordSavingBps: ref?.recordSaving != null ? ref.recordSaving * 10_000 : null,
    },
    recent,
  };
}

// ------------------------------------------------------------------ the index

export const recordFileName = (agent: string) => `${lower(agent)}.json`;

export function recordSummary(r: AgentRecord): RecordSummary {
  return {
    agent: r.agent,
    name: r.name,
    file: recordFileName(r.agent),
    generatedAt: r.generatedAt,
    hasRecord: r.hasRecord,
    score: r.score.value,
    trades: r.activity.trades,
    refusals: r.activity.refusals,
    claims: r.claims.count,
    exposureP95: r.exposure.p95,
    rulesMax: r.exposure.rulesMax,
    limitBps: r.prices.limitBps,
    termDays: r.prices.termDays,
    sigma: r.prices.sigma.value,
    sigmaAsset: r.prices.sigma.asset,
    worstCaseBps: r.prices.worstCase?.fairBps ?? null,
    recordBps: r.prices.record?.fairBps ?? null,
  };
}

/** Adds or replaces one agent's summary. Agents are ranked by score, highest first; no record goes last. */
export function upsertIndex(index: RecordsIndex, summary: RecordSummary, generatedAt: string): RecordsIndex {
  const agents = index.agents.filter((a) => lower(a.agent) !== lower(summary.agent));
  agents.push(summary);
  agents.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || lower(a.agent).localeCompare(lower(b.agent)));
  return { version: 1, generatedAt, chainId: index.chainId, note: index.note, agents };
}
