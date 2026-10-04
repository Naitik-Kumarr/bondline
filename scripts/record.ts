// Rebuilds an agent's public record from chain events on both Bondline markets, and writes it as static JSON the
// site imports at build time: shared/src/records/<agent>.json, plus a summary in shared/src/records/index.json.
//
//   npm run record <agent> [<agent> ...]      agent: an address, or a team wallet's role ("careful", "bold")
//
// What it reads, per market (Live and Replay), from the market's deployBlock to the head, in 10k-block chunks:
//   1. OfferCreated on the market            -> the offers (covers) whose terms.agent is this agent
//   2. Opened/Deposited/Withdrawn/Settled/Closed on those covers  -> the agent's covered accounts and claims
//   3. Traded/Blocked on those accounts, AnswerUpdated on the market's feeds -> trades, refusals, revaluations
// The arithmetic (exposure, drawdown, score, prices) is in shared/src/record.ts and docs/PRICING.md.
//
// Optional env, for testing against a local chain: BONDLINE_RPC_URL, BONDLINE_DEPLOYMENT (a deployment JSON with the
// shape of shared/src/deployment.json), BONDLINE_RECORDS_DIR (where to write).
// Read-only. Sends a user-agent, at most 10 calls per HTTP batch, one request at a time, and backs off on 429.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  decodeFunctionData,
  defineChain,
  getAddress,
  hexToString,
  http,
  isAddress,
  keccak256,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { agentAccountAbi, bondlineCoverAbi, bondlineMarketAbi, mirrorFeedAbi } from "../shared/src/abis.ts";
import { robinhoodTestnet } from "../shared/src/chain.ts";
import type { StockSymbol } from "../shared/src/constants.ts";
import { deployment as defaultDeployment, type Deployment, type MarketKey } from "../shared/src/deployment.ts";
import {
  buildRecord,
  recordFileName,
  recordSummary,
  upsertIndex,
  type AnswerUpdatedEvent,
  type BlockedEvent,
  type ClosedEvent,
  type DepositedEvent,
  type MarketAssets,
  type OfferCreatedEvent,
  type OpenedEvent,
  type RecordEvent,
  type RecordsIndex,
  type SettledEvent,
  type TradedEvent,
  type WithdrawnEvent,
} from "../shared/src/record.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECORDS_DIR = process.env.BONDLINE_RECORDS_DIR ?? join(ROOT, "shared", "src", "records");
const USER_AGENT = "bondline-record/0.1 (read-only)";
const CHUNK = BigInt(10_000);
const PARALLEL = 10;
const RECENT = 20;
const MAX_DECISION_CHARS = 4000;
const MARKETS: MarketKey[] = ["live", "replay"];

// ------------------------------------------------------------------ setup

const deployment: Deployment = process.env.BONDLINE_DEPLOYMENT
  ? JSON.parse(readFileSync(process.env.BONDLINE_DEPLOYMENT, "utf8"))
  : defaultDeployment;
const rpcUrl = process.env.BONDLINE_RPC_URL ?? robinhoodTestnet.rpcUrls.default.http[0];
const isLocal = /localhost|127\.0\.0\.1/.test(rpcUrl);

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log("usage: npm run record <agent> [<agent> ...]   (an address, or a team role: careful, bold)");
  process.exit(args.length === 0 ? 2 : 0);
}

const roles = deployment.wallets as Record<string, Address>;
const agents: Address[] = args.map((a) => {
  if (isAddress(a, { strict: false })) return getAddress(a);
  const role = roles[a.toLowerCase()];
  if (role) return getAddress(role);
  console.error(`"${a}" is not an address or a team role (${Object.keys(roles).join(", ")})`);
  process.exit(2);
});

if (deployment.status !== "deployed") {
  console.error(
    `Bondline isn't deployed yet: the deployment record says status "${deployment.status}". ` +
      "There are no chain events to build a record from. Deploy the markets first, then run npm run record again.",
  );
  process.exit(1);
}
const markets = MARKETS.filter((k) => {
  const m = deployment.markets[k];
  if (m?.address && m.deployBlock != null) return true;
  console.warn(`skipping the ${k} market: no address or deployBlock in the deployment record`);
  return false;
});
if (markets.length === 0) {
  console.error("No market has an address and a deployBlock in the deployment record. Nothing to read.");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
const minGapMs = isLocal ? 0 : 250;

/** One request at a time, a short gap between requests, and exponential backoff (or Retry-After) on HTTP 429. */
function politeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const gap = lastRequestAt + minGapMs - Date.now();
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

const chain =
  deployment.chainId === robinhoodTestnet.id
    ? robinhoodTestnet
    : defineChain({
        id: deployment.chainId,
        name: `chain ${deployment.chainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      });
const client = createPublicClient({
  chain,
  transport: http(rpcUrl, {
    batch: { batchSize: 10, wait: 16 },
    fetchFn: politeFetch,
    fetchOptions: { headers: { "user-agent": USER_AGENT } },
    retryCount: 5,
    retryDelay: 1000,
    timeout: 30_000,
  }),
});

// ------------------------------------------------------------------ logs

interface RawLog {
  eventName: string;
  args: Record<string, unknown>;
  address: Address;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
}

const eventsOf = (abi: Abi, names: string[]) =>
  abi.filter((x): x is AbiEvent => x.type === "event" && names.includes(x.name));

/** getLogs over [from, to] in chunks of at most 10k blocks, up to 10 chunks per HTTP batch. */
async function logsOf(address: Address[], events: AbiEvent[], from: bigint, to: bigint): Promise<RawLog[]> {
  if (address.length === 0 || from > to) return [];
  const ranges: [bigint, bigint][] = [];
  for (let f = from; f <= to; f += CHUNK) ranges.push([f, f + CHUNK - BigInt(1) < to ? f + CHUNK - BigInt(1) : to]);
  const out: RawLog[] = [];
  for (let i = 0; i < ranges.length; i += PARALLEL) {
    const parts = await Promise.all(
      ranges.slice(i, i + PARALLEL).map(([fromBlock, toBlock]) =>
        client.getLogs({ address, events, fromBlock, toBlock, strict: true }),
      ),
    );
    for (const part of parts) out.push(...(part as unknown as RawLog[]));
  }
  return out;
}

const ref = (market: MarketKey, l: RawLog) => ({
  market,
  blockNumber: Number(l.blockNumber),
  logIndex: l.logIndex,
  txHash: l.transactionHash,
});
const a = (l: RawLog) => l.args as Record<string, any>;

// ------------------------------------------------------------------ per market (shared by every agent)

interface MarketData {
  key: MarketKey;
  label: string;
  address: Address;
  fromBlock: bigint;
  assets: { address: Address; symbol: StockSymbol }[];
  feeds: { feed: Address; asset: Address }[];
  offers: OfferCreatedEvent[];
  prices: AnswerUpdatedEvent[];
}

const head = await client.getBlockNumber();
const symbolByAddress = new Map(
  Object.entries(deployment.assets).map(([symbol, address]) => [address.toLowerCase(), symbol as StockSymbol]),
);

const marketData: MarketData[] = [];
for (const key of markets) {
  const m = deployment.markets[key];
  const address = getAddress(m.address!);
  const fromBlock = BigInt(m.deployBlock!);
  const [assets, feeds] = await Promise.all([
    client.readContract({ address, abi: bondlineMarketAbi, functionName: "assets" }),
    client.readContract({ address, abi: bondlineMarketAbi, functionName: "feeds" }),
  ]);
  const known = assets.flatMap((asset) => {
    const symbol = symbolByAddress.get(asset.toLowerCase());
    if (!symbol) console.warn(`  ${key}: asset ${asset} is not in the deployment's asset list; its trades show by address`);
    return symbol ? [{ address: asset, symbol }] : [];
  });
  const feedList = feeds.map((feed, i) => ({ feed, asset: assets[i] }));
  console.log(`${key} market ${address}: blocks ${fromBlock}..${head}, assets ${known.map((x) => x.symbol).join(", ")}`);

  const raw = await logsOf([address, ...feeds], [...eventsOf(bondlineMarketAbi, ["OfferCreated"]), ...eventsOf(mirrorFeedAbi, ["AnswerUpdated"])], fromBlock, head);
  const offers: OfferCreatedEvent[] = [];
  const prices: AnswerUpdatedEvent[] = [];
  for (const l of raw) {
    if (l.eventName === "OfferCreated" && l.address.toLowerCase() === address.toLowerCase()) {
      const t = a(l).terms;
      offers.push({
        ...ref(key, l),
        type: "OfferCreated",
        id: Number(a(l).id),
        cover: a(l).cover,
        underwriter: a(l).underwriter,
        agent: a(l).agent,
        terms: { minLimitBps: t.minLimitBps, maxLimitBps: t.maxLimitBps, feeBps: t.feeBps, maxStockBps: t.maxStockBps, name: t.name },
      });
    } else if (l.eventName === "AnswerUpdated") {
      const f = feedList.find((x) => x.feed.toLowerCase() === l.address.toLowerCase());
      if (!f) continue;
      prices.push({
        ...ref(key, l),
        type: "AnswerUpdated",
        feed: f.feed,
        asset: f.asset,
        answer: a(l).current,
        roundId: a(l).roundId,
        updatedAt: Number(a(l).updatedAt),
      });
    }
  }
  console.log(`  ${offers.length} offers, ${prices.length} price updates`);
  marketData.push({ key, label: m.label, address, fromBlock, assets: known, feeds: feedList, offers, prices });
}

const marketAssets: MarketAssets = Object.fromEntries(marketData.map((m) => [m.key, m.assets]));

// ------------------------------------------------------------------ per agent

async function blockTimes(blocks: number[]): Promise<Map<number, number>> {
  const unique = [...new Set(blocks)];
  const times = new Map<number, number>();
  for (let i = 0; i < unique.length; i += PARALLEL) {
    const got = await Promise.all(
      unique.slice(i, i + PARALLEL).map((n) => client.getBlock({ blockNumber: BigInt(n) })),
    );
    got.forEach((b) => times.set(Number(b.number), Number(b.timestamp)));
  }
  return times;
}

async function decisions(txs: Hex[]): Promise<Map<Hex, Hex | null>> {
  const out = new Map<Hex, Hex | null>();
  const unique = [...new Set(txs)];
  for (let i = 0; i < unique.length; i += PARALLEL) {
    const got = await Promise.all(unique.slice(i, i + PARALLEL).map((hash) => client.getTransaction({ hash })));
    for (const tx of got) {
      try {
        const call = decodeFunctionData({ abi: agentAccountAbi, data: tx.input });
        out.set(tx.hash, call.functionName === "trade" ? (call.args[4] as Hex) : null);
      } catch {
        out.set(tx.hash, null); // not a direct trade() call
      }
    }
  }
  return out;
}

const teamName = (agent: Address): string | null => {
  const role = Object.entries(roles).find(([, address]) => address.toLowerCase() === agent.toLowerCase())?.[0];
  return role === "careful" || role === "bold" ? role[0].toUpperCase() + role.slice(1) : null;
};

const indexPath = join(RECORDS_DIR, "index.json");
mkdirSync(RECORDS_DIR, { recursive: true });
let index: RecordsIndex;
try {
  index = JSON.parse(readFileSync(indexPath, "utf8"));
} catch {
  index = { version: 1, generatedAt: null, chainId: deployment.chainId, agents: [] };
}

for (const agent of agents) {
  console.log(`\nagent ${agent}${teamName(agent) ? ` (${teamName(agent)})` : ""}`);
  const events: RecordEvent[] = [];

  for (const m of marketData) {
    const offers = m.offers.filter((o) => o.agent.toLowerCase() === agent.toLowerCase());
    events.push(...offers);
    if (offers.length === 0) continue;

    const covers = offers.map((o) => getAddress(o.cover));
    const coverFrom = BigInt(Math.min(...offers.map((o) => o.blockNumber)));
    const coverLogs = await logsOf(covers, eventsOf(bondlineCoverAbi, ["Opened", "Deposited", "Withdrawn", "Settled", "Closed"]), coverFrom, head);
    const accounts: Address[] = [];
    let accountFrom: bigint | null = null;
    for (const l of coverLogs) {
      const r = ref(m.key, l);
      const x = a(l);
      switch (l.eventName) {
        case "Opened":
          accounts.push(x.account);
          if (accountFrom === null || l.blockNumber < accountFrom) accountFrom = l.blockNumber;
          events.push({
            ...r,
            type: "Opened",
            cover: getAddress(l.address),
            account: x.account,
            user: x.user,
            limitBps: x.limitBps,
            rules: {
              assetMask: x.rules.assetMask,
              maxStockBps: x.rules.maxStockBps,
              maxTradeBps: x.rules.maxTradeBps,
              maxDailyBps: x.rules.maxDailyBps,
              maxSlippageBps: x.rules.maxSlippageBps,
              maxPriceAge: x.rules.maxPriceAge,
            },
          } satisfies OpenedEvent);
          break;
        case "Deposited":
          events.push({ ...r, type: "Deposited", cover: getAddress(l.address), account: x.account, from: x.from, amount: x.amount, fee: x.fee, net: x.net, reserveAdded: x.reserveAdded } satisfies DepositedEvent);
          break;
        case "Withdrawn":
          events.push({ ...r, type: "Withdrawn", cover: getAddress(l.address), account: x.account, user: x.user, amount: x.amount, principal: x.principal, reserve: x.reserve } satisfies WithdrawnEvent);
          break;
        case "Settled":
          events.push({ ...r, type: "Settled", cover: getAddress(l.address), account: x.account, user: x.user, caller: x.caller, value: x.value, loss: x.loss, limit: x.limit, payout: x.payout } satisfies SettledEvent);
          break;
        case "Closed":
          events.push({ ...r, type: "Closed", cover: getAddress(l.address), account: x.account, user: x.user } satisfies ClosedEvent);
          break;
      }
    }

    if (accountFrom !== null) {
      const accountLogs = await logsOf(accounts, eventsOf(agentAccountAbi, ["Traded", "Blocked"]), accountFrom, head);
      for (const l of accountLogs) {
        const r = ref(m.key, l);
        const x = a(l);
        if (l.eventName === "Traded") {
          events.push({ ...r, type: "Traded", account: getAddress(l.address), asset: x.asset, isBuy: x.isBuy, usdAmount: x.usdAmount, amountIn: x.amountIn, amountOut: x.amountOut, price: x.price, valueAfter: x.valueAfter, stockValueAfter: x.stockValueAfter, decisionHash: x.decisionHash } satisfies TradedEvent);
        } else if (l.eventName === "Blocked") {
          events.push({ ...r, type: "Blocked", account: getAddress(l.address), asset: x.asset, isBuy: x.isBuy, usdAmount: x.usdAmount, reason: Number(x.reason), observed: x.observed, limit: x.limit, decisionHash: x.decisionHash } satisfies BlockedEvent);
        }
      }
      events.push(...m.prices.filter((p) => p.blockNumber >= Number(accountFrom)));
    }
    console.log(`  ${m.key}: ${offers.length} offer(s), ${accounts.length} account(s)`);
  }

  // Block times only where the record shows them: first and last actions, the latest ones, opens and claims.
  const actions = events
    .filter((e): e is TradedEvent | BlockedEvent => e.type === "Traded" || e.type === "Blocked")
    .sort((x, y) => x.blockNumber - y.blockNumber || x.logIndex - y.logIndex);
  const recent = actions.slice(-RECENT);
  const timed = [...(actions.length ? [actions[0]] : []), ...recent, ...events.filter((e) => e.type === "Opened" || e.type === "Settled")];
  const times = await blockTimes(timed.map((e) => e.blockNumber));
  for (const e of timed) e.timestamp = times.get(e.blockNumber);

  const record = buildRecord({
    agent,
    name: teamName(agent),
    chainId: deployment.chainId,
    events,
    marketAssets,
    markets: marketData.map((m) => ({ key: m.key, label: m.label, address: m.address, fromBlock: Number(m.fromBlock), toBlock: Number(head) })),
    recentLimit: RECENT,
  });

  // The AI's reasoning for the latest actions, from the transaction input, checked against the event's hash.
  const decoded = await decisions(record.recent.map((x) => x.txHash));
  for (const x of record.recent) {
    const bytes = decoded.get(x.txHash) ?? null;
    if (!bytes) {
      x.decision = null;
      x.decisionVerified = null;
      continue;
    }
    x.decisionVerified = keccak256(bytes) === x.decisionHash;
    let text: string;
    try {
      text = hexToString(bytes);
    } catch {
      text = bytes;
    }
    x.decision = text.length > MAX_DECISION_CHARS ? `${text.slice(0, MAX_DECISION_CHARS)}…` : text;
  }

  const file = join(RECORDS_DIR, recordFileName(agent));
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  index = upsertIndex(index, recordSummary(record), record.generatedAt);

  const p = record.prices;
  const bps = (x: number | null | undefined) => (x == null ? "n/a" : `${x.toFixed(1)} bps`);
  console.log(
    `  score ${record.score.value ?? "no record"} | trades ${record.activity.trades}, refusals ${record.activity.refusals}, ` +
      `claims ${record.claims.count} | p95 exposure ${record.exposure.p95 == null ? "n/a" : `${(record.exposure.p95 * 100).toFixed(1)}%`} ` +
      `of ${record.exposure.rulesMax == null ? "n/a" : `${(record.exposure.rulesMax * 100).toFixed(0)}%`} | ` +
      `worst case ${bps(p.worstCase?.fairBps)}, its record ${bps(p.record?.fairBps)} (L ${p.limitBps / 100}%, ${p.termDays} days, ` +
      `σ ${p.sigma.asset} ${(p.sigma.value * 100).toFixed(2)}%)`,
  );
  console.log(`  wrote ${file.replace(ROOT + "/", "")}`);
}

writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
console.log(`\nwrote ${indexPath.replace(ROOT + "/", "")} (${index.agents.length} agent${index.agents.length === 1 ? "" : "s"})`);
