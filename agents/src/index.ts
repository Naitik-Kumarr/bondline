// Bondline agents: two AI personas (Careful and Bold), each with its own wallet. Every few minutes, for each covered
// account it manages, when that market's prices are fresh, the agent asks Claude Haiku 4.5 for one decision (strict
// JSON) and sends trades on-chain with the decision JSON as calldata. Holds stay off-chain. A refused trade is retried
// at most once, with the refusal reason.
import { createWalletClient, formatEther, type Account, type Address, type Chain, type Transport, type WalletClient } from "viem";
import type { MarketKey } from "@bondline/shared";
import {
  accountFromEnv,
  connect,
  envNumber,
  iso,
  loadEnvFile,
  loadNetConfig,
  MARKET_KEYS,
  nowSec,
  readMarkets,
  replayEndsAt,
  replayTimeAt,
  rpcHost,
  sleep,
  transport,
  type MarketInfo,
} from "./config.ts";
import { CallBudget, ClaudeDecider, DEFAULT_MODEL, describeState, MockDecider, refusalFrom, type DecisionResult, type Refusal } from "./decide.ts";
import { DECISION_VERSION, encodeDecision, priceString, usdString } from "./decision.ts";
import { createLogger, describeError, type Fields } from "./log.ts";
import { PERSONAS, type Persona } from "./personas.ts";
import { AccountBook, ACTIVE, chainNow, FeedHistory, marketTime, readAccount, readFeeds, type AccountState, type FeedNow } from "./state.ts";
import { sendTrade, type Outcome } from "./trade.ts";
import { BLOCK_REASONS } from "@bondline/shared";

const envFile = loadEnvFile();
const log = createLogger("agents");
process.on("unhandledRejection", (e) => log.error("unhandled-rejection", { error: describeError(e) }));

/** Refusals that a new decision can't fix: no retry for these. */
const NO_RETRY = new Set(["Stopped", "Paused", "PriceStale"]);

interface Agent {
  persona: Persona;
  address: Address;
  wallet: WalletClient<Transport, Chain, Account>;
}

async function main() {
  const cfg = loadNetConfig();
  const { client, chain } = await connect(cfg, "agents");
  const mock = process.env.MOCK_DECISIONS === "1";
  // Mock decisions only ever go to a local node: Anvil (31337) or a local fork of the testnet on localhost.
  const localNode = chain.id === 31337 || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(cfg.rpcUrl ?? "");
  if (mock && !localNode) {
    log.error("mock-refused", { chainId: chain.id, note: "MOCK_DECISIONS=1 runs only on a local node (Anvil or a localhost fork); refusing to start" });
    setTimeout(() => process.exit(1), 200);
    return;
  }
  const markets = await readMarkets(client, cfg);
  const agents: Agent[] = PERSONAS.filter((p) => process.env[p.keyEnv]).map((persona) => {
    const account = accountFromEnv(persona.keyEnv);
    return { persona, address: account.address, wallet: createWalletClient({ account, chain, transport: transport(cfg.rpcUrl, "agents") }) };
  });
  if (!agents.length) throw new Error("set CAREFUL_PRIVATE_KEY and/or BOLD_PRIVATE_KEY");

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  const model = process.env.AGENT_MODEL ?? DEFAULT_MODEL;
  const intervalSeconds = envNumber("AGENT_INTERVAL_SECONDS", 180);
  const maxTokens = envNumber("CLAUDE_MAX_TOKENS", 300);
  const toleranceBps = BigInt(envNumber("MIN_OUT_TOLERANCE_BPS", 100));
  const headroom = envNumber("FRESH_HEADROOM_SECONDS", 60);
  const budget = new CallBudget(envNumber("MAX_CLAUDE_CALLS_PER_HOUR", 60));
  const claude = !mock && apiKey ? new ClaudeDecider(apiKey, model, maxTokens, budget, log) : null;
  const mocker = mock ? new MockDecider() : null;
  const book = new AccountBook(client);
  const history = new FeedHistory(client, envNumber("PRICE_HISTORY_ROUNDS", 60));
  const seen = new Set<string>();
  const once = (key: string, level: "info" | "warn", event: string, fields: Fields) => {
    if (seen.has(key)) return;
    seen.add(key);
    log[level](event, fields);
  };

  log.info("start", {
    anthropicApiKey: apiKey ? "set" : "not set",
    model: mock ? "mock" : model,
    mockDecisions: mock,
    agents: await Promise.all(
      agents.map(async (a) => ({ name: a.persona.name, address: a.address, ethBalance: formatEther(await client.getBalance({ address: a.address })) })),
    ),
    chainId: chain.id,
    rpc: rpcHost(cfg.rpcUrl),
    deployment: cfg.source,
    envFile: envFile ?? "none",
    intervalSeconds,
    maxClaudeCallsPerHour: budget.perHour,
    maxTokens,
    minOutToleranceBps: Number(toleranceBps),
    markets: Object.fromEntries(Object.values(markets).map((m) => [m.key, { address: m.address, maxPriceAge: m.maxPriceAge }])),
    replay: {
      speed: cfg.replay.speed,
      startsAt: cfg.replay.startsAt === null ? null : iso(cfg.replay.startsAt),
      endsAt: replayEndsAt(cfg.replay) === null ? null : iso(replayEndsAt(cfg.replay)!),
    },
    log: log.file,
  });
  if (!mock && !apiKey) {
    log.warn("no-api-key", { note: "ANTHROPIC_API_KEY is not set: the agents log and wait, and send nothing" });
  }

  /** The replay market trades only while the replay of real prices runs: never on stale or scripted prices. */
  const replayOpen = () => {
    const t = replayTimeAt(cfg.replay, nowSec());
    return t !== null && t < cfg.replay.windowEnd;
  };

  async function decide(agent: Agent, st: AccountState, refusal?: Refusal): Promise<DecisionResult | null> {
    if (mocker) return mocker.decide(agent.persona, st, refusal);
    if (!claude) return null;
    const prompt = describeState(cfg, st, history, refusal);
    return claude.decide(agent.persona, prompt, { agent: agent.persona.name, market: st.marketKey, account: st.account });
  }

  /** Logs a decision and, for a buy or sell, sends it. Holds stay off-chain. */
  async function act(agent: Agent, st: AccountState, res: DecisionResult, refusal?: Refusal, prevHash?: string): Promise<Outcome | null> {
    const d = res.decision;
    const lossBps = st.principal > 0n ? Number((st.loss * 10_000n) / st.principal) : 0;
    const encoded = encodeDecision({
      v: DECISION_VERSION,
      agent: agent.persona.name,
      model: res.model,
      market: st.marketKey,
      account: st.account,
      ts: st.now,
      action: d.action,
      asset: d.asset,
      usdAmount: d.usdAmount.toFixed(2),
      reason: d.reason,
      inputs: {
        value: usdString(st.value),
        cash: usdString(st.cash),
        stockBps: st.stockBps,
        px: Object.fromEntries(st.feeds.map((f) => [f.symbol, priceString(f.answer)])),
        lossBps,
        limitBps: st.limitBps,
        maxStockBps: st.rules.maxStockBps,
        maxTradeBps: st.rules.maxTradeBps,
        marketTime: marketTime(cfg, st.marketKey, st.now),
      },
      retry: refusal ? { refused: refusal.reason, prev: prevHash } : undefined,
    });
    const base = { agent: agent.persona.name, market: st.marketKey, account: st.account, model: res.model };
    log.info("decision", {
      ...base,
      action: d.action,
      asset: d.asset,
      usdAmount: d.usdAmount,
      reason: d.reason,
      retry: Boolean(refusal),
      decisionHash: encoded.hash,
      decisionBytes: encoded.bytes,
      usage: res.usage,
      latencyMs: res.latencyMs,
    });
    if (d.action === "hold") {
      log.info("hold", { ...base, asset: d.asset, reason: d.reason, decision: encoded.json, note: "holds stay off-chain" });
      return null;
    }
    const outcome = await sendTrade(client, agent.wallet, st, d, encoded, toleranceBps);
    if (outcome.kind === "traded") {
      log.info("traded", { ...base, action: d.action, asset: d.asset, tx: outcome.tx, block: outcome.block, ...outcome.traded, decisionHash: outcome.decisionHash });
    } else {
      const b = outcome.blocked!;
      log.info("blocked", {
        ...base,
        action: d.action,
        asset: d.asset,
        tx: outcome.tx,
        block: outcome.block,
        reason: BLOCK_REASONS[b.reasonIndex]?.key ?? b.reasonIndex,
        label: BLOCK_REASONS[b.reasonIndex]?.label,
        observed: b.observed,
        limit: b.limit,
        decisionHash: outcome.decisionHash,
      });
    }
    return outcome;
  }

  /** Replay prices count only if this replay pushed them: never seed prices or the scripted gap's. */
  const priceWindow = (market: MarketInfo) =>
    market.key === "replay" && cfg.replay.startsAt !== null
      ? { from: cfg.replay.startsAt, to: replayEndsAt(cfg.replay)! }
      : undefined;

  async function runAccount(agent: Agent, market: MarketInfo, cover: Address, account: Address, feeds: FeedNow[], now: number) {
    const st = await readAccount(client, market, cover, account, feeds, now, headroom, priceWindow(market));
    const ctx = { agent: agent.persona.name, market: market.key, account };
    if (st.status !== ACTIVE) {
      once(`inactive-${account}`, "info", "account-inactive", { ...ctx, status: st.status });
      return;
    }
    if (st.paused || st.stopped) {
      log.info("account-paused", { ...ctx, paused: st.paused, stopped: st.stopped, note: "waiting" });
      return;
    }
    if (!st.fresh) {
      const w = priceWindow(market);
      log.info("prices-stale", {
        ...ctx,
        ages: Object.fromEntries(st.feeds.map((f) => [f.symbol, f.age])),
        maxAge: st.maxAge,
        pushedThisReplay: w ? st.feeds.every((f) => f.updatedAt >= w.from && f.updatedAt < w.to) : undefined,
        note: "waiting",
      });
      return;
    }
    if (!claude && !mocker) {
      log.info("waiting-no-api-key", ctx);
      return;
    }
    if (claude?.disabled) {
      once(`claude-disabled`, "warn", "claude-disabled", { reason: claude.disabled });
      return;
    }

    const first = await decide(agent, st);
    if (!first) return;
    const outcome = await act(agent, st, first);
    if (outcome?.kind !== "blocked") return;

    const reason = BLOCK_REASONS[outcome.blocked!.reasonIndex]?.key ?? "";
    if (NO_RETRY.has(reason)) return;
    // One retry, with the refusal reason. Never more.
    const now2 = await chainNow(client);
    const feeds2 = await readFeeds(client, market, now2);
    const st2 = await readAccount(client, market, cover, account, feeds2, now2, headroom, priceWindow(market));
    if (st2.status !== ACTIVE || st2.paused || st2.stopped || !st2.fresh) return;
    const refusal = refusalFrom(outcome.blocked!.reasonIndex, outcome.blocked!.observed, outcome.blocked!.limit, first.decision);
    const second = await decide(agent, st2, refusal);
    if (!second) return;
    await act(agent, st2, second, refusal, outcome.decisionHash);
  }

  async function runAgent(agent: Agent) {
    for (const key of MARKET_KEYS as MarketKey[]) {
      const market = markets[key];
      if (key === "replay" && !replayOpen()) {
        once(`replay-closed-${agent.persona.name}-${cfg.replay.startsAt}`, "info", "replay-closed", {
          agent: agent.persona.name,
          note: "the replay market trades only while the replay runs (never on stale or scripted prices)",
        });
        continue;
      }
      seen.delete(`replay-closed-${agent.persona.name}-${cfg.replay.startsAt}`);
      const accounts = await book.accountsFor(market, agent.address);
      if (!accounts.length) continue;
      const now = await chainNow(client);
      const feeds = await readFeeds(client, market, now);
      for (const f of feeds) if (f.roundId > 0n) await history.update(f.feed, f.roundId);
      for (const { cover, account } of accounts) {
        try {
          await runAccount(agent, market, cover, account, feeds, now);
        } catch (e) {
          log.warn("account-error", { agent: agent.persona.name, market: key, account, error: describeError(e) });
        }
      }
    }
  }

  let stopped = false;
  const shutdown = (signal: string) => {
    log.info("stopping", { signal });
    stopped = true;
    setTimeout(() => process.exit(0), 200);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!stopped) {
    const started = Date.now();
    for (const agent of agents) {
      try {
        await runAgent(agent);
      } catch (e) {
        log.warn("agent-error", { agent: agent.persona.name, error: describeError(e) });
      }
    }
    if (claude) log.debug("cycle", { claudeCallsLastHour: budget.used });
    await sleep(Math.max(1_000, intervalSeconds * 1000 - (Date.now() - started)));
  }
}

main().catch((e) => {
  log.error("fatal", { error: describeError(e) });
  setTimeout(() => process.exit(1), 200);
});
