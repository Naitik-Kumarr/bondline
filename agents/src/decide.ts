// Turning an account's state into a decision: Claude Haiku 4.5 with a strict JSON schema, under an hourly call cap;
// or, for pipeline tests on a local Anvil chain only, deterministic mock decisions labelled "model": "mock".
import Anthropic from "@anthropic-ai/sdk";
import { BLOCK_REASONS, type StockSymbol } from "@bondline/shared";
import type { NetConfig } from "./config.ts";
import { priceString, usdString, validateDecision, type Decision } from "./decision.ts";
import type { Fields, Logger } from "./log.ts";
import { systemPrompt, type Persona } from "./personas.ts";
import { marketTime, type AccountState, type FeedHistory } from "./state.ts";

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

/** A refusal the agent may answer once. */
export interface Refusal {
  reason: string; // BlockReason key
  label: string;
  observed: string;
  limit: string;
  observedRaw: bigint;
  limitRaw: bigint;
  tried: Decision;
}

export interface DecisionResult {
  decision: Decision;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
}

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["buy", "sell", "hold"] },
    asset: { type: "string", enum: ["TSLA", "AMZN"] },
    usdAmount: { type: "number" },
    reason: { type: "string" },
  },
  required: ["action", "asset", "usdAmount", "reason"],
  additionalProperties: false,
} as const;

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const usd = (units6: bigint) => `$${usdString(units6)}`;
const when = (sec: number) => new Date(sec * 1000).toISOString().slice(5, 16).replace("T", " ");

/** The state, as the model reads it. */
export function describeState(cfg: NetConfig, st: AccountState, history: FeedHistory, refusal?: Refusal): string {
  const lines: string[] = [];
  const mNow = marketTime(cfg, st.marketKey, st.now);
  if (st.marketKey === "replay") {
    lines.push(
      `Market: Replay market. Real Chainlink prices from 28 Sep - 2 Oct 2026, replayed ${cfg.replay.speed}x faster. ` +
        `Market time now: ${new Date(mNow * 1000).toUTCString().slice(0, 22)} UTC.`,
    );
  } else {
    lines.push(`Market: Live market. Chainlink prices mirrored from Robinhood Chain mainnet. Now: ${new Date(mNow * 1000).toUTCString()}.`);
  }
  lines.push(`Account ${st.account}: value ${usd(st.value)} = cash ${usd(st.cash)} + stocks ${usd(st.stockValue)} (${pct(st.stockBps)} in stocks).`);
  lines.push(
    `Holdings: ${st.holdings
      .map((h) => `${h.symbol} ${(Number(h.balance) / 1e18).toFixed(4)} shares = ${usd(h.value)} at $${priceString(h.price)}`)
      .join("; ")}.`,
  );
  const lossBps = st.principal > 0n ? Number((st.loss * 10_000n) / st.principal) : 0;
  lines.push(
    `Cover: principal ${usd(st.principal)}; loss now ${usd(st.loss)} (${pct(lossBps)}); the user's loss limit is ${pct(st.limitBps)} ` +
      `(${usd(st.limit)}). Past it, the cover settles and you are stopped.`,
  );
  const r = st.rules;
  const allowed = st.holdings.filter((h) => h.allowed).map((h) => h.symbol);
  lines.push(
    `Rules: stocks at most ${pct(r.maxStockBps)} of value after a buy; one trade at most ${pct(r.maxTradeBps)} of value (${usd(st.limits.maxTrade)}); ` +
      `at most ${pct(r.maxDailyBps)} of value traded per UTC day (left today: ${usd(st.limits.dailyLeft)}); allowed stocks: ${allowed.join(", ") || "none"}.`,
  );
  lines.push(
    `Largest trades allowed right now: buy up to ${usd(st.limits.maxBuy)}; ` +
      `sell ${st.holdings.map((h) => `${h.symbol} up to ${usd(st.limits.maxSell[h.symbol as StockSymbol])}`).join(", ")}.`,
  );
  lines.push("Recent prices (market time, oldest to newest):");
  // On the replay market, only rounds pushed by this replay (not seed prices or an earlier run).
  const since = st.marketKey === "replay" ? (cfg.replay.startsAt ?? 0) : 0;
  for (const f of st.feeds) {
    const changes = history.changes(f.feed, since).slice(-10);
    const first = changes[0]?.answer;
    const move = first && first > 0n ? ((Number(f.answer) / Number(first) - 1) * 100).toFixed(2) : "0.00";
    lines.push(
      `${f.symbol}: ${changes.map((c) => `${when(marketTime(cfg, st.marketKey, c.updatedAt))} $${priceString(c.answer)}`).join(", ") || `$${priceString(f.answer)}`}` +
        ` (now $${priceString(f.answer)}, ${Number(move) >= 0 ? "+" : ""}${move}% over these points)`,
    );
  }
  if (refusal) {
    lines.push(
      `Your previous decision (${refusal.tried.action} ${refusal.tried.asset} $${refusal.tried.usdAmount.toFixed(2)}) was refused on-chain: ` +
        `${refusal.label} (observed ${refusal.observed}, limit ${refusal.limit}). Decide again; this is your last try for now. Holding is fine.`,
    );
  }
  lines.push("Decide now.");
  return lines.join("\n");
}

/** A sliding one-hour cap on model calls, shared by both personas. */
export class CallBudget {
  private calls: number[] = [];
  constructor(readonly perHour: number) {}
  take(): boolean {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < 3_600_000);
    if (this.calls.length >= this.perHour) return false;
    this.calls.push(now);
    return true;
  }
  get used(): number {
    const now = Date.now();
    return this.calls.filter((t) => now - t < 3_600_000).length;
  }
}

export class ClaudeDecider {
  private readonly client: Anthropic;
  private disabledReason: string | null = null;
  private pausedUntil = 0;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly maxTokens: number,
    private readonly budget: CallBudget,
    private readonly log: Logger,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
  }

  get disabled(): string | null {
    return this.disabledReason;
  }

  async decide(persona: Persona, prompt: string, ctx: Fields): Promise<DecisionResult | null> {
    if (this.disabledReason) return null;
    if (Date.now() < this.pausedUntil) {
      this.log.info("claude-paused", { ...ctx, untilMs: this.pausedUntil });
      return null;
    }
    if (!this.budget.take()) {
      this.log.warn("claude-cap-reached", { ...ctx, perHour: this.budget.perHour, note: "skipping this decision" });
      return null;
    }
    const started = Date.now();
    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: systemPrompt(persona),
        messages: [{ role: "user", content: prompt }],
        output_config: { format: { type: "json_schema", schema: DECISION_SCHEMA } },
      });
      const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
      if (res.stop_reason === "refusal") {
        this.log.warn("claude-refused", { ...ctx, usage, category: res.stop_details?.category ?? null });
        return null;
      }
      if (res.stop_reason === "max_tokens") {
        this.log.warn("claude-truncated", { ...ctx, usage, maxTokens: this.maxTokens });
        return null;
      }
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.log.warn("claude-invalid-json", { ...ctx, usage, text: text.slice(0, 300) });
        return null;
      }
      const v = validateDecision(parsed);
      if ("error" in v) {
        this.log.warn("claude-invalid-decision", { ...ctx, usage, error: v.error, text: text.slice(0, 300) });
        return null;
      }
      return { decision: v.decision, model: this.model, usage, latencyMs: Date.now() - started };
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        this.disabledReason = `auth (${e.status})`;
        this.log.error("claude-auth-failed", { ...ctx, status: e.status, note: "check ANTHROPIC_API_KEY; model calls disabled until restart" });
      } else if (e instanceof Anthropic.NotFoundError || e instanceof Anthropic.BadRequestError) {
        this.disabledReason = `request rejected (${e.status})`;
        this.log.error("claude-request-rejected", { ...ctx, status: e.status, model: this.model, message: e.message.slice(0, 300) });
      } else if (e instanceof Anthropic.RateLimitError) {
        this.pausedUntil = Date.now() + 120_000;
        this.log.warn("claude-rate-limited", { ...ctx, status: e.status, pauseSeconds: 120 });
      } else if (e instanceof Anthropic.APIConnectionError) {
        this.log.warn("claude-connection-error", { ...ctx, message: e.message.slice(0, 200) });
      } else if (e instanceof Anthropic.APIError) {
        this.log.warn("claude-api-error", { ...ctx, status: e.status, message: e.message.slice(0, 200) });
      } else {
        this.log.warn("claude-error", { ...ctx, message: String((e as Error)?.message ?? e).slice(0, 200) });
      }
      return null;
    }
  }
}

/**
 * Deterministic decisions for pipeline tests on Anvil only. Each persona walks a fixed script that includes one
 * deliberate rule break, so the pipeline shows a trade, an on-chain refusal and the single retry.
 */
export class MockDecider {
  readonly model = "mock";
  private step = new Map<string, number>();

  decide(persona: Persona, st: AccountState, refusal?: Refusal): DecisionResult {
    const value = Number(st.value) / 1e6;
    const amt = (f: number) => Math.floor(value * f * 100) / 100;
    if (refusal) {
      if (refusal.reason === "TradeTooLarge") {
        const limit = Number(refusal.limitRaw) / 1e6;
        const usdAmount = Math.floor(limit * 0.9 * 100) / 100;
        return this.result({ ...refusal.tried, usdAmount, reason: `Mock decision (pipeline test): refused as too large, retrying at $${usdAmount.toFixed(2)}.` });
      }
      return this.result({ action: "hold", asset: refusal.tried.asset, usdAmount: 0, reason: `Mock decision (pipeline test): refused (${refusal.reason}), holding.` });
    }
    const n = this.step.get(st.account) ?? 0;
    this.step.set(st.account, n + 1);
    type S = [Decision["action"], Decision["asset"], number];
    const careful: S[] = [
      ["buy", "TSLA", 0.08],
      ["buy", "AMZN", 0.25], // breaks the 20% per-trade rule on purpose: refused on-chain, then retried smaller
      ["hold", "TSLA", 0],
      ["sell", "TSLA", 0.03],
    ];
    const bold: S[] = [
      ["buy", "TSLA", 0.18],
      ["buy", "AMZN", 0.18],
      ["buy", "TSLA", 0.18],
      ["buy", "AMZN", 0.18],
      ["buy", "TSLA", 0.15], // would pass 80% in stocks: refused on-chain (StockShare), then holds
      ["hold", "AMZN", 0],
    ];
    const script = persona.name === "Careful" ? careful : bold;
    // After its script, the mock just holds.
    const [action, asset, f]: S = n < script.length ? script[n] : ["hold", "TSLA", 0];
    const usdAmount = action === "hold" ? 0 : amt(f);
    const words = action === "hold" ? "hold" : `${action} ${Math.round(f * 100)}% of value in ${asset}`;
    return this.result({ action, asset, usdAmount, reason: `Mock decision (pipeline test, step ${n + 1}): ${words}.` });
  }

  private result(decision: Decision): DecisionResult {
    return { decision, model: this.model };
  }
}

/** A refusal's observed value and limit in readable units (they depend on the reason). */
function humanize(key: string, x: bigint): string {
  if (x === 2n ** 256n - 1n) return "n/a";
  switch (key) {
    case "TradeTooLarge":
    case "DailyLimit":
    case "InsufficientCash":
    case "InsufficientStock":
      return `$${usdString(x)}`;
    case "StockShare":
    case "Slippage":
      return `${(Number(x) / 100).toFixed(2)}%`;
    case "PriceStale":
      return `${x}s`;
    default:
      return x.toString();
  }
}

export function refusalFrom(reasonIndex: number, observed: bigint, limit: bigint, tried: Decision): Refusal {
  const r = BLOCK_REASONS[reasonIndex] ?? { key: `Reason${reasonIndex}`, label: `Refusal ${reasonIndex}` };
  return {
    reason: r.key,
    label: r.label,
    observed: humanize(r.key, observed),
    limit: humanize(r.key, limit),
    observedRaw: observed,
    limitRaw: limit,
    tried,
  };
}
