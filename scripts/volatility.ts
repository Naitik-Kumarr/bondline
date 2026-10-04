// Computes the annualised realised volatility (σ) of TSLA and AMZN from Chainlink's own round history on
// Robinhood Chain mainnet, and writes shared/src/volatility.json, the σ input of Bondline's reference price.
//
//   npx tsx scripts/volatility.ts
//
// Method (also written into the JSON):
//   1. Walk back every round of each feed with getRoundData, from latestRoundData down to round 1 of the
//      current phase (and through earlier phases, if any). The round id is (phaseId << 64) | aggregatorRound.
//   2. Daily close = the feed's answer at 16:00 New York time on each NYSE trading day, i.e. the last round
//      updated at or before the close (13:00 on early-close days).
//   3. Keep the longest window in which every close comes from a round at most 26 hours old (24-hour heartbeat
//      plus slack) and no round is missing.
//   4. σ = sample standard deviation of the daily log returns × √252.
//
// Read-only. Sends a user-agent, at most 10 calls per HTTP batch, one request at a time, and backs off on 429.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { robinhoodMainnet } from "../shared/src/chain.ts";
import { MAINNET_FEEDS, STOCK_SYMBOLS, type StockSymbol } from "../shared/src/constants.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "shared", "src", "volatility.json");

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const USER_AGENT = "bondline-volatility/0.1 (read-only; hackathon research)";
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const ROUNDS_PER_MULTICALL = 100;
const MIN_REQUEST_GAP_MS = 250;

const TRADING_DAYS_PER_YEAR = 252;
const MAX_CLOSE_AGE_S = 26 * 3600;

/** NYSE full-day closures and 13:00 early closes (nyse.com, "Holidays & Trading Hours"). */
const NYSE_HOLIDAYS = new Set([
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04",
  "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
  "2026-11-26", "2026-12-25",
]);
const NYSE_EARLY_CLOSES = new Set(["2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24"]);

const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function phaseId() view returns (uint16)",
  "function phaseAggregators(uint16 phaseId) view returns (address)",
  "function aggregator() view returns (address)",
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRound() view returns (uint256)",
]);

// ------------------------------------------------------------------ polite RPC

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/** One request at a time, a short gap between requests, and exponential backoff (or Retry-After) on HTTP 429. */
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

// ------------------------------------------------------------------ rounds

interface Round {
  roundId: bigint;
  phase: number;
  aggregatorRound: bigint;
  answer: bigint;
  updatedAt: number;
}

const PHASE_SHIFT = 64n;
const AGG_MASK = (1n << PHASE_SHIFT) - 1n;

async function readRounds(feed: Address, phase: number, fromRound: bigint): Promise<Round[]> {
  const rounds: Round[] = [];
  for (let top = fromRound; top >= 1n; top -= BigInt(ROUNDS_PER_MULTICALL)) {
    const ids: bigint[] = [];
    for (let r = top; r >= 1n && r > top - BigInt(ROUNDS_PER_MULTICALL); r--) ids.push((BigInt(phase) << PHASE_SHIFT) | r);
    const results = await client.multicall({
      multicallAddress: MULTICALL3,
      allowFailure: true,
      batchSize: 0, // one aggregate3 call per chunk
      contracts: ids.map((id) => ({ address: feed, abi: feedAbi, functionName: "getRoundData" as const, args: [id] as const })),
    });
    for (let i = 0; i < ids.length; i++) {
      const res = results[i];
      if (res.status !== "success" || res.result[3] === 0n) {
        console.log(`  phase ${phase}: no data below round ${ids[i] & AGG_MASK} + 1; stopping`);
        return rounds;
      }
      const [roundId, answer, , updatedAt] = res.result;
      rounds.push({ roundId, phase, aggregatorRound: roundId & AGG_MASK, answer, updatedAt: Number(updatedAt) });
    }
    process.stdout.write(`  phase ${phase}: read down to round ${ids[ids.length - 1] & AGG_MASK}\r`);
  }
  process.stdout.write("\n");
  return rounds;
}

async function readFeed(symbol: StockSymbol) {
  const feed = MAINNET_FEEDS[symbol];
  const [latest, phaseId, description, decimals, aggregator] = await Promise.all([
    client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "phaseId" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "description" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
    client.readContract({ address: feed, abi: feedAbi, functionName: "aggregator" }),
  ]);
  const latestPhase = Number(latest[0] >> PHASE_SHIFT);
  if (latestPhase !== phaseId) throw new Error(`${symbol}: latest round's phase ${latestPhase} != phaseId ${phaseId}`);
  console.log(`${symbol} ${description}: phase ${phaseId}, latest round ${latest[0] & AGG_MASK}`);

  const rounds: Round[] = [];
  const phases: { phase: number; aggregator: Address; latestRound: bigint; rounds: number }[] = [];
  for (let phase = phaseId; phase >= 1; phase--) {
    let top: bigint;
    let agg: Address;
    if (phase === phaseId) {
      top = latest[0] & AGG_MASK;
      agg = aggregator;
    } else {
      agg = await client.readContract({ address: feed, abi: feedAbi, functionName: "phaseAggregators", args: [phase] });
      if (/^0x0{40}$/i.test(agg)) continue;
      top = await client.readContract({ address: agg, abi: feedAbi, functionName: "latestRound" });
    }
    const got = await readRounds(feed, phase, top);
    phases.push({ phase, aggregator: agg, latestRound: top, rounds: got.length });
    rounds.push(...got);
  }
  rounds.sort((a, b) => a.updatedAt - b.updatedAt || (a.roundId < b.roundId ? -1 : 1));
  return { feed, description, decimals, phaseId, phases, rounds };
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

/** The UTC instant of hh:00 New York time on `date` (YYYY-MM-DD), whichever of EDT/EST applies. */
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
  const start = nyLocal(fromTs).date;
  const end = nyLocal(toTs).date;
  for (let t = Date.parse(`${start}T12:00:00Z`); ; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (date > end) break;
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6 || NYSE_HOLIDAYS.has(date)) continue;
    days.push(date);
  }
  return days;
}

// ------------------------------------------------------------------ statistics

/**
 * A scale break: two consecutive rounds more than 10× apart. No stock moves 10× between two updates, so this is a
 * unit error in the feed (its first rounds reported 16-decimal answers while `decimals()` says 8).
 */
interface ScaleBreak {
  index: number;
  before: Round;
  after: Round;
  factor: number;
}

function scaleBreaks(rounds: Round[]): ScaleBreak[] {
  const breaks: ScaleBreak[] = [];
  for (let i = 1; i < rounds.length; i++) {
    const factor = Number(rounds[i - 1].answer) / Number(rounds[i].answer);
    if (factor > 10 || factor < 0.1) breaks.push({ index: i, before: rounds[i - 1], after: rounds[i], factor });
  }
  return breaks;
}

interface Close {
  date: string;
  closeAt: number;
  answer: bigint;
  roundId: bigint;
  updatedAt: number;
  ageSeconds: number;
  /** Which run of consistently scaled rounds the close comes from. */
  segment: number;
}

function dailyCloses(rounds: Round[], breaks: ScaleBreak[]): Close[] {
  const days = tradingDays(rounds[0].updatedAt, rounds[rounds.length - 1].updatedAt);
  const closes: Close[] = [];
  let i = 0;
  for (const date of days) {
    const closeAt = nyTime(date, NYSE_EARLY_CLOSES.has(date) ? 13 : 16);
    if (closeAt > Date.now() / 1000) break; // not closed yet
    while (i + 1 < rounds.length && rounds[i + 1].updatedAt <= closeAt) i++;
    const r = rounds[i];
    if (r.updatedAt > closeAt) continue; // the feed had not started yet
    const segment = breaks.filter((b) => b.index <= i).length;
    closes.push({ date, closeAt, answer: r.answer, roundId: r.roundId, updatedAt: r.updatedAt, ageSeconds: closeAt - r.updatedAt, segment });
  }
  return closes;
}

/**
 * The longest run of consecutive trading-day closes in which every close is at most MAX_CLOSE_AGE_S old and all
 * come from the same consistently scaled segment of rounds.
 */
function cleanWindow(closes: Close[]): Close[] {
  let best: Close[] = [];
  let run: Close[] = [];
  for (const c of closes) {
    if (c.ageSeconds > MAX_CLOSE_AGE_S) {
      run = [];
      continue;
    }
    if (run.length > 0 && run[run.length - 1].segment !== c.segment) run = [];
    run.push(c);
    if (run.length > best.length) best = [...run];
  }
  return best;
}

/** Wilson–Hilferty approximation of the chi-square quantile with k degrees of freedom at normal quantile z. */
const chiSquareQuantile = (k: number, z: number) => k * (1 - 2 / (9 * k) + z * Math.sqrt(2 / (9 * k))) ** 3;

function realisedVolatility(closes: Close[], decimals: number) {
  const scale = 10 ** decimals;
  const prices = closes.map((c) => Number(c.answer) / scale);
  const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  const n = returns.length;
  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
  const daily = Math.sqrt(variance);
  const annual = daily * Math.sqrt(TRADING_DAYS_PER_YEAR);
  // 95% interval for σ, assuming independent normal returns (fat tails make the true range wider).
  const lo = annual * Math.sqrt((n - 1) / chiSquareQuantile(n - 1, 1.959964));
  const hi = annual * Math.sqrt((n - 1) / chiSquareQuantile(n - 1, -1.959964));
  const order = returns.map((r, i) => i).sort((a, b) => Math.abs(returns[b]) - Math.abs(returns[a]));
  return {
    returns: n,
    daily,
    annual,
    ci95: [lo, hi] as const,
    meanDaily: mean,
    largestMoves: order.slice(0, 3).map((i) => ({ date: closes[i + 1].date, logReturn: returns[i] })),
  };
}

// ------------------------------------------------------------------ main

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
const dumpAt = process.argv.indexOf("--dump");
const dumpPath = dumpAt > 0 ? process.argv[dumpAt + 1] : undefined;

const blockNumber = await client.getBlockNumber();
console.log(`Robinhood Chain mainnet block ${blockNumber}`);

const assets: Record<string, unknown> = {};
const sigmas: Partial<Record<StockSymbol, number>> = {};
const notes: string[] = [];
const dump: Record<string, unknown> = {};
let shortest = Infinity;
let windowFrom = "";
let windowTo = "";

for (const symbol of STOCK_SYMBOLS) {
  const f = await readFeed(symbol);
  const { rounds } = f;
  for (let i = 1; i < rounds.length; i++) {
    if (rounds[i].updatedAt < rounds[i - 1].updatedAt) throw new Error(`${symbol}: timestamps out of order`);
    if (rounds[i].answer <= 0n) throw new Error(`${symbol}: non-positive answer in round ${rounds[i].roundId}`);
  }
  if (dumpPath) {
    dump[symbol] = rounds.map((r) => ({ round: Number(r.aggregatorRound), answer: r.answer.toString(), updatedAt: iso(r.updatedAt) }));
  }
  const missing = f.phases.reduce((s, p) => s + Number(p.latestRound) - p.rounds, 0);
  const breaks = scaleBreaks(rounds);
  const closes = dailyCloses(rounds, breaks);
  const window = cleanWindow(closes);
  if (window.length < 2) throw new Error(`${symbol}: not enough clean closes`);
  const v = realisedVolatility(window, f.decimals);
  sigmas[symbol] = round4(v.annual);
  shortest = Math.min(shortest, v.returns);
  if (!windowFrom || window[0].date > windowFrom) windowFrom = window[0].date;
  if (!windowTo || window[window.length - 1].date < windowTo) windowTo = window[window.length - 1].date;
  const maxAge = Math.max(...window.map((c) => c.ageSeconds));
  for (const b of breaks) {
    const power = Math.round(Math.log10(b.factor > 1 ? b.factor : 1 / b.factor));
    notes.push(
      `${symbol}: rounds up to ${b.before.aggregatorRound} (the last at ${iso(b.before.updatedAt)}) are about ` +
        `10^${power} times ${b.factor > 1 ? "larger" : "smaller"} than round ${b.after.aggregatorRound} onward: a unit ` +
        `error in the feed, not a price move. No return spans it, so the window starts at the next close.`,
    );
  }
  console.log(
    `${symbol}: ${rounds.length} rounds, ${breaks.length} scale break(s), ${closes.length} closes ` +
      `(clean ${window.length}: ${window[0].date} to ${window[window.length - 1].date}), ${v.returns} returns, ` +
      `σ = ${(v.annual * 100).toFixed(2)}% (95% ${(v.ci95[0] * 100).toFixed(1)}–${(v.ci95[1] * 100).toFixed(1)}%), ` +
      `oldest close ${(maxAge / 3600).toFixed(1)} h, largest moves ${v.largestMoves.map((m) => `${m.date} ${(m.logReturn * 100).toFixed(1)}%`).join(", ")}`,
  );
  assets[symbol] = {
    feed: f.feed,
    description: f.description,
    decimals: f.decimals,
    phases: f.phases.map((p) => ({ phase: p.phase, aggregator: p.aggregator, latestRound: Number(p.latestRound), roundsRead: p.rounds })),
    missingRounds: missing,
    firstRound: { roundId: rounds[0].roundId.toString(), rawAnswer: rounds[0].answer.toString(), updatedAt: iso(rounds[0].updatedAt) },
    latestRound: {
      roundId: rounds[rounds.length - 1].roundId.toString(),
      rawAnswer: rounds[rounds.length - 1].answer.toString(),
      updatedAt: iso(rounds[rounds.length - 1].updatedAt),
    },
    scaleBreaks: breaks.map((b) => ({
      lastBadRound: Number(b.before.aggregatorRound),
      lastBadAt: iso(b.before.updatedAt),
      firstGoodRound: Number(b.after.aggregatorRound),
      firstGoodAt: iso(b.after.updatedAt),
      factor: Number(b.factor.toPrecision(4)),
    })),
    window: {
      from: window[0].date,
      to: window[window.length - 1].date,
      closes: window.length,
      returns: v.returns,
      tradingDayClosesInHistory: closes.length,
      oldestCloseHours: round4(maxAge / 3600),
    },
    sigma: round4(v.annual),
    sigmaDaily: round6(v.daily),
    ci95: [round4(v.ci95[0]), round4(v.ci95[1])],
    meanDailyLogReturn: round6(v.meanDaily),
    largestMoves: v.largestMoves.map((m) => ({ date: m.date, logReturn: round6(m.logReturn) })),
    closes: window.map((c) => ({ date: c.date, price: Number(c.answer) / 10 ** f.decimals, roundUpdatedAt: iso(c.updatedAt) })),
  };
}

if (dumpPath) writeFileSync(dumpPath, JSON.stringify(dump, null, 1));

const mostVolatile = (Object.entries(sigmas) as [StockSymbol, number][]).sort((a, b) => b[1] - a[1])[0][0];
const months = ((Date.parse(windowTo) - Date.parse(windowFrom)) / (86_400_000 * 30.44)).toFixed(1);

const out = {
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  summary:
    "Annualised realised volatility of TSLA and AMZN, from Chainlink's own price history on Robinhood Chain mainnet. " +
    "σ of the most volatile allowed stock is the σ input of Bondline's reference price.",
  source: {
    provider: "Chainlink Data Feeds",
    chain: "Robinhood Chain mainnet",
    chainId: robinhoodMainnet.id,
    rpc: RPC,
    block: blockNumber.toString(),
    script: "scripts/volatility.ts",
  },
  method: {
    rounds: "Every round walked back with getRoundData from latestRoundData; round id = (phaseId << 64) | aggregator round.",
    close:
      "The feed's answer at 16:00 New York time (the NYSE close; 13:00 on early-close days) on each NYSE trading day: " +
      "the last round updated at or before the close.",
    tradingDays: "Weekdays except NYSE holidays (nyse.com, Holidays & Trading Hours).",
    returns: "Daily log returns of closes: ln(close_t / close_t-1).",
    estimator: "Sample standard deviation (n - 1) of the daily log returns, times √252.",
    annualisation: TRADING_DAYS_PER_YEAR,
    cleanWindow:
      "The longest run of trading days in which every close comes from a round at most 26 hours old (the feeds' " +
      "24-hour heartbeat plus slack) and from the same consistently scaled run of rounds (no 10x jump between two " +
      "consecutive rounds).",
    ci95: "95% interval for σ from the chi-square distribution (Wilson–Hilferty), assuming independent normal returns.",
  },
  sigma: sigmas,
  mostVolatile,
  window: { from: windowFrom, to: windowTo, returns: shortest },
  assets,
  caveats: [
    `Short history: the feeds started on 22 June 2026 and the clean window runs ${windowFrom} to ${windowTo} ` +
      `(${months} months), so each σ rests on ${shortest} daily returns. The 95% intervals show how loose that is.`,
    ...notes,
    "A close is the feed's last update before 16:00 New York time. The feeds update on a 0.5% move or every 24 hours, " +
      "so a close can differ from the exchange's official close by up to about 0.5%. This adds a little noise.",
    "Realised volatility looks back. It is not a forecast, and it says nothing about jumps bigger than those in the window.",
  ],
};

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${OUT.replace(ROOT + "/", "")}: σ ${JSON.stringify(sigmas)}, most volatile ${mostVolatile}, window ${windowFrom}..${windowTo}`);
