// Backtest of Bondline cover for the two agents' rules, Careful (30% of the account in stocks) and Bold (80%), over
// the real Chainlink TSLA/USD and AMZN/USD history on Robinhood Chain mainnet. Hypothetical covers on real prices:
// no cover in this file was ever sold.
//
//   npx tsx scripts/backtest.ts                         # read every round from Robinhood Chain mainnet (read-only)
//   npx tsx scripts/backtest.ts --save-rounds <file>    # also save the rounds it read, to replay offline
//   npx tsx scripts/backtest.ts --rounds <file>         # use saved rounds instead of the network
//   npx tsx scripts/backtest.ts --out-dir <dir>         # write backtest.json and BACKTEST.md elsewhere
//
// Writes docs/data/backtest.json (for the site) and docs/BACKTEST.md (generated from the same numbers; edit this
// script, not the Markdown). Every assumption is a constant below and is written into both files.
//
// The settle math is the contract's, in integers (contracts/src/BondlineCover.sol):
//   value  = cash + Σ stock × oracle price             loss = max(0, P − value)
//   limit  = ⌈P × l / 10000⌉                           payout = min(loss − limit, ⌊P × (3000 − l) / 10000⌋)
//   reserve = ⌈P × (3000 − l) / 10000⌉ per cover        settle only if loss > limit and every held price is fresh
//
// RPC etiquette (Robinhood Chain mainnet rate-limits): a user-agent header, at most 10 calls per HTTP batch, one
// request at a time with a gap, exponential backoff (or Retry-After) on HTTP 429.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { robinhoodMainnet } from "../shared/src/chain.ts";
import { CAP_BPS, MAINNET_FEEDS, STOCK_SYMBOLS, type StockSymbol } from "../shared/src/constants.ts";
import { PRICING_MODEL, VOLATILITY, priceCover, sigmaOf } from "../shared/src/pricing.ts";
import deploymentJson from "../shared/src/deployment.json" with { type: "json" };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------ assumptions (all stated in the outputs)

/** Every cover's principal: 1,000 USDG net of the premium (USDG has 6 decimals). */
const PRINCIPAL = 1_000_000_000n;
/** The default loss limit. The deployed offers allow 5% to 20%; the other limits are a sensitivity. */
const LIMIT_BPS = 1000;
/** Each cover is held this long, then the user closes it, unless it paid out first. The model prices 30 days. */
const HOLD_DAYS = 30;
/** The Live market's max price age (deployments/rhTestnet.json): a settle needs every held price this fresh. */
const MAX_PRICE_AGE_S: number = deploymentJson.markets.live.maxPriceAge;
/** The demo exchange's spread: the account buys its stocks at the oracle price less this. */
const SPREAD_BPS: number = deploymentJson.markets.live.spreadBps;
/** The last instant of history used: the NYSE close on Friday 2 Oct 2026, so reruns give the same result. */
const WINDOW_END = Date.UTC(2026, 9, 2, 20, 0, 0) / 1000;
/** A price older than this at a close can't open a cover (the venue would refuse the buy). */
const MAX_OPEN_PRICE_AGE_S = MAX_PRICE_AGE_S;

/** The deployed offers' terms (scripts/testnet-setup.ts; the same on the Live and Replay markets). */
const AGENTS = {
  careful: { name: "Careful", offer: "Careful 1%", stockShareBps: 3000, feeBps: 100 },
  bold: { name: "Bold", offer: "Bold 4%", stockShareBps: 8000, feeBps: 400 },
} as const;
type AgentKey = keyof typeof AGENTS;

/** How the stock part of the account is split. The main run splits it equally; the others are sensitivities. */
const MIXES: Record<string, { label: string; bps: Record<StockSymbol, number> }> = {
  even: { label: "half TSLA, half AMZN", bps: { TSLA: 5000, AMZN: 5000 } },
  tsla: { label: "all TSLA", bps: { TSLA: 10_000, AMZN: 0 } },
  amzn: { label: "all AMZN", bps: { TSLA: 0, AMZN: 10_000 } },
};

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const USER_AGENT = "bondline-backtest/0.1 (read-only; hackathon research)";
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const ROUNDS_PER_MULTICALL = 100;
const MIN_REQUEST_GAP_MS = 250;

/** NYSE full-day closures and 13:00 early closes (nyse.com, "Holidays & Trading Hours"). Same list as volatility.ts. */
const NYSE_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
  "2026-11-26", "2026-12-25",
]);
const NYSE_EARLY_CLOSES = new Set(["2026-11-27", "2026-12-24"]);

// ------------------------------------------------------------------ arguments

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const roundsIn = arg("--rounds");
const roundsOut = arg("--save-rounds");
const outDir = resolve(arg("--out-dir") ?? join(ROOT, "docs"));
const JSON_OUT = join(outDir, "data", "backtest.json");
const MD_OUT = join(outDir, "BACKTEST.md");

// ------------------------------------------------------------------ polite RPC

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function politeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const gap = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
      if (gap > 0) await sleep(gap);
      lastRequestAt = Date.now();
      const res = await fetch(input, init);
      if (res.status !== 429 || attempt >= 8) return res;
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 1000 * 2 ** attempt);
      console.warn(`  RPC rate limit (429): waiting ${wait} ms`);
      await sleep(wait);
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function phaseId() view returns (uint16)",
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// ------------------------------------------------------------------ rounds

interface Round {
  /** Aggregator round within the phase. */
  round: number;
  phase: number;
  answer: bigint;
  updatedAt: number;
}

interface FeedHistory {
  symbol: StockSymbol;
  feed: Address;
  description: string;
  decimals: number;
  rounds: Round[];
}

interface RoundsFile {
  fetchedAt: string;
  block: string;
  rpc: string;
  feeds: Record<StockSymbol, { feed: Address; description: string; decimals: number; rounds: { round: number; phase: number; answer: string; updatedAt: number }[] }>;
}

const PHASE_SHIFT = 64n;
const AGG_MASK = (1n << PHASE_SHIFT) - 1n;

async function fetchRounds(): Promise<{ block: string; feeds: FeedHistory[] }> {
  const client = createPublicClient({
    chain: robinhoodMainnet,
    transport: http(RPC, {
      batch: { batchSize: 10, wait: 16 },
      fetchFn: politeFetch,
      fetchOptions: { headers: { "user-agent": USER_AGENT } },
      retryCount: 5,
      retryDelay: 1000,
      timeout: 30_000,
    }),
  });
  const block = await client.getBlockNumber();
  console.log(`Robinhood Chain mainnet block ${block}`);
  const feeds: FeedHistory[] = [];
  for (const symbol of STOCK_SYMBOLS) {
    const feed = MAINNET_FEEDS[symbol];
    const latest = await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData", blockNumber: block });
    const phaseId = await client.readContract({ address: feed, abi: feedAbi, functionName: "phaseId", blockNumber: block });
    const description = await client.readContract({ address: feed, abi: feedAbi, functionName: "description" });
    const decimals = await client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" });
    if (Number(latest[0] >> PHASE_SHIFT) !== phaseId) throw new Error(`${symbol}: latest round is not in phase ${phaseId}`);
    if (phaseId !== 1) throw new Error(`${symbol}: phase ${phaseId}; this script reads phase 1 only (all history so far)`);
    const top = latest[0] & AGG_MASK;
    const rounds: Round[] = [];
    for (let hi = top; hi >= 1n; hi -= BigInt(ROUNDS_PER_MULTICALL)) {
      const ids: bigint[] = [];
      for (let r = hi; r >= 1n && r > hi - BigInt(ROUNDS_PER_MULTICALL); r--) ids.push((BigInt(phaseId) << PHASE_SHIFT) | r);
      const results = await client.multicall({
        multicallAddress: MULTICALL3,
        allowFailure: true,
        batchSize: 0,
        blockNumber: block,
        contracts: ids.map((id) => ({ address: feed, abi: feedAbi, functionName: "getRoundData" as const, args: [id] as const })),
      });
      for (let i = 0; i < ids.length; i++) {
        const res = results[i];
        if (res.status !== "success" || res.result[3] === 0n) throw new Error(`${symbol}: round ${ids[i] & AGG_MASK} missing`);
        rounds.push({ round: Number(res.result[0] & AGG_MASK), phase: phaseId, answer: res.result[1], updatedAt: Number(res.result[3]) });
      }
      process.stdout.write(`  ${symbol}: read down to round ${ids[ids.length - 1] & AGG_MASK}   \r`);
    }
    process.stdout.write("\n");
    rounds.sort((a, b) => a.updatedAt - b.updatedAt || a.round - b.round);
    console.log(`${symbol} (${description}): ${rounds.length} rounds, latest ${new Date(rounds[rounds.length - 1].updatedAt * 1000).toISOString()}`);
    feeds.push({ symbol, feed, description, decimals, rounds });
  }
  return { block: block.toString(), feeds };
}

function loadRounds(path: string): { block: string; feeds: FeedHistory[] } {
  const raw = JSON.parse(readFileSync(path, "utf8")) as RoundsFile;
  return {
    block: raw.block,
    feeds: STOCK_SYMBOLS.map((symbol) => {
      const f = raw.feeds[symbol];
      return {
        symbol,
        feed: f.feed,
        description: f.description,
        decimals: f.decimals,
        rounds: f.rounds.map((r) => ({ round: r.round, phase: r.phase, answer: BigInt(r.answer), updatedAt: r.updatedAt })),
      };
    }),
  };
}

function saveRounds(path: string, block: string, feeds: FeedHistory[]) {
  const out: RoundsFile = {
    fetchedAt: new Date().toISOString(),
    block,
    rpc: RPC,
    feeds: Object.fromEntries(
      feeds.map((f) => [
        f.symbol,
        { feed: f.feed, description: f.description, decimals: f.decimals, rounds: f.rounds.map((r) => ({ ...r, answer: r.answer.toString() })) },
      ]),
    ) as RoundsFile["feeds"],
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out));
  console.log(`saved rounds to ${path}`);
}

/**
 * The feeds' first rounds report answers about 10^8 too large (16 decimals while decimals() says 8). A unit error,
 * not a price: drop every round before the last place two consecutive rounds are more than 10x apart.
 */
function dropBadRounds(f: FeedHistory) {
  let lastBreak = -1;
  for (let i = 1; i < f.rounds.length; i++) {
    const factor = Number(f.rounds[i - 1].answer) / Number(f.rounds[i].answer);
    if (factor > 10 || factor < 0.1) lastBreak = i;
  }
  const skipped = lastBreak > 0 ? f.rounds.slice(0, lastBreak) : [];
  const kept = lastBreak > 0 ? f.rounds.slice(lastBreak) : f.rounds;
  for (const r of kept) if (r.answer <= 0n) throw new Error(`${f.symbol}: non-positive answer in round ${r.round}`);
  return { skipped, kept };
}

// ------------------------------------------------------------------ calendar

const nyParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function nyLocal(tsSec: number) {
  const p = Object.fromEntries(nyParts.formatToParts(new Date(tsSec * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** The UTC instant of hh:00 New York time on `date`, whichever of EDT/EST applies. */
function nyTime(date: string, hour: number): number {
  const [y, m, d] = date.split("-").map(Number);
  for (const offset of [4, 5]) {
    const ts = Date.UTC(y, m - 1, d, hour + offset) / 1000;
    const local = nyLocal(ts);
    if (local.date === date && local.hour === hour && local.minute === 0) return ts;
  }
  throw new Error(`no ${hour}:00 New York time on ${date}`);
}

function tradingDays(fromTs: number, toTs: number): string[] {
  const days: string[] = [];
  const end = nyLocal(toTs).date;
  for (let t = Date.parse(`${nyLocal(fromTs).date}T12:00:00Z`); ; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (date > end) break;
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6 || NYSE_HOLIDAYS.has(date)) continue;
    days.push(date);
  }
  return days;
}

// ------------------------------------------------------------------ the contract's math, in integers

const BPS = 10_000n;
const PRICE_SCALE = 10n ** 20n; // stock units (18 dec) × price (8 dec) / 1e20 = USDG units (6 dec)
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const limitOf = (p: bigint, limitBps: number) => ceilDiv(p * BigInt(limitBps), BPS);
const capPayout = (p: bigint, limitBps: number) => (p * BigInt(CAP_BPS - limitBps)) / BPS;
const reserveOf = (p: bigint, limitBps: number) => ceilDiv(p * BigInt(CAP_BPS - limitBps), BPS);

/** The smallest deposit whose net (deposit − ⌊deposit × fee / 10000⌋) is at least `p`, as `_deposit` computes it. */
function depositFor(p: bigint, feeBps: number): bigint {
  const f = BigInt(feeBps);
  const net = (a: bigint) => a - (a * f) / BPS;
  let a = ceilDiv(p * BPS, BPS - f);
  while (net(a) < p) a++;
  while (a > p && net(a - 1n) >= p) a--;
  return a;
}

// ------------------------------------------------------------------ simulation

interface Tick {
  symbol: StockSymbol;
  round: number;
  answer: bigint;
  updatedAt: number;
}

interface Scenario {
  key: string;
  label: string;
  agent: AgentKey;
  stockShareBps: number;
  mix: keyof typeof MIXES;
  limitBps: number;
  /** Days each cover is held, or "end": until the end of the window. */
  hold: number | "end";
}

interface CoverResult {
  openDate: string;
  openedAt: number;
  endedAt: number;
  outcome: "settled" | "closed";
  daysHeld: number;
  /** Worst loss seen at any round while the cover was active, in bps of principal. */
  worstLossBps: number;
  payout: bigint;
  claim: null | {
    settledAt: number;
    /** The first round at which the loss was past the limit, fresh or not. */
    firstPastLimitAt: number;
    trigger: { symbol: StockSymbol; round: number };
    value: bigint;
    loss: bigint;
    limit: bigint;
    payout: bigint;
    lossBps: number;
    payoutBps: number;
    capped: boolean;
    /** Hours since the trigger feed's previous round: a long wait means the move came as a gap. */
    hoursSincePreviousRound: number;
  };
}

interface Prepared {
  ticks: Tick[];
  bySymbol: Record<StockSymbol, Round[]>;
  closes: { date: string; at: number }[];
}

function latestAtOrBefore(rounds: Round[], t: number): Round | null {
  let lo = 0;
  let hi = rounds.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rounds[mid].updatedAt <= t) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 ? rounds[best] : null;
}

function firstTickAfter(ticks: Tick[], t: number): number {
  let lo = 0;
  let hi = ticks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ticks[mid].updatedAt <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function simulate(s: Scenario, data: Prepared): { covers: CoverResult[]; skippedStale: string[] } {
  const covers: CoverResult[] = [];
  const skippedStale: string[] = [];
  const mix = MIXES[s.mix].bps;
  const p = PRINCIPAL;
  const limit = limitOf(p, s.limitBps);
  const cap = capPayout(p, s.limitBps);

  for (const close of data.closes) {
    const t0 = close.at;
    const end = s.hold === "end" ? WINDOW_END : t0 + s.hold * 86_400;
    if (end > WINDOW_END) continue; // the hold must fit inside the history

    // Open: buy the stock part at the latest price at or before the close, at the demo exchange's spread.
    const price: Partial<Record<StockSymbol, { answer: bigint; updatedAt: number; round: number }>> = {};
    let stale = false;
    for (const sym of STOCK_SYMBOLS) {
      const r = latestAtOrBefore(data.bySymbol[sym], t0);
      if (!r || t0 - r.updatedAt > MAX_OPEN_PRICE_AGE_S) stale = true;
      else price[sym] = { answer: r.answer, updatedAt: r.updatedAt, round: r.round };
    }
    if (stale) {
      skippedStale.push(close.date);
      continue;
    }
    const bal: Record<StockSymbol, bigint> = { TSLA: 0n, AMZN: 0n };
    let cash = p;
    for (const sym of STOCK_SYMBOLS) {
      if (mix[sym] === 0) continue;
      const usd = (p * BigInt(s.stockShareBps) * BigInt(mix[sym])) / (BPS * BPS);
      bal[sym] = (((usd * PRICE_SCALE) / price[sym]!.answer) * (BPS - BigInt(SPREAD_BPS))) / BPS;
      cash -= usd;
    }
    const held = STOCK_SYMBOLS.filter((sym) => bal[sym] > 0n);
    const valueNow = () => held.reduce((v, sym) => v + (bal[sym] * price[sym]!.answer) / PRICE_SCALE, cash);

    let worstLoss = p > valueNow() ? p - valueNow() : 0n;
    let firstPastLimitAt: number | null = null;
    let result: CoverResult | null = null;
    for (let i = firstTickAfter(data.ticks, t0); i < data.ticks.length && data.ticks[i].updatedAt <= end; i++) {
      const tick = data.ticks[i];
      if (!held.includes(tick.symbol)) continue;
      const previous = price[tick.symbol]!;
      price[tick.symbol] = { answer: tick.answer, updatedAt: tick.updatedAt, round: tick.round };
      const value = valueNow();
      const loss = p > value ? p - value : 0n;
      if (loss > worstLoss) worstLoss = loss;
      if (loss <= limit) continue;
      firstPastLimitAt ??= tick.updatedAt;
      const fresh = held.every((sym) => tick.updatedAt - price[sym]!.updatedAt <= MAX_PRICE_AGE_S);
      if (!fresh) continue; // nothing can settle on a stale price; wait for the next round
      const payout = loss - limit < cap ? loss - limit : cap;
      result = {
        openDate: close.date,
        openedAt: t0,
        endedAt: tick.updatedAt,
        outcome: "settled",
        daysHeld: (tick.updatedAt - t0) / 86_400,
        worstLossBps: Number((worstLoss * BPS) / p),
        payout,
        claim: {
          settledAt: tick.updatedAt,
          firstPastLimitAt,
          trigger: { symbol: tick.symbol, round: tick.round },
          value,
          loss,
          limit,
          payout,
          lossBps: Number((loss * 1_000_000n) / p) / 100,
          payoutBps: Number((payout * 1_000_000n) / p) / 100,
          capped: payout === cap,
          hoursSincePreviousRound: (tick.updatedAt - previous.updatedAt) / 3600,
        },
      };
      break;
    }
    covers.push(
      result ?? {
        openDate: close.date,
        openedAt: t0,
        endedAt: end,
        outcome: "closed",
        daysHeld: (end - t0) / 86_400,
        worstLossBps: Number((worstLoss * BPS) / p),
        payout: 0n,
        claim: null,
      },
    );
  }
  return { covers, skippedStale };
}

// ------------------------------------------------------------------ book-level numbers

const usdg = (x: bigint) => Number(x) / 1e6;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const isoS = (t: number) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

function modelFairBps(s: Scenario): number {
  // The model prices the rules' worst case: σ of the most volatile allowed stock (both are allowed: TSLA).
  return priceCover({ stockShare: s.stockShareBps / 10_000, sigma: sigmaOf().sigma, limit: s.limitBps / 10_000 }).bps.fair;
}

function book(s: Scenario, covers: CoverResult[]) {
  const n = BigInt(covers.length);
  const fee = depositFor(PRINCIPAL, AGENTS[s.agent].feeBps) - PRINCIPAL;
  const fairBps = modelFairBps(s);
  const model = BigInt(Math.floor((Number(PRINCIPAL) * fairBps) / 10_000));
  const reserve = reserveOf(PRINCIPAL, s.limitBps);
  const payouts = covers.reduce((t, c) => t + c.payout, 0n);
  const claims = covers.filter((c) => c.claim);
  const reserveYears = covers.reduce((t, c) => t + (usdg(reserve) * c.daysHeld) / 365, 0);

  // The most reserve locked at once: what an underwriter must bond to write this whole book.
  const edges = covers.flatMap((c) => [
    { t: c.openedAt, d: 1 },
    { t: c.endedAt, d: -1 },
  ]);
  edges.sort((a, b) => a.t - b.t || a.d - b.d);
  let open = 0;
  let peakOpen = 0;
  for (const e of edges) {
    open += e.d;
    peakOpen = Math.max(peakOpen, open);
  }

  const schedule = (premium: bigint) => {
    const premiums = premium * n;
    const net = premiums - payouts;
    return {
      premiumPerCover: usdg(premium),
      premiumBps: r4((Number(premium) / Number(PRINCIPAL)) * 10_000),
      premiums: usdg(premiums),
      net: usdg(net),
      lossRatio: premiums > 0n ? r4(Number(payouts) / Number(premiums)) : null,
      returnOnReserve: covers.length ? r4(Number(net) / Number(reserve * n)) : null,
      annualisedReturnOnReserve: reserveYears > 0 ? r4(usdg(net) / reserveYears) : null,
    };
  };
  const worst = covers.map((c) => c.worstLossBps).sort((a, b) => a - b);
  return {
    covers: covers.length,
    claims: claims.length,
    claimRate: covers.length ? r4(claims.length / covers.length) : 0,
    payouts: usdg(payouts),
    averagePayout: claims.length ? r6(usdg(payouts) / claims.length) : 0,
    largestPayout: claims.length ? usdg(claims.reduce((m, c) => (c.payout > m ? c.payout : m), 0n)) : 0,
    cappedClaims: claims.filter((c) => c.claim!.capped).length,
    breakevenBps: covers.length ? r4((Number(payouts) / covers.length / Number(PRINCIPAL)) * 10_000) : 0,
    offerFee: { feeBps: AGENTS[s.agent].feeBps, depositPerCover: usdg(PRINCIPAL + fee), ...schedule(fee) },
    modelPrice: { fairBps: r4(fairBps), ...schedule(model) },
    reserve: {
      perCover: usdg(reserve),
      reserveYears: r4(reserveYears),
      peakCoversOpen: peakOpen,
      peakReserve: usdg(reserve * BigInt(peakOpen)),
      averageDaysHeld: covers.length ? r2(covers.reduce((t, c) => t + c.daysHeld, 0) / covers.length) : 0,
    },
    worstLossBps: {
      median: worst.length ? worst[Math.floor((worst.length - 1) / 2)] : 0,
      max: worst.length ? worst[worst.length - 1] : 0,
      coversPastHalfTheLimit: covers.filter((c) => c.worstLossBps * 2 > s.limitBps).length,
    },
  };
}

// ------------------------------------------------------------------ main

const loaded = roundsIn ? loadRounds(roundsIn) : await fetchRounds();
if (roundsOut && !roundsIn) saveRounds(roundsOut, loaded.block, loaded.feeds);

const feedInfo: Record<string, unknown> = {};
const bySymbol = {} as Record<StockSymbol, Round[]>;
for (const f of loaded.feeds) {
  const { skipped, kept } = dropBadRounds(f);
  const inWindow = kept.filter((r) => r.updatedAt <= WINDOW_END);
  bySymbol[f.symbol] = inWindow;
  feedInfo[f.symbol] = {
    address: f.feed,
    description: f.description,
    decimals: f.decimals,
    roundsRead: f.rounds.length,
    roundsSkippedAsUnitError: skipped.length,
    skippedRounds: skipped.length ? `${skipped[0].round}-${skipped[skipped.length - 1].round}` : null,
    lastSkippedAt: skipped.length ? isoS(skipped[skipped.length - 1].updatedAt) : null,
    roundsUsed: inWindow.length,
    firstRoundUsed: { round: inWindow[0].round, updatedAt: isoS(inWindow[0].updatedAt), price: Number(inWindow[0].answer) / 10 ** f.decimals },
    lastRoundUsed: {
      round: inWindow[inWindow.length - 1].round,
      updatedAt: isoS(inWindow[inWindow.length - 1].updatedAt),
      price: Number(inWindow[inWindow.length - 1].answer) / 10 ** f.decimals,
    },
    roundsAfterWindowIgnored: kept.length - inWindow.length,
    // Chainlink posts nothing while the market is closed, so rounds can be days apart.
    longestGapHours: Number((Math.max(...inWindow.slice(1).map((r, i) => r.updatedAt - inWindow[i].updatedAt)) / 3600).toFixed(1)),
    gapsOverMaxPriceAge: inWindow.slice(1).filter((r, i) => r.updatedAt - inWindow[i].updatedAt > MAX_PRICE_AGE_S).length,
    roundsMovingUnderHalfPercent: inWindow
      .slice(1)
      .filter((r, i) => {
        const prev = inWindow[i].answer;
        const diff = r.answer > prev ? r.answer - prev : prev - r.answer;
        return diff * 200n < prev; // |move| < 0.5%
      }).length,
  };
  if (f.decimals !== 8) throw new Error(`${f.symbol}: expected 8 decimals, got ${f.decimals}`);
}

const ticks: Tick[] = STOCK_SYMBOLS.flatMap((symbol) => bySymbol[symbol].map((r) => ({ symbol, round: r.round, answer: r.answer, updatedAt: r.updatedAt })));
ticks.sort((a, b) => a.updatedAt - b.updatedAt || STOCK_SYMBOLS.indexOf(a.symbol) - STOCK_SYMBOLS.indexOf(b.symbol));

const dataStart = Math.max(...STOCK_SYMBOLS.map((s) => bySymbol[s][0].updatedAt));
const closes = tradingDays(dataStart, WINDOW_END)
  .map((date) => ({ date, at: nyTime(date, NYSE_EARLY_CLOSES.has(date) ? 13 : 16) }))
  .filter((c) => c.at >= dataStart && c.at <= WINDOW_END);
const data: Prepared = { ticks, bySymbol, closes };

const main = (agent: AgentKey): Scenario => ({
  key: `${agent}`,
  label: `${AGENTS[agent].name}: ${AGENTS[agent].stockShareBps / 100}% in stocks (${MIXES.even.label}), ${LIMIT_BPS / 100}% limit, held ${HOLD_DAYS} days`,
  agent,
  stockShareBps: AGENTS[agent].stockShareBps,
  mix: "even",
  limitBps: LIMIT_BPS,
  hold: HOLD_DAYS,
});

const sensitivities = (agent: AgentKey): Scenario[] => {
  const base = main(agent);
  const out: Scenario[] = [];
  for (const limitBps of [500, 1500, 2000]) {
    out.push({ ...base, key: `${agent}-limit-${limitBps}`, label: `${limitBps / 100}% limit`, limitBps });
  }
  out.push({ ...base, key: `${agent}-tsla`, label: `stocks ${MIXES.tsla.label}`, mix: "tsla" });
  out.push({ ...base, key: `${agent}-amzn`, label: `stocks ${MIXES.amzn.label}`, mix: "amzn" });
  out.push({ ...base, key: `${agent}-hold-end`, label: "held until the window ends (no close)", hold: "end" });
  return out;
};

const agentsOut = [];
const sensitivityOut = [];
const allSkipped = new Set<string>();
for (const agent of Object.keys(AGENTS) as AgentKey[]) {
  const s = main(agent);
  const { covers, skippedStale } = simulate(s, data);
  skippedStale.forEach((d) => allSkipped.add(d));
  const b = book(s, covers);
  agentsOut.push({
    key: agent,
    name: AGENTS[agent].name,
    offer: AGENTS[agent].offer,
    scenario: s.label,
    stockShareBps: s.stockShareBps,
    mix: MIXES[s.mix].bps,
    limitBps: s.limitBps,
    holdDays: HOLD_DAYS,
    principalPerCover: usdg(PRINCIPAL),
    ...b,
    // The headline fields at the deployed offer's fee; the model-price versions are in modelPrice.
    premiums: b.offerFee.premiums,
    lossRatio: b.offerFee.lossRatio,
    underwriterReturn: {
      atOfferFee: { returnOnReserve: b.offerFee.returnOnReserve, annualised: b.offerFee.annualisedReturnOnReserve },
      atModelPrice: { returnOnReserve: b.modelPrice.returnOnReserve, annualised: b.modelPrice.annualisedReturnOnReserve },
    },
    claimsList: covers
      .filter((c) => c.claim)
      .map((c) => ({
        openedOn: c.openDate,
        openedAt: isoS(c.openedAt),
        settledAt: isoS(c.claim!.settledAt),
        firstPastLimitAt: isoS(c.claim!.firstPastLimitAt),
        trigger: c.claim!.trigger,
        hoursSincePreviousRound: r2(c.claim!.hoursSincePreviousRound),
        value: usdg(c.claim!.value),
        loss: usdg(c.claim!.loss),
        limit: usdg(c.claim!.limit),
        payout: usdg(c.claim!.payout),
        lossBps: c.claim!.lossBps,
        payoutBps: c.claim!.payoutBps,
        capped: c.claim!.capped,
        userLoss: usdg(c.claim!.loss - c.claim!.payout),
      })),
    coversList: covers.map((c) => ({
      openedOn: c.openDate,
      outcome: c.outcome,
      endedAt: isoS(c.endedAt),
      daysHeld: r2(c.daysHeld),
      worstLossBps: c.worstLossBps,
      payout: usdg(c.payout),
    })),
  });
  for (const v of sensitivities(agent)) {
    const res = simulate(v, data);
    const vb = book(v, res.covers);
    sensitivityOut.push({
      key: v.key,
      agent,
      change: v.label,
      stockShareBps: v.stockShareBps,
      mix: MIXES[v.mix].bps,
      limitBps: v.limitBps,
      hold: v.hold === "end" ? "until 2 Oct 2026 close" : `${v.hold} days`,
      covers: vb.covers,
      claims: vb.claims,
      payouts: vb.payouts,
      averagePayout: vb.averagePayout,
      breakevenBps: vb.breakevenBps,
      averageDaysHeld: vb.reserve.averageDaysHeld,
      offerFee: { premiums: vb.offerFee.premiums, lossRatio: vb.offerFee.lossRatio, annualisedReturnOnReserve: vb.offerFee.annualisedReturnOnReserve },
      modelPrice: {
        fairBps: vb.modelPrice.fairBps,
        premiums: vb.modelPrice.premiums,
        lossRatio: vb.modelPrice.lossRatio,
        annualisedReturnOnReserve: vb.modelPrice.annualisedReturnOnReserve,
      },
    });
  }
}

const opens = agentsOut[0].coversList;
function clusterCaveat(): string {
  const all = agentsOut.flatMap((a) => a.claimsList.map((c) => ({ agent: a.name, at: c.settledAt })));
  if (all.length === 0) return "No cover paid out in this window, so the loss ratios are 0 and say little about a bad month.";
  const times = all.map((c) => c.at).sort();
  return `All ${all.length} claims settled between ${times[0].slice(0, 10)} and ${times[times.length - 1].slice(0, 10)}: the window held one sharp drawdown, so the claims are one event seen from ${all.length} different opening days, not ${all.length} independent events.`;
}
function heartbeatCaveat(): string {
  const f = (s: StockSymbol) =>
    feedInfo[s] as { roundsUsed: number; longestGapHours: number; gapsOverMaxPriceAge: number; roundsMovingUnderHalfPercent: number };
  const [t, a] = [f("TSLA"), f("AMZN")];
  return `Chainlink posts a round when the price moves about 0.5% (only ${t.roundsMovingUnderHalfPercent} of the ${t.roundsUsed - 1} moves between TSLA rounds used here and ${a.roundsMovingUnderHalfPercent} of the ${a.roundsUsed - 1} between AMZN rounds were smaller). These feeds include updates outside NYSE core trading hours. In this historical window the longest observed round gaps were ${t.longestGapHours} hours for TSLA and ${a.longestGapHours} hours for AMZN, and ${t.gapsOverMaxPriceAge} and ${a.gapsOverMaxPriceAge} gaps are longer than the ${MAX_PRICE_AGE_S / 3600}-hour max price age. Settlement waits whenever an included price exceeds the market's maximum age. So a settle at 'the first round past the limit' can overshoot by up to one deviation step even without a gap, and by the whole move across a long gap between rounds.`;
}
const sigma = sigmaOf();
const assumptions = [
  `Prices: every Chainlink round of TSLA/USD and AMZN/USD on Robinhood Chain mainnet (chain 4663) from the first correctly scaled round (23 Jun 2026) to the NYSE close on 2 Oct 2026 (${isoS(WINDOW_END)}). Rounds after that instant are ignored, so reruns give the same result.`,
  "Skipped rounds: each feed's first rounds (22-23 Jun) report answers about 10^8 too large (16 decimals while decimals() says 8). Every round before the 10x break is dropped; no cover sees them.",
  `Opening: one new cover at every NYSE trading day's close (16:00 New York time) from ${opens[0]?.openedOn} to ${opens[opens.length - 1]?.openedOn}, the last close whose ${HOLD_DAYS}-day hold ends inside the history. ${closes.length} trading days in the window; covers that could not finish their hold are not opened.`,
  `Principal: 1,000 USDG per cover, net of the premium (the deposit is larger by the premium; see premiums). No top-ups or withdrawals.`,
  `Account: at the open, the agent puts exactly its rules' maximum in stocks (Careful 30%, Bold 80% of the account), split half TSLA and half AMZN by value, bought at the latest Chainlink price at or before the close less the demo exchange's ${SPREAD_BPS} bps spread. The rest stays in USDG cash. No rebalancing and no other trades while the cover runs: the stock share drifts with prices.`,
  `Limit: ${LIMIT_BPS / 100}% of principal (rounded up, as the contract does). The deployed offers allow 5% to 20%; 5%, 15% and 20% are sensitivities.`,
  `Holding: covers have no fixed term on-chain; they run until the user closes them or they pay out. In this backtest each cover is held ${HOLD_DAYS} days (the term the reference price assumes) and then closed by the user, unless it paid out first. "Held until the window ends" is a sensitivity.`,
  `Settle: at the first Chainlink round (of either feed) at which the account's loss is past its limit and every held stock's price is at most ${MAX_PRICE_AGE_S} s old (the Live market's max price age, 25 h). So a move that gaps through the limit settles at the first price after the gap: the overshoot is the gap. A loss past the limit on a stale price waits for the next fresh round. The keeper attempts settlement while it is running; transaction latency, stale prices and failed transfers can delay it. The backtest assumes settlement at the triggering round's price.`,
  "Payout: min(loss - limit, principal x (30% - limit)), the contract's integer formula. One payout per cover; after it, the agent is stopped and the cover ends. The user keeps the stocks, which keep moving; the backtest does not follow them.",
  `Premiums: (a) the deployed offers' fees, charged on the deposit: Careful 1%, Bold 4% (a 1,000 USDG principal needs a deposit of 1,010.10 or 1,041.67 USDG); (b) the model's reference price for 30 days at the same rules and limit, on the principal, with σ = ${(sigma.sigma * 100).toFixed(2)}% (${sigma.symbol}, the most volatile allowed stock, from shared/src/volatility.json). The premium is charged once per cover.`,
  `Underwriter: each cover reserves ⌈principal x (30% - limit)⌉ of the bond (200 USDG at a 10% limit) from the open until it settles or closes. Return on reserve = (premiums - payouts) / reserve locked; annualised = (premiums - payouts) / reserve-years (reserve x days held / 365). The bond earns nothing else; no protocol fee; gas ignored.`,
  "Loss ratio = payouts / premiums. A claim is a cover that paid out.",
];
const caveats = [
  `Short history: ${closes.length} trading days (23 Jun - 2 Oct 2026). Overlapping covers share the same price moves, so claims cluster: they are not independent samples.`,
  `In-sample: σ in the model price was estimated from closes in the same window (shared/src/volatility.json), so the model premium had the window's volatility in hand.`,
  "The agents trade in reality; the backtest holds a fixed basket for the hold, initialized at the maximum stock share allowed after a buy, so it tests that basket, not the agents' behaviour.",
  clusterCaveat(),
  "Annualised returns scale a 3-month window to a year; they are arithmetic on this window, not a forecast, and are large because 1% to 4% premiums are charged on 30-day covers that mostly expired without a claim.",
  heartbeatCaveat(),
  "Hypothetical covers on real prices: none of these covers was sold. Testnet, unaudited. A capped, fully backed protection bond, not regulated insurance.",
];

const result = {
  version: 1,
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  script: "npx tsx scripts/backtest.ts",
  label: "Backtest: hypothetical covers on real Chainlink prices. No cover here was sold.",
  source: {
    provider: "Chainlink Data Feeds",
    chain: "Robinhood Chain mainnet",
    chainId: 4663,
    rpc: RPC,
    block: loaded.block,
    feeds: feedInfo,
  },
  window: {
    from: isoS(dataStart),
    to: isoS(WINDOW_END),
    tradingDays: closes.length,
    firstOpen: opens[0]?.openedOn,
    lastOpen: opens[opens.length - 1]?.openedOn,
    opensSkippedForStalePrices: [...allSkipped],
  },
  parameters: {
    principalPerCover: usdg(PRINCIPAL),
    limitBps: LIMIT_BPS,
    capBps: CAP_BPS,
    holdDays: HOLD_DAYS,
    maxPriceAgeSeconds: MAX_PRICE_AGE_S,
    spreadBps: SPREAD_BPS,
    model: {
      sigma: sigma.sigma,
      sigmaAsset: sigma.symbol,
      termDays: PRICING_MODEL.termDays,
      volatilityWindow: VOLATILITY.window,
    },
  },
  assumptions,
  caveats,
  agents: agentsOut,
  sensitivity: sensitivityOut,
};

mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify(result, null, 2) + "\n");
writeFileSync(MD_OUT, markdown(result));
console.log(`wrote ${relative(ROOT, JSON_OUT)} and ${relative(ROOT, MD_OUT)}`);
for (const a of agentsOut) {
  console.log(
    `${a.name}: ${a.covers} covers, ${a.claims} claims, payouts ${a.payouts} USDG; ` +
      `fee premiums ${a.offerFee.premiums} (loss ratio ${a.offerFee.lossRatio}), ` +
      `model premiums ${a.modelPrice.premiums} (loss ratio ${a.modelPrice.lossRatio}); breakeven ${a.breakevenBps} bps`,
  );
}

// ------------------------------------------------------------------ BACKTEST.md

function markdown(r: typeof result): string {
  const fmt = (x: number, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (x: number | null, d = 1) => (x === null ? "n/a" : `${fmt(x * 100, d)}%`);
  const [careful, bold] = r.agents;
  const rows = (pick: (a: (typeof r.agents)[number]) => string) => r.agents.map(pick).join(" | ");
  const claimRows = r.agents.flatMap((a) =>
    a.claimsList.map(
      (c) =>
        `| ${a.name} | ${c.openedOn} | ${c.settledAt.replace("T", " ").replace("Z", " UTC")} | ${c.trigger.symbol} round ${c.trigger.round} | ` +
        `${fmt(c.hoursSincePreviousRound, 1)} h | ${fmt(c.loss)} (${fmt(c.lossBps)} bps) | ${fmt(c.limit)} | ${fmt(c.payout)}${c.capped ? " (cap)" : ""} | ${fmt(c.userLoss)} |`,
    ),
  );
  const sens = r.sensitivity.map(
    (v) =>
      `| ${AGENTS[v.agent as AgentKey].name} | ${v.change} | ${v.covers} | ${v.claims} | ${fmt(v.payouts)} | ${fmt(v.breakevenBps, 1)} | ` +
      `${pct(v.offerFee.lossRatio)} | ${fmt(v.modelPrice.fairBps, 1)} | ${pct(v.modelPrice.lossRatio)} |`,
  );
  const f = r.source.feeds as Record<string, any>;
  return `# Backtest: Careful and Bold on real Chainlink prices

> Generated by \`${r.script}\` on ${r.generatedAt} from Robinhood Chain mainnet block ${r.source.block}. Do not edit
> by hand: change the script and rerun it. The same numbers are in [data/backtest.json](data/backtest.json) for the site.
>
> **Hypothetical covers on real prices.** None of these covers was sold. Testnet, unaudited. A capped, fully backed
> protection bond, not regulated insurance.

## The question

If an underwriter had sold a Bondline cover behind each agent's rules at every market close since the Chainlink
feeds started in June, what would the claims, premiums and payouts have been? A buy must leave stocks at or below the
account's stock-share limit: Careful 30%, Bold 80%. Price changes can subsequently move that share above the limit.
Payout liability is capped and reserved independently. Each simulated cover holds a basket initialized at 30%/80%
stocks. The simulation uses the same payout and reservation formulas, the same loss limit and the same feed history;
it does not execute the Solidity contracts.

## Result (${LIMIT_BPS / 100}% limit, ${HOLD_DAYS}-day hold, 1,000 USDG principal per cover)

| | ${rows((a) => `${a.name} (basket initialized at ${a.stockShareBps / 100}% stocks)`)} |
|---|---|---|
| Covers opened | ${rows((a) => `${a.covers}`)} |
| Claims paid | ${rows((a) => `${a.claims} (${pct(a.claimRate)})`)} |
| Payouts | ${rows((a) => `${fmt(a.payouts)} USDG`)} |
| Average / largest payout | ${rows((a) => (a.claims ? `${fmt(a.averagePayout)} / ${fmt(a.largestPayout)} USDG` : "none"))} |
| Break-even premium (payouts ÷ principal covered) | ${rows((a) => `${fmt(a.breakevenBps, 1)} bps`)} |
| **At the offer's fee** | ${rows((a) => `**${a.offerFee.feeBps / 100}% of the deposit**`)} |
| Premiums | ${rows((a) => `${fmt(a.offerFee.premiums)} USDG (${fmt(a.offerFee.premiumPerCover)} per cover)`)} |
| Loss ratio (payouts ÷ premiums) | ${rows((a) => pct(a.offerFee.lossRatio))} |
| Underwriter net (premiums − payouts) | ${rows((a) => `${fmt(a.offerFee.net)} USDG`)} |
| Return on reserve locked, per cover | ${rows((a) => pct(a.offerFee.returnOnReserve, 2))} |
| Return on reserve, annualised | ${rows((a) => pct(a.offerFee.annualisedReturnOnReserve))} |
| **At the model's reference price** | ${rows((a) => `**${fmt(a.modelPrice.fairBps, 1)} bps of principal**`)} |
| Premiums | ${rows((a) => `${fmt(a.modelPrice.premiums)} USDG (${fmt(a.modelPrice.premiumPerCover)} per cover)`)} |
| Loss ratio | ${rows((a) => pct(a.modelPrice.lossRatio))} |
| Underwriter net | ${rows((a) => `${fmt(a.modelPrice.net)} USDG`)} |
| Return on reserve locked, per cover | ${rows((a) => pct(a.modelPrice.returnOnReserve, 2))} |
| Return on reserve, annualised | ${rows((a) => pct(a.modelPrice.annualisedReturnOnReserve))} |
| Reserve per cover / most locked at once | ${rows((a) => `${fmt(a.reserve.perCover)} / ${fmt(a.reserve.peakReserve)} USDG (${a.reserve.peakCoversOpen} covers)`)} |
| Average days held | ${rows((a) => fmt(a.reserve.averageDaysHeld))} |
| Worst loss during a cover: median / max | ${rows((a) => `${fmt(a.worstLossBps.median / 100)}% / ${fmt(a.worstLossBps.max / 100)}%`)} |

How to read it: the break-even premium is what the payouts cost per unit of principal covered. A premium above it
made money in this window; below it lost money. Careful's break-even was ${fmt(careful.breakevenBps, 1)} bps against a
${careful.offerFee.feeBps / 100}% fee and a ${fmt(careful.modelPrice.fairBps, 1)} bps model price; Bold's was
${fmt(bold.breakevenBps, 1)} bps against a ${bold.offerFee.feeBps / 100}% fee and a ${fmt(bold.modelPrice.fairBps, 1)} bps model price.

## Claims

${claimRows.length ? `Every claim, in order. "Since previous round" is how long the trigger feed had been silent before the round that
settled the cover: a long silence means the price gapped (overnight or over a weekend) instead of sliding.

| Agent | Opened | Settled | Trigger | Since previous round | Loss | Limit | Payout | User's loss |
|---|---|---|---|---|---|---|---|---|
${claimRows.join("\n")}

The user's loss is the limit, as the contract promises, unless the drop passed 30%. After a settle the agent is
stopped; the stocks stay in the account and keep moving, so what the user finally ends with depends on when they
sweep.` : "No cover paid out in this window."}

## Sensitivity

One change at a time from the main run above (same opens, same prices). The model's price changes with the limit;
the offers' fees don't.

| Agent | Change | Covers | Claims | Payouts (USDG) | Break-even (bps) | Loss ratio at the fee | Model price (bps) | Loss ratio at the model price |
|---|---|---|---|---|---|---|---|---|
${sens.join("\n")}

"Held until the window ends" keeps every cover open until 2 Oct instead of closing it after 30 days. The contract
charges the premium once per deposit while cover runs until the user closes it or it pays out, so a longer hold is
more risk for the same premium. That is why the board quotes 30 days and why fixed-term covers are roadmap item 2.

## Every assumption

${r.assumptions.map((a) => `- ${a}`).join("\n")}

## Caveats

${r.caveats.map((c) => `- ${c}`).join("\n")}

## Source data

| Feed (Robinhood Chain mainnet) | Description | Rounds read | Skipped (unit error) | Used | First used | Last used |
|---|---|---|---|---|---|---|
${Object.entries(f)
  .map(
    ([sym, x]) =>
      `| ${sym} \`${x.address}\` | ${x.description} | ${x.roundsRead} | ${x.roundsSkippedAsUnitError} (rounds ${x.skippedRounds}) | ${x.roundsUsed} | ` +
      `round ${x.firstRoundUsed.round}, ${x.firstRoundUsed.updatedAt} | round ${x.lastRoundUsed.round}, ${x.lastRoundUsed.updatedAt} |`,
  )
  .join("\n")}

Window: ${r.window.from} to ${r.window.to}, ${r.window.tradingDays} trading days; covers opened ${r.window.firstOpen} to ${r.window.lastOpen}.
${r.window.opensSkippedForStalePrices.length ? `Closes skipped because a price was older than the max price age: ${r.window.opensSkippedForStalePrices.join(", ")}.` : "No close was skipped for a stale price."}

## Reproduce

\`\`\`
npx tsx scripts/backtest.ts                        # reads the rounds from Robinhood Chain mainnet (read-only)
npx tsx scripts/backtest.ts --save-rounds r.json   # also keeps the rounds, to rerun offline with --rounds r.json
\`\`\`

The model is in [PRICING.md](PRICING.md); the contract math in [TECHNICAL.md](TECHNICAL.md).
`;
}
