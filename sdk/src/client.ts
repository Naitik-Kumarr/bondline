// The Bondline SDK client. Reads the chain (offers, quotes, accounts, decisions) and builds unsigned transactions.
// It never holds a key and never sends a transaction: `publicClient` is read-only.
import {
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  maxUint256,
  parseEventLogs,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  agentAccountAbi,
  BLOCK_REASONS,
  bondlineCoverAbi,
  bondlineMarketAbi,
  CAP_BPS,
  COVER_STATUS,
  isTeamWallet,
  oracleVenueAbi,
  PRICING_LABEL,
  PRICING_MODEL,
  referencePrices,
  sigmaOf,
  type StockSymbol,
} from "@bondline/shared";
import { testnetConfig, type BondlineConfig, type MarketConfig } from "./config.ts";
import { loadRecord, type LoadedRecord } from "./records.ts";
import {
  buildCoverTransactions,
  buildCreateOfferTransaction,
  buildOfferAuthorization,
  buildTradeTransaction,
  CONTRACT_BOUNDS,
  validateRules,
  type OfferAuthorization,
  type RulesInput,
  type TermsInput,
  type UnsignedTransaction,
} from "./tx.ts";
import { parseBaseUnits, parseUsdg } from "./units.ts";
import { hashDecisionBytes, type EncodedDecision } from "./decision.ts";

const BPS = 10_000n;
const PRICE_SCALE = 10n ** 20n; // stock (18 dec) x price (8 dec) / 1e20 = USDG (6 dec)

export interface MarketInfo {
  key: string;
  label: string;
  address: Address;
  venue: Address;
  maxPriceAge: number;
  capBps: number;
  assets: { index: number; address: Address; symbol: string; feed: Address }[];
  offerCount: number;
}

export interface OfferView {
  market: string;
  marketAddress: Address;
  id: number;
  cover: Address;
  underwriter: Address;
  /** True for the team-operated test underwriter, so it can be left out of "outside" counts. */
  underwriterIsTeam: boolean;
  agent: Address;
  listed: boolean;
  name: string;
  terms: { minLimitBps: number; maxLimitBps: number; feeBps: number; maxStockBps: number };
  /** All USDG base units (6 decimals). `free` = bond - reserved: what can still back a new deposit. */
  bond: bigint;
  reserved: bigint;
  free: bigint;
  premiums: bigint;
  claimsPaid: bigint;
  accounts: number;
}

export interface OfferFilter {
  market?: string;
  agent?: Address;
  underwriter?: Address;
  /** Only offers that still accept covers. */
  listedOnly?: boolean;
}

export interface CoverQuote {
  ok: boolean;
  /** Everything the contract would refuse, or that you should know. Empty when ok. */
  problems: string[];
  market: string;
  offerId: number;
  cover: Address;
  agent: Address;
  listed: boolean;
  /** USDG base units. */
  amount: bigint;
  /** Premium: taken from the deposit, paid to the offer's bond. */
  premium: bigint;
  /** What the account receives and what the loss limit applies to. */
  principal: bigint;
  /** principal x limit, rounded up: the loss the user carries before the bond pays. */
  limitAmount: bigint;
  /** The bond this deposit locks, and the most `settle` can ever pay on it. */
  reservationNeeded: bigint;
  free: bigint;
  /** The contract adds the premium to the bond before checking, so capacity is free + premium. */
  capacityAllows: boolean;
  limitBps: number;
  feeBps: number;
  rules: RulesInput;
  rulesAreDefaults: boolean;
  reference: {
    label: string;
    modelNote: string;
    termDays: number;
    sigma: number;
    sigmaAsset: StockSymbol;
    /** The model's fair price as a share of the principal, in bps, and in USDG base units. */
    worstCase: { stockShare: number; fairBps: number; fairAmount: bigint };
    record: { stockShare: number; fairBps: number; fairAmount: bigint } | null;
    /** The offer's premium as bps of the principal. */
    offerPremiumBps: number;
  } | null;
  record: { hasRecord: boolean; generatedAt: string | null; score: number | null; trades: number; refusals: number; claims: number; exposureP95: number | null } | null;
  balance?: { user: Address; usdg: bigint; enough: boolean };
}

export interface AccountView {
  market: string;
  cover: Address;
  offerId: number;
  account: Address;
  user: Address;
  agent: Address;
  status: (typeof COVER_STATUS)[number];
  limitBps: number;
  principal: bigint;
  reserve: bigint;
  value: bigint;
  stockValue: bigint;
  loss: bigint;
  limit: bigint;
  settleable: boolean;
  fresh: boolean;
  paused: boolean;
  stopped: boolean;
  rules: RulesInput;
}

export interface DecisionCheck {
  ok: boolean;
  reason?: string;
  txHash: Hex;
  account?: Address;
  event?: "Traded" | "Blocked";
  blockReason?: string;
  decisionHash?: Hex;
  recomputedHash?: Hex;
  decisionJson?: string;
}

export interface TradeQuote {
  asset: Address;
  isBuy: boolean;
  usdAmount: bigint;
  /** Stock tokens (buy) or USDG (sell), base units, before any tolerance. */
  expectedOut: bigint;
  /** The oracle price the venue would use (8 decimals) and when it was published. */
  price: bigint;
  updatedAt: bigint;
  /** expectedOut less `toleranceBps`. */
  suggestedMinOut: bigint;
  toleranceBps: number;
  /** Stock tokens the account would sell (sells only). */
  amountIn?: bigint;
}

export class Bondline {
  readonly config: BondlineConfig;
  readonly client: PublicClient;
  private marketCache = new Map<string, Promise<MarketInfo>>();

  constructor(config: BondlineConfig = testnetConfig(), opts: { client?: PublicClient } = {}) {
    this.config = config;
    this.client =
      opts.client ??
      (createPublicClient({
        chain: config.chain,
        transport: http(config.rpcUrl, { batch: true, fetchOptions: { headers: { "user-agent": "bondline-sdk/0.1 (read-only)" } } }),
        batch: config.chain.contracts?.multicall3 ? { multicall: true } : undefined,
      }) as PublicClient);
  }

  // ---------------------------------------------------------------- markets

  marketConfig(keyOrAddress: string): MarketConfig {
    const k = keyOrAddress.toLowerCase();
    const m = this.config.markets.find((x) => x.key === k || x.address.toLowerCase() === k);
    if (!m) throw new Error(`unknown market "${keyOrAddress}"; known: ${this.config.markets.map((x) => x.key).join(", ")}`);
    return m;
  }

  getMarket(keyOrAddress: string): Promise<MarketInfo> {
    const m = this.marketConfig(keyOrAddress);
    let p = this.marketCache.get(m.key);
    if (!p) {
      p = this.loadMarket(m);
      p.catch(() => this.marketCache.delete(m.key));
      this.marketCache.set(m.key, p);
    }
    return p;
  }

  private async loadMarket(m: MarketConfig): Promise<MarketInfo> {
    const c = this.client;
    const [venue, assets, feeds, maxPriceAge, capBps, offerCount] = await Promise.all([
      c.readContract({ address: m.address, abi: bondlineMarketAbi, functionName: "venue" }),
      c.readContract({ address: m.address, abi: bondlineMarketAbi, functionName: "assets" }),
      c.readContract({ address: m.address, abi: bondlineMarketAbi, functionName: "feeds" }),
      c.readContract({ address: m.address, abi: bondlineMarketAbi, functionName: "maxPriceAge" }),
      c.readContract({ address: m.address, abi: bondlineMarketAbi, functionName: "capBps" }),
      c.readContract({ address: m.address, abi: bondlineMarketAbi, functionName: "offerCount" }),
    ]);
    return {
      key: m.key,
      label: m.label,
      address: m.address,
      venue,
      maxPriceAge: Number(maxPriceAge),
      capBps: Number(capBps),
      assets: assets.map((address, index) => ({
        index,
        address,
        symbol: this.config.assetSymbols[address.toLowerCase()] ?? `ASSET${index}`,
        feed: feeds[index],
      })),
      offerCount: Number(offerCount),
    };
  }

  // ---------------------------------------------------------------- offers

  /** Offers on every market (or one): terms, bond, reserved, free, premiums and claims. */
  async listOffers(filter: OfferFilter = {}): Promise<OfferView[]> {
    const markets = filter.market ? [this.marketConfig(filter.market)] : this.config.markets;
    const perMarket = await Promise.all(
      markets.map(async (m) => {
        const entries = await this.client.readContract({ address: m.address, abi: bondlineMarketAbi, functionName: "offers" });
        return Promise.all(entries.map((e, id) => this.readOffer(m, id, e)));
      }),
    );
    let out = perMarket.flat();
    if (filter.agent) out = out.filter((o) => o.agent.toLowerCase() === filter.agent!.toLowerCase());
    if (filter.underwriter) out = out.filter((o) => o.underwriter.toLowerCase() === filter.underwriter!.toLowerCase());
    if (filter.listedOnly) out = out.filter((o) => o.listed);
    return out;
  }

  async getOffer(market: string, id: number): Promise<OfferView> {
    const m = this.marketConfig(market);
    const e = await this.client.readContract({ address: m.address, abi: bondlineMarketAbi, functionName: "offer", args: [BigInt(id)] });
    return this.readOffer(m, id, e);
  }

  private async readOffer(m: MarketConfig, id: number, e: { cover: Address; underwriter: Address; agent: Address; listed: boolean }): Promise<OfferView> {
    const c = this.client;
    const read = <F extends "terms" | "bond" | "reserved" | "free" | "premiums" | "claimsPaid" | "accountCount" | "listed">(functionName: F) =>
      c.readContract({ address: e.cover, abi: bondlineCoverAbi, functionName } as never) as Promise<any>;
    const [terms, bond, reserved, free, premiums, claimsPaid, accounts, listed] = await Promise.all([
      read("terms"),
      read("bond"),
      read("reserved"),
      read("free"),
      read("premiums"),
      read("claimsPaid"),
      read("accountCount"),
      read("listed"),
    ]);
    return {
      market: m.key,
      marketAddress: m.address,
      id,
      cover: e.cover,
      underwriter: e.underwriter,
      underwriterIsTeam: isTeamWallet(e.underwriter),
      agent: e.agent,
      listed,
      name: terms.name,
      terms: { minLimitBps: terms.minLimitBps, maxLimitBps: terms.maxLimitBps, feeBps: terms.feeBps, maxStockBps: terms.maxStockBps },
      bond,
      reserved,
      free,
      premiums,
      claimsPaid,
      accounts: Number(accounts),
    };
  }

  // ---------------------------------------------------------------- records

  /** The agent's public record snapshot (shared/src/records), or null parts if there is none. */
  getAgentRecord(agent: Address, recordsDir?: string): LoadedRecord {
    return loadRecord(getAddress(agent), recordsDir);
  }

  // ---------------------------------------------------------------- quotes

  /**
   * SDK defaults for the rules of a new account, the same as the team's "careful" agent: every listed stock, at most
   * 30% (or the offer's cap, if lower) in stocks, 10% of the account per trade, 200% a day, 0.5% slippage, prices
   * up to 4 hours old (or the market's limit, if lower). Pass your own rules to change any of it.
   */
  defaultRules(offer: Pick<OfferView, "terms">, market: Pick<MarketInfo, "assets" | "maxPriceAge">): RulesInput {
    return {
      assetMask: (1 << market.assets.length) - 1,
      maxStockBps: Math.min(offer.terms.maxStockBps, 3000),
      maxTradeBps: 1000,
      maxDailyBps: 20_000,
      maxSlippageBps: 50,
      maxPriceAge: Math.min(market.maxPriceAge, 4 * 3600),
    };
  }

  /**
   * What a cover would cost and whether it would go through: premium, principal, the bond it reserves, whether the
   * offer's free bond allows it, the model's reference price (shared/src/pricing.ts) and the agent's record.
   */
  async quoteCover(args: {
    market: string;
    offerId: number;
    /** USDG: a decimal string or number ("100"), or a bigint in base units. */
    amount: string | number | bigint;
    limitBps: number;
    rules?: Partial<RulesInput>;
    /** If given, also checks the user's USDG balance. */
    user?: Address;
    recordsDir?: string;
  }): Promise<CoverQuote> {
    const amount = parseUsdg(args.amount);
    const market = await this.getMarket(args.market);
    const offer = await this.getOffer(market.key, args.offerId);
    const defaults = this.defaultRules(offer, market);
    const rules: RulesInput = { ...defaults, ...(args.rules ?? {}) };
    const rulesAreDefaults = !args.rules || Object.keys(args.rules).length === 0;

    const problems: string[] = [];
    if (!offer.listed) problems.push("the offer is delisted: no new covers or deposits");
    if (args.limitBps < offer.terms.minLimitBps || args.limitBps > offer.terms.maxLimitBps) {
      problems.push(`limitBps ${args.limitBps} is outside the offer's range ${offer.terms.minLimitBps}..${offer.terms.maxLimitBps}`);
    }
    if (amount < CONTRACT_BOUNDS.minDeposit) problems.push(`deposit is below the 1 USDG minimum`);
    problems.push(...validateRules(rules, { assetCount: market.assets.length, offerMaxStockBps: offer.terms.maxStockBps, marketMaxPriceAge: market.maxPriceAge }));

    // The cover's own arithmetic. Done locally when the limit is outside the model's domain, so a bad limit still
    // yields a readable problem rather than a revert from quoteDeposit.
    const inRange = args.limitBps >= 0 && args.limitBps < CAP_BPS;
    let premium = (amount * BigInt(offer.terms.feeBps)) / BPS;
    let principal = amount - premium;
    let reservationNeeded = 0n;
    if (inRange) {
      const [fee, net, reserveNeeded] = await this.client.readContract({
        address: offer.cover,
        abi: bondlineCoverAbi,
        functionName: "quoteDeposit",
        args: [amount, args.limitBps],
      });
      premium = fee;
      principal = net;
      reservationNeeded = reserveNeeded;
    } else {
      problems.push(`limitBps must be below the ${CAP_BPS} bps cap`);
    }
    const limitAmount = (principal * BigInt(args.limitBps) + BPS - 1n) / BPS;
    const capacityAllows = reservationNeeded <= offer.free + premium;
    if (!capacityAllows) problems.push(`not enough free bond: the deposit reserves ${reservationNeeded}, the offer has ${offer.free} free (+ ${premium} premium)`);

    // Reference price and record.
    const loaded = this.getAgentRecord(offer.agent, args.recordsDir);
    let reference: CoverQuote["reference"] = null;
    if (inRange && args.limitBps > 0 && rules.maxStockBps > 0) {
      const allowed = market.assets.filter((a) => (rules.assetMask >> a.index) & 1).map((a) => a.symbol).filter((s): s is StockSymbol => s === "TSLA" || s === "AMZN");
      if (allowed.length > 0) {
        const { symbol, sigma } = sigmaOf(allowed);
        const observed = loaded.record?.hasRecord ? loaded.record.exposure.p95 : null;
        const prices = referencePrices({
          maxStockShare: rules.maxStockBps / 10_000,
          observedStockShare: observed,
          sigma,
          limit: args.limitBps / 10_000,
          termDays: PRICING_MODEL.termDays,
        });
        const fairAmount = (fair: number) => BigInt(Math.round(fair * Number(principal)));
        reference = {
          label: PRICING_LABEL,
          modelNote: "Prices 30 days of cover on the amount covered (the principal). The contract charges its premium once, from the deposit, and cover lasts until settled or closed.",
          termDays: PRICING_MODEL.termDays,
          sigma,
          sigmaAsset: symbol,
          worstCase: { stockShare: rules.maxStockBps / 10_000, fairBps: prices.worstCase.bps.fair, fairAmount: fairAmount(prices.worstCase.fair) },
          record: prices.record ? { stockShare: observed as number, fairBps: prices.record.bps.fair, fairAmount: fairAmount(prices.record.fair) } : null,
          offerPremiumBps: principal > 0n ? Number((premium * BPS * 1000n) / principal) / 1000 : 0,
        };
      }
    }

    let balance: CoverQuote["balance"];
    if (args.user) {
      const user = getAddress(args.user);
      const bal = await this.client.readContract({ address: this.config.usdg, abi: erc20Abi, functionName: "balanceOf", args: [user] });
      balance = { user, usdg: bal, enough: bal >= amount };
      if (!balance.enough) problems.push(`the user holds ${bal} USDG base units, less than the ${amount} deposit`);
    }

    const s = loaded.summary;
    return {
      ok: problems.length === 0,
      problems,
      market: market.key,
      offerId: offer.id,
      cover: offer.cover,
      agent: offer.agent,
      listed: offer.listed,
      amount,
      premium,
      principal,
      limitAmount,
      reservationNeeded,
      free: offer.free,
      capacityAllows,
      limitBps: args.limitBps,
      feeBps: offer.terms.feeBps,
      rules,
      rulesAreDefaults,
      reference,
      record: {
        hasRecord: loaded.record?.hasRecord ?? s?.hasRecord ?? false,
        generatedAt: loaded.generatedAt,
        score: loaded.record?.score.value ?? s?.score ?? null,
        trades: loaded.record?.activity.trades ?? s?.trades ?? 0,
        refusals: loaded.record?.activity.refusals ?? s?.refusals ?? 0,
        claims: loaded.record?.claims.count ?? s?.claims ?? 0,
        exposureP95: loaded.record?.hasRecord ? (loaded.record.exposure.p95 ?? null) : null,
      },
      balance,
    };
  }

  // ---------------------------------------------------------------- builders (unsigned)

  /** Two transactions for the user, in order: approve exactly the deposit, then open(limitBps, rules, amount). */
  async buildCoverTransactions(args: {
    market: string;
    offerId: number;
    user: Address;
    amount: string | number | bigint;
    limitBps: number;
    rules?: Partial<RulesInput>;
    /** Skip the checks (not recommended): build even if the quote has problems. */
    force?: boolean;
  }): Promise<{ transactions: UnsignedTransaction[]; quote: CoverQuote }> {
    const quote = await this.quoteCover({ ...args });
    if (!quote.ok && !args.force) throw new Error(`cover would be refused: ${quote.problems.join("; ")}`);
    const transactions = buildCoverTransactions({
      chainId: this.config.chainId,
      usdg: this.config.usdg,
      cover: quote.cover,
      user: args.user,
      limitBps: quote.limitBps,
      rules: quote.rules,
      amount: quote.amount,
    });
    return { transactions, quote };
  }

  /**
   * The underwriting typed data for an offer naming `agent` (an outside agent's address): the underwriter signs it
   * once; `buildCreateOfferTransaction` then makes their one transaction.
   */
  buildOfferAuthorization(args: {
    market: string;
    underwriter: Address;
    terms: TermsInput;
    bond: string | number | bigint;
    validForSeconds?: number;
    now?: number;
    nonce?: Hex;
  }): OfferAuthorization {
    const m = this.marketConfig(args.market);
    return buildOfferAuthorization({
      domain: this.config.usdgDomain,
      market: m.address,
      underwriter: args.underwriter,
      terms: args.terms,
      bond: parseUsdg(args.bond),
      validForSeconds: args.validForSeconds,
      now: args.now,
      nonce: args.nonce,
    });
  }

  buildCreateOfferTransaction(args: { authorization: OfferAuthorization; signature: Hex }): UnsignedTransaction {
    return buildCreateOfferTransaction({ chainId: this.config.chainId, ...args });
  }

  /** Rebuilds an authorization from its plain fields (e.g. JSON from the MCP server). */
  restoreOfferAuthorization(f: {
    market: Address;
    underwriter: Address;
    terms: TermsInput;
    bond: string | bigint;
    validAfter: string | bigint;
    validBefore: string | bigint;
    nonce: Hex;
  }): OfferAuthorization {
    if (!this.config.markets.some((m) => m.address.toLowerCase() === f.market.toLowerCase())) throw new Error("authorization names a market this SDK is not configured for");
    const a = buildOfferAuthorization({
      domain: this.config.usdgDomain,
      market: f.market,
      underwriter: f.underwriter,
      terms: f.terms,
      bond: BigInt(f.bond),
      now: 0,
      nonce: f.nonce,
    });
    const validAfter = BigInt(f.validAfter);
    const validBefore = BigInt(f.validBefore);
    return { ...a, validAfter, validBefore, typedData: { ...a.typedData, message: { ...a.typedData.message, validAfter, validBefore } } };
  }

  /** Checks that `signature` is the underwriter's over this authorization, then builds their one transaction. */
  async buildCreateOfferFromSignature(args: { authorization: OfferAuthorization; signature: Hex }): Promise<UnsignedTransaction> {
    const signer = await recoverTypedDataAddress({ ...args.authorization.typedData, signature: args.signature });
    if (signer.toLowerCase() !== args.authorization.typedData.message.from.toLowerCase()) {
      throw new Error(`the signature is from ${signer}, not the underwriter ${args.authorization.typedData.message.from}`);
    }
    return this.buildCreateOfferTransaction(args);
  }

  /** Resolves a stock symbol ("TSLA") or address against an account's own asset list. */
  private async resolveAsset(account: Address, asset: string): Promise<{ address: Address; symbol: string }> {
    const list = await this.client.readContract({ address: account, abi: agentAccountAbi, functionName: "assets" });
    const named = list.map((address, i) => ({ address, symbol: this.config.assetSymbols[address.toLowerCase()] ?? `ASSET${i}` }));
    const hit = isAddress(asset)
      ? named.find((a) => a.address.toLowerCase() === asset.toLowerCase())
      : named.find((a) => a.symbol.toLowerCase() === asset.toLowerCase());
    if (!hit) throw new Error(`asset "${asset}" is not one of this account's assets: ${named.map((a) => `${a.symbol} ${a.address}`).join(", ")}`);
    return hit;
  }

  /** Prices a trade at the demo exchange: expected output and a `minOut` with a tolerance. Reads only. */
  async quoteTrade(args: { account: Address; asset: string; side: "buy" | "sell"; usdAmount: string | number | bigint | "max"; toleranceBps?: number }): Promise<TradeQuote> {
    const account = getAddress(args.account);
    const asset = await this.resolveAsset(account, args.asset);
    const market = await this.client.readContract({ address: account, abi: agentAccountAbi, functionName: "market" });
    const venue = await this.client.readContract({ address: market, abi: bondlineMarketAbi, functionName: "venue" });
    const toleranceBps = args.toleranceBps ?? 50;
    const isBuy = args.side === "buy";
    const sellAll = args.usdAmount === "max" || args.usdAmount === maxUint256;
    const usdAmount = sellAll ? maxUint256 : parseUsdg(args.usdAmount as string | number | bigint);
    let expectedOut: bigint, price: bigint, updatedAt: bigint, amountIn: bigint | undefined;
    if (isBuy) {
      if (sellAll) throw new Error("max is only for sells");
      [expectedOut, price, updatedAt] = await this.client.readContract({ address: venue, abi: oracleVenueAbi, functionName: "quoteBuy", args: [asset.address, usdAmount] });
    } else {
      const token = await this.client.readContract({ address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
      const [, p] = await this.client.readContract({ address: venue, abi: oracleVenueAbi, functionName: "quoteSell", args: [asset.address, 10n ** 18n] });
      amountIn = sellAll ? token : (usdAmount * PRICE_SCALE + p - 1n) / p;
      if (amountIn > token) amountIn = token;
      [expectedOut, price, updatedAt] = await this.client.readContract({ address: venue, abi: oracleVenueAbi, functionName: "quoteSell", args: [asset.address, amountIn] });
    }
    return { asset: asset.address, isBuy, usdAmount, expectedOut, price, updatedAt, suggestedMinOut: (expectedOut * (BPS - BigInt(toleranceBps))) / BPS, toleranceBps, amountIn };
  }

  /**
   * One `trade` transaction for the agent to send from its own wallet. `minOut` is in base units (stock tokens for a
   * buy, USDG for a sell); with `minOutToleranceBps` it is taken from the demo exchange's current quote instead.
   * Omitting both leaves no floor (0): the account's own slippage rule still applies.
   */
  async buildTradeTransaction(args: {
    account: Address;
    asset: string;
    side: "buy" | "sell";
    usdAmount: string | number | bigint | "max";
    minOut?: string | bigint;
    minOutToleranceBps?: number;
    decision: Record<string, unknown> | string;
  }): Promise<{ transaction: UnsignedTransaction; decision: EncodedDecision; minOut: bigint; warnings: string[] }> {
    const account = getAddress(args.account);
    const asset = await this.resolveAsset(account, args.asset);
    const [agent, paused, stopped, released] = await Promise.all([
      this.client.readContract({ address: account, abi: agentAccountAbi, functionName: "agent" }),
      this.client.readContract({ address: account, abi: agentAccountAbi, functionName: "paused" }),
      this.client.readContract({ address: account, abi: agentAccountAbi, functionName: "stopped" }),
      this.client.readContract({ address: account, abi: agentAccountAbi, functionName: "released" }),
    ]);
    const warnings: string[] = [];
    if (stopped || released) warnings.push("the account is stopped: a trade is refused with the Stopped reason");
    else if (paused) warnings.push("the user paused the agent: a trade is refused with the Paused reason");
    const sellAll = args.usdAmount === "max" || args.usdAmount === maxUint256;
    const usdAmount = sellAll ? maxUint256 : parseUsdg(args.usdAmount as string | number | bigint);
    let minOut: bigint;
    if (args.minOut !== undefined) minOut = parseBaseUnits(args.minOut, "minOut");
    else if (args.minOutToleranceBps !== undefined) {
      minOut = (await this.quoteTrade({ account, asset: asset.address, side: args.side, usdAmount: sellAll ? "max" : usdAmount, toleranceBps: args.minOutToleranceBps })).suggestedMinOut;
    } else {
      minOut = 0n;
      warnings.push("no minOut set (0): only the account's own slippage rule limits the fill");
    }
    const built = buildTradeTransaction({ chainId: this.config.chainId, account, agent, asset: asset.address, isBuy: args.side === "buy", usdAmount, minOut, decision: args.decision });
    return { ...built, minOut, warnings };
  }

  // ---------------------------------------------------------------- accounts

  /** Covered accounts across offers, filtered by agent, user, market or offer. Reads each account's health and rules. */
  async listAccounts(filter: { market?: string; offerId?: number; agent?: Address; user?: Address; limit?: number } = {}): Promise<AccountView[]> {
    const offers = (await this.listOffers({ market: filter.market, agent: filter.agent })).filter((o) => filter.offerId === undefined || o.id === filter.offerId);
    const out: AccountView[] = [];
    const cap = filter.limit ?? 100;
    for (const o of offers) {
      const indexes = Array.from({ length: o.accounts }, (_, i) => i);
      const addrs = await Promise.all(indexes.map((i) => this.client.readContract({ address: o.cover, abi: bondlineCoverAbi, functionName: "accountAt", args: [BigInt(i)] })));
      for (const account of addrs) {
        if (out.length >= cap) return out;
        const [pos, h, paused, stopped, rules] = await Promise.all([
          this.client.readContract({ address: o.cover, abi: bondlineCoverAbi, functionName: "position", args: [account] }),
          this.client.readContract({ address: o.cover, abi: bondlineCoverAbi, functionName: "health", args: [account] }),
          this.client.readContract({ address: account, abi: agentAccountAbi, functionName: "paused" }),
          this.client.readContract({ address: account, abi: agentAccountAbi, functionName: "stopped" }),
          this.client.readContract({ address: account, abi: agentAccountAbi, functionName: "rules" }),
        ]);
        if (filter.user && pos.user.toLowerCase() !== filter.user.toLowerCase()) continue;
        out.push({
          market: o.market,
          cover: o.cover,
          offerId: o.id,
          account,
          user: pos.user,
          agent: o.agent,
          status: COVER_STATUS[h.status],
          limitBps: h.limitBps,
          principal: h.principal,
          reserve: h.reserve,
          value: h.value,
          stockValue: h.stockValue,
          loss: h.loss,
          limit: h.limit,
          settleable: h.settleable,
          fresh: h.fresh,
          paused,
          stopped,
          rules: { ...rules },
        });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- decisions

  /**
   * Checks a mined trade: re-hashes the decision bytes in the transaction's input and compares them with the
   * `decisionHash` the account's Traded or Blocked event carries. Works for a direct call to `trade`.
   */
  async verifyDecision(txHash: Hex): Promise<DecisionCheck> {
    const [tx, receipt] = await Promise.all([this.client.getTransaction({ hash: txHash }), this.client.getTransactionReceipt({ hash: txHash })]);
    if (!tx.to) return { ok: false, reason: "not a call to an account", txHash };
    let args: readonly unknown[];
    try {
      const d = decodeFunctionData({ abi: agentAccountAbi, data: tx.input });
      if (d.functionName !== "trade") return { ok: false, reason: `input is ${d.functionName}, not trade`, txHash };
      args = d.args as readonly unknown[];
    } catch {
      return { ok: false, reason: "input is not a direct trade() call", txHash };
    }
    const decisionBytes = args[4] as Hex;
    const { hash: recomputedHash, json: decisionJson } = hashDecisionBytes(decisionBytes);
    const logs = parseEventLogs({ abi: agentAccountAbi, logs: receipt.logs, eventName: ["Traded", "Blocked"] }).filter((l) => l.address.toLowerCase() === tx.to!.toLowerCase());
    const log = logs[0];
    if (!log) return { ok: false, reason: "no Traded or Blocked event from the account", txHash, account: tx.to, recomputedHash, decisionJson };
    const decisionHash = (log.args as { decisionHash: Hex }).decisionHash;
    const blockReason = log.eventName === "Blocked" ? BLOCK_REASONS[Number((log.args as { reason: number }).reason)]?.key : undefined;
    return { ok: decisionHash === recomputedHash, txHash, account: tx.to, event: log.eventName, blockReason, decisionHash, recomputedHash, decisionJson };
  }
}

export function createBondline(config?: BondlineConfig, opts?: { client?: PublicClient }): Bondline {
  return new Bondline(config, opts);
}
