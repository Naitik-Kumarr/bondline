// Unit tests for the agent record's pure logic, on synthetic events. Run: npx tsx --test shared/src/record.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import { priceCover } from "./pricing.ts";
import {
  buildRecord,
  percentile,
  recordSummary,
  scoreRecord,
  upsertIndex,
  type AccountRules,
  type RecordEvent,
  type RecordsIndex,
} from "./record.ts";

// ------------------------------------------------------------------ fixtures

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const big = (x: number | string) => BigInt(x);
const usdg = (x: number) => BigInt(Math.round(x * 1e6));
const px = (x: number) => BigInt(Math.round(x * 1e8));
/** Stock units (18 decimals) bought with `usd` at `price`, as PriceMath.stockForUsd. */
const stockFor = (usd: bigint, price: bigint) => (usd * big("100000000000000000000")) / price;

const AGENT = addr(0xa1);
const OTHER = addr(0xb2);
const UNDERWRITER = addr(0xc3);
const USER = addr(0xd4);
const COVER = addr(0x100);
const OTHER_COVER = addr(0x200);
const ACCOUNT = addr(0x101);
const OTHER_ACCOUNT = addr(0x201);
const TSLA = addr(0x7e51a);
const AMZN = addr(0xa3a2);
const FEED_TSLA = addr(0xf1);
const MARKET_ASSETS = {
  replay: [
    { address: TSLA, symbol: "TSLA" as const },
    { address: AMZN, symbol: "AMZN" as const },
  ],
  live: [
    { address: TSLA, symbol: "TSLA" as const },
    { address: AMZN, symbol: "AMZN" as const },
  ],
};
const SIGMA = { TSLA: 0.5, AMZN: 0.3 };
const RULES = (maxStockBps: number, assetMask = 3): AccountRules => ({
  assetMask,
  maxStockBps,
  maxTradeBps: 5000,
  maxDailyBps: 20_000,
  maxSlippageBps: 100,
  maxPriceAge: 300,
});

let block = 0;
let tx = 0;
const at = (market: "live" | "replay" = "replay") => {
  block += 1;
  tx += 1;
  return { market, blockNumber: block, logIndex: 0, txHash: hash(tx), timestamp: 1_800_000_000 + block * 60 };
};
const offer = (id: number, cover: Address, agent: Address, maxStockBps: number, market: "live" | "replay" = "replay"): RecordEvent => ({
  ...at(market),
  type: "OfferCreated",
  id,
  cover,
  underwriter: UNDERWRITER,
  agent,
  terms: { minLimitBps: 500, maxLimitBps: 2000, feeBps: 400, maxStockBps, name: `offer ${id}` },
});
const opened = (cover: Address, account: Address, limitBps: number, rules: AccountRules): RecordEvent => ({
  ...at(),
  type: "Opened",
  cover,
  account,
  user: USER,
  limitBps,
  rules,
});
const deposited = (cover: Address, account: Address, amount: number, feeBps: number): RecordEvent => {
  const a = usdg(amount);
  const fee = (a * big(feeBps)) / big(10_000);
  return { ...at(), type: "Deposited", cover, account, from: USER, amount: a, fee, net: a - fee, reserveAdded: ZERO_N };
};
const ZERO_N = big(0);
const price = (asset: Address, p: number, market: "live" | "replay" = "replay"): RecordEvent => ({
  ...at(market),
  type: "AnswerUpdated",
  feed: FEED_TSLA,
  asset,
  answer: px(p),
  roundId: big(block),
  updatedAt: 1_800_000_000 + block * 60,
});

// ------------------------------------------------------------------ percentile

test("percentile: nearest rank", () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([7], 0.95), 7);
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(hundred, 0.95), 95);
  assert.equal(percentile(hundred, 0.5), 50);
  assert.equal(percentile(hundred, 1), 100);
  assert.equal(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.95), 19);
  assert.equal(percentile(Array.from({ length: 60 }, (_, i) => i + 1), 0.95), 57); // 0.95 × 60 is 57, not 58
  assert.equal(percentile([0.3, 0.1, 0.2], 0.95), 0.3); // unsorted input
  assert.equal(percentile([0.4, 0.1, 0.2, 0.3], 0.5), 0.2);
  assert.throws(() => percentile([1], 0), RangeError);
  assert.throws(() => percentile([1], 1.5), RangeError);
});

// ------------------------------------------------------------------ score

test("score: no trades means no record", () => {
  const s = scoreRecord({ trades: 0, refusals: 3, exposureP95: null, rulesMax: 0.3, worstDrawdownToLimit: null, accounts: 1, claimedAccounts: 0 });
  assert.equal(s.value, null);
  assert.equal(s.label, "no record");
  assert.deepEqual(s.parts, []);
});

test("score: a clean, long record in cash scores 100", () => {
  const s = scoreRecord({ trades: 80, refusals: 20, exposureP95: 0, rulesMax: 0.3, worstDrawdownToLimit: 0, accounts: 2, claimedAccounts: 0 });
  assert.equal(s.value, 100);
  assert.deepEqual(s.parts.map((p) => p.max), [40, 30, 10, 20]);
});

test("score: each part follows the published formula", () => {
  // exposure 40 × (1 − 0.24/0.30) = 8; drawdown 30 × (1 − 0.5) = 15; claims 10 × (1 − 0/3) = 10; history 20 × 40/100 = 8
  const s = scoreRecord({ trades: 30, refusals: 10, exposureP95: 0.24, rulesMax: 0.3, worstDrawdownToLimit: 0.5, accounts: 3, claimedAccounts: 0 });
  assert.deepEqual(s.parts.map((p) => p.points), [8, 15, 10, 8]);
  assert.equal(s.value, 41);
});

test("score: parts are clamped; a claim zeroes the drawdown part and costs its share of the claims part", () => {
  const s = scoreRecord({ trades: 300, refusals: 0, exposureP95: 0.85, rulesMax: 0.8, worstDrawdownToLimit: 2.5, accounts: 2, claimedAccounts: 1 });
  assert.deepEqual(s.parts.map((p) => p.points), [0, 0, 5, 20]);
  assert.equal(s.value, 25);
  for (const p of s.parts) assert.ok(p.points >= 0 && p.points <= p.max);
});

// ------------------------------------------------------------------ building a record

function gapScenario() {
  block = 0;
  tx = 0;
  const buyUsd = usdg(480);
  const buyPrice = px(400);
  const bought = stockFor(buyUsd, buyPrice); // 1.2 TSLA
  const events: RecordEvent[] = [
    offer(0, COVER, AGENT, 8000),
    offer(1, OTHER_COVER, OTHER, 3000),
    opened(COVER, ACCOUNT, 1000, RULES(8000)),
    deposited(COVER, ACCOUNT, 1000, 400), // net 960
    opened(OTHER_COVER, OTHER_ACCOUNT, 1000, RULES(3000)),
    deposited(OTHER_COVER, OTHER_ACCOUNT, 500, 400),
    price(TSLA, 400), // account all cash: share 0
    {
      ...at(),
      type: "Traded",
      account: ACCOUNT,
      asset: TSLA,
      isBuy: true,
      usdAmount: buyUsd,
      amountIn: buyUsd,
      amountOut: bought,
      price: buyPrice,
      valueAfter: usdg(960),
      stockValueAfter: usdg(480),
      decisionHash: hash(0xdec1),
    }, // share 0.5
    {
      ...at(),
      type: "Blocked",
      account: ACCOUNT,
      asset: TSLA,
      isBuy: true,
      usdAmount: usdg(400),
      reason: 9, // StockShare
      observed: big(9200),
      limit: big(8000),
      decisionHash: hash(0xdec2),
    },
    {
      ...at(),
      type: "Traded",
      account: OTHER_ACCOUNT, // another agent's account: ignored
      asset: TSLA,
      isBuy: true,
      usdAmount: usdg(100),
      amountIn: usdg(100),
      amountOut: stockFor(usdg(100), px(400)),
      price: px(400),
      valueAfter: usdg(480),
      stockValueAfter: usdg(100),
      decisionHash: hash(0xdec3),
    },
    price(TSLA, 360), // 1.2 × 360 = 432 + cash 480 = 912: share 0.4737, drawdown 5%
    price(TSLA, 100, "live"), // another market's feed: ignored for this account
    price(TSLA, 200), // scripted gap: 240 + 480 = 720: share 0.3333, drawdown 25%
    {
      ...at(),
      type: "Settled",
      cover: COVER,
      account: ACCOUNT,
      user: USER,
      caller: addr(0xee),
      value: usdg(720),
      loss: usdg(240),
      limit: usdg(96),
      payout: usdg(144),
    },
    price(TSLA, 210), // after settle: no more observations
  ];
  return events;
}

test("record: trades, refusals, exposure, drawdown, claims, score and both prices from one covered account", () => {
  const r = buildRecord({ agent: AGENT, name: "Bold", chainId: 46630, events: gapScenario(), marketAssets: MARKET_ASSETS, sigma: SIGMA, generatedAt: "2026-10-04T00:00:00Z" });

  assert.equal(r.hasRecord, true);
  assert.equal(r.offers.length, 1);
  assert.equal(r.offers[0].cover, COVER);
  assert.equal(r.accounts.length, 1);
  const a = r.accounts[0];
  assert.equal(a.account, ACCOUNT);
  assert.equal(a.status, "settled");
  assert.equal(a.principalUsd, 960);
  assert.equal(a.depositedUsd, 1000);
  assert.deepEqual(a.assets, ["TSLA", "AMZN"]);

  assert.equal(r.activity.trades, 1);
  assert.equal(r.activity.buys, 1);
  assert.equal(r.activity.refusals, 1);
  assert.deepEqual(r.activity.refusalsByReason, [{ code: 9, key: "StockShare", label: "Would put too much of the account in stocks", count: 1 }]);
  assert.equal(r.activity.volumeUsd, 480);
  assert.deepEqual(r.activity.tradesByAsset, { TSLA: 1 });
  assert.equal(r.activity.decisions, 2);
  assert.equal(r.activity.activeSeconds, 60); // trade and refusal one block (60 s here) apart

  // Observations: 0 (price before the buy), 0.5 (the trade), 432/912, 240/720. Nearest-rank p95 of 4 = the largest.
  assert.equal(r.exposure.observations, 4);
  assert.equal(r.exposure.fromTrades, 1);
  assert.equal(r.exposure.fromPriceUpdates, 3);
  assert.equal(r.exposure.p95, 0.5);
  assert.equal(r.exposure.max, 0.5);
  assert.equal(r.exposure.rulesMax, 0.8);
  assert.equal(r.exposure.rulesMaxSource, "account rules");

  assert.ok(Math.abs(r.drawdown.worst! - 0.25) < 1e-12);
  assert.ok(Math.abs(r.drawdown.worstToLimit! - 2.5) < 1e-12);
  assert.equal(r.drawdown.limitBps, 1000);

  assert.equal(r.claims.count, 1);
  assert.equal(r.claims.paidUsd, 144);
  assert.equal(r.claims.list[0].lossUsd, 240);
  assert.equal(r.claims.list[0].drawdown, 0.25);

  // 40 × (1 − 0.5/0.8) = 15; drawdown 0; claims 0; history 20 × 2/100 = 0.4 → 15
  assert.deepEqual(r.score.parts.map((p) => p.points), [15, 0, 0, 0.4]);
  assert.equal(r.score.value, 15);

  assert.equal(r.prices.limitBps, 1000);
  assert.equal(r.prices.termDays, 30);
  assert.deepEqual({ asset: r.prices.sigma.asset, value: r.prices.sigma.value }, { asset: "TSLA", value: 0.5 });
  const worst = priceCover({ stockShare: 0.8, sigma: 0.5, limit: 0.1 });
  const rec = priceCover({ stockShare: 0.5, sigma: 0.5, limit: 0.1 });
  assert.equal(r.prices.worstCase!.fairBps, worst.bps.fair);
  assert.equal(r.prices.record!.fairBps, rec.bps.fair);
  assert.ok(Math.abs(r.prices.recordSavingBps! - (worst.bps.fair - rec.bps.fair)) < 1e-9);

  assert.deepEqual(r.recent.map((x) => x.type), ["refusal", "trade"]); // newest first
  assert.equal(r.recent[0].reason?.key, "StockShare");
  assert.equal(r.recent[1].asset, "TSLA");
  assert.equal(r.recent[1].usd, 480);

  // JSON-safe: no bigints anywhere.
  assert.doesNotThrow(() => JSON.stringify(r));
});

test("record: event order in the input doesn't matter", () => {
  const events = gapScenario();
  const shuffled = [...events].reverse();
  const a = buildRecord({ agent: AGENT, chainId: 46630, events, marketAssets: MARKET_ASSETS, sigma: SIGMA, generatedAt: "x" });
  const b = buildRecord({ agent: AGENT, chainId: 46630, events: shuffled, marketAssets: MARKET_ASSETS, sigma: SIGMA, generatedAt: "x" });
  assert.deepEqual(a, b);
});

test("record: an agent with an offer but no trades has no record, and its worst case comes from the offer terms", () => {
  block = 0;
  const r = buildRecord({ agent: AGENT, chainId: 46630, events: [offer(0, COVER, AGENT, 3000)], marketAssets: MARKET_ASSETS, sigma: SIGMA });
  assert.equal(r.hasRecord, false);
  assert.equal(r.score.value, null);
  assert.equal(r.score.label, "no record");
  assert.equal(r.exposure.rulesMax, 0.3);
  assert.equal(r.exposure.rulesMaxSource, "offer terms");
  assert.equal(r.prices.worstCase!.stockShare, 0.3);
  assert.equal(r.prices.record, null);
  assert.equal(r.prices.recordSavingBps, null);
  assert.equal(r.prices.sigma.asset, "TSLA"); // the market's most volatile stock
});

test("record: an unknown agent has no offers, no record and no prices", () => {
  const r = buildRecord({ agent: addr(0x999), chainId: 46630, events: gapScenario(), marketAssets: MARKET_ASSETS, sigma: SIGMA });
  assert.equal(r.offers.length, 0);
  assert.equal(r.accounts.length, 0);
  assert.equal(r.hasRecord, false);
  assert.equal(r.prices.worstCase, null);
  assert.equal(r.prices.record, null);
});

test("record: σ is the most volatile stock the account rules allow", () => {
  block = 0;
  const events: RecordEvent[] = [
    offer(0, COVER, AGENT, 3000),
    opened(COVER, ACCOUNT, 1000, RULES(3000, 0b10)), // AMZN only
    deposited(COVER, ACCOUNT, 100, 100),
  ];
  const r = buildRecord({ agent: AGENT, chainId: 46630, events, marketAssets: MARKET_ASSETS, sigma: SIGMA });
  assert.equal(r.prices.sigma.asset, "AMZN");
  assert.equal(r.prices.sigma.value, 0.3);
  assert.deepEqual(r.accounts[0].assets, ["AMZN"]);
});

test("record: sells, withdrawals and revaluations use the holdings implied by trades", () => {
  block = 0;
  const p = px(250);
  const bought = stockFor(usdg(300), p); // 1.2 AMZN
  const events: RecordEvent[] = [
    offer(0, COVER, AGENT, 3000),
    opened(COVER, ACCOUNT, 1500, RULES(3000)),
    deposited(COVER, ACCOUNT, 1000, 0),
    {
      ...at(),
      type: "Traded",
      account: ACCOUNT,
      asset: AMZN,
      isBuy: true,
      usdAmount: usdg(300),
      amountIn: usdg(300),
      amountOut: bought,
      price: p,
      valueAfter: usdg(1000),
      stockValueAfter: usdg(300),
      decisionHash: hash(1),
    },
    price(AMZN, 300), // 1.2 × 300 = 360 + 700 cash = 1060: share 360/1060
    { ...at(), type: "Withdrawn", cover: COVER, account: ACCOUNT, user: USER, amount: usdg(106), principal: usdg(900), reserve: ZERO_N },
    price(AMZN, 200), // 240 + 594 = 834 against principal 900: drawdown 66/900
    {
      ...at(),
      type: "Traded",
      account: ACCOUNT,
      asset: AMZN,
      isBuy: false,
      usdAmount: usdg(240),
      amountIn: bought,
      amountOut: usdg(240),
      price: px(200),
      valueAfter: usdg(834),
      stockValueAfter: ZERO_N,
      decisionHash: hash(2),
    },
    price(AMZN, 210), // all cash again: share 0
    { ...at(), type: "Closed", cover: COVER, account: ACCOUNT, user: USER },
    price(AMZN, 220), // closed: ignored
  ];
  const r = buildRecord({ agent: AGENT, chainId: 46630, events, marketAssets: MARKET_ASSETS, sigma: SIGMA });
  const a = r.accounts[0];
  assert.equal(a.status, "closed");
  assert.equal(a.principalUsd, 900);
  assert.equal(a.withdrawnUsd, 106);
  assert.equal(r.activity.buys, 1);
  assert.equal(r.activity.sells, 1);
  // shares: 0.3 (buy), 360/1060, 240/834, 0 (sell), 0 (price after sell)
  assert.equal(r.exposure.observations, 5);
  assert.ok(Math.abs(r.exposure.max! - 360 / 1060) < 1e-12);
  assert.ok(Math.abs(r.drawdown.worst! - 66 / 900) < 1e-12);
  assert.ok(Math.abs(r.drawdown.worstToLimit! - 66 / 900 / 0.15) < 1e-12);
  assert.equal(r.claims.count, 0);
});

test("record: a refused 'sell everything' shows no dollar amount", () => {
  block = 0;
  const events: RecordEvent[] = [
    offer(0, COVER, AGENT, 3000),
    opened(COVER, ACCOUNT, 1000, RULES(3000)),
    {
      ...at(),
      type: "Blocked",
      account: ACCOUNT,
      asset: TSLA,
      isBuy: false,
      usdAmount: (big(1) << big(256)) - big(1),
      reason: 8,
      observed: big(1),
      limit: ZERO_N,
      decisionHash: hash(3),
    },
  ];
  const r = buildRecord({ agent: AGENT, chainId: 46630, events, marketAssets: MARKET_ASSETS, sigma: SIGMA });
  assert.equal(r.recent[0].usd, null);
  assert.equal(r.recent[0].reason?.key, "InsufficientStock");
  assert.equal(r.hasRecord, false); // refusals alone aren't a record
});

// ------------------------------------------------------------------ the index

test("index: upsert replaces an agent's entry and ranks by score, no record last", () => {
  const scored = buildRecord({ agent: AGENT, name: "Bold", chainId: 46630, events: gapScenario(), marketAssets: MARKET_ASSETS, sigma: SIGMA, generatedAt: "t1" });
  block = 0;
  const none = buildRecord({ agent: OTHER, chainId: 46630, events: [offer(0, OTHER_COVER, OTHER, 3000)], marketAssets: MARKET_ASSETS, sigma: SIGMA, generatedAt: "t1" });
  let index: RecordsIndex = { version: 1, generatedAt: null, chainId: 46630, agents: [] };
  index = upsertIndex(index, recordSummary(none), "t1");
  index = upsertIndex(index, recordSummary(scored), "t2");
  assert.deepEqual(index.agents.map((a) => a.agent), [AGENT, OTHER]);
  assert.equal(index.generatedAt, "t2");
  const s = index.agents[0];
  assert.equal(s.file, `${AGENT.toLowerCase()}.json`);
  assert.equal(s.score, 15);
  assert.equal(s.claims, 1);
  assert.equal(s.worstCaseBps, scored.prices.worstCase!.fairBps);
  assert.equal(s.recordBps, scored.prices.record!.fairBps);
  index = upsertIndex(index, { ...recordSummary(scored), score: 70 }, "t3");
  assert.equal(index.agents.length, 2);
  assert.equal(index.agents[0].score, 70);
});
