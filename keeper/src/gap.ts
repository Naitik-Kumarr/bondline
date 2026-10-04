// The scripted gap demo, triggered by a control file (state/gap.json) once the replay window has ended:
//   (a) "Friday close": scale both replay prices by one factor so the account is worth principal x (1 - friday);
//   (b) "weekend": push nothing for weekendSeconds, so the replay prices go stale (agents wait, nothing can settle);
//   (c) "Monday open": scale the prices again so the account is worth principal x (1 - monday);
//   (d) the settle loop settles it at the fresh Monday prices and the bond pays the gap.
// Everything it does is labelled "scripted gap" and recorded, with every transaction, in deployments/gap-demo.json.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { agentAccountAbi, bondlineCoverAbi, bondlineMarketAbi, COVER_STATUS, type StockSymbol } from "@bondline/shared";
import { iso, nowSec, sleep } from "./config.ts";
import { feedLatest, pushWithBlockTime, type Ctx } from "./context.ts";
import { describeError } from "./log.ts";
import { replayPhase } from "./replay.ts";

const BPS = 10_000n;
const ACTIVE = COVER_STATUS.indexOf("Active");
const SETTLED = COVER_STATUS.indexOf("Settled");
const CLOSED = COVER_STATUS.indexOf("Closed");
const FRESH_SLACK = 30; // seconds: a pushed price older than this (by the wall clock) is pushed again
const SETTLE_WAIT = 15 * 60; // seconds to wait for the settle loop before giving up

export const GAP_LABEL = "scripted gap";

export interface GapControl {
  market: "replay";
  cover: Address;
  account: Address;
  fridayDrawdownBps: number;
  mondayDrawdownBps: number;
  weekendSeconds: number;
}

type Step = "friday" | "weekend" | "monday" | "settle";

interface Progress {
  control: GapControl;
  step: Step;
  startedAt: string;
  weekendEndsAt?: number;
  mondayFromBlock?: string;
  record: Record<string, unknown>;
}

/** A reason to stop the scenario for good (as opposed to a transient RPC error, which is retried). */
class GapAbort extends Error {}

/** Default output: deployments/gap-demo.json on the testnet, gap-demo-<chainId>.json anywhere else (local runs). */
export function gapPaths(chainId: number) {
  const stateDir = resolve(process.env.STATE_DIR ?? join(process.cwd(), "state"));
  const name = chainId === 46630 ? "gap-demo.json" : `gap-demo-${chainId}.json`;
  return {
    stateDir,
    control: join(stateDir, "gap.json"),
    progress: join(stateDir, "gap-progress.json"),
    output: resolve(process.env.GAP_OUTPUT ?? join(process.cwd(), "..", "deployments", name)),
  };
}

export function parseControl(text: string): GapControl {
  const c = JSON.parse(text) as Record<string, unknown>;
  if (c.market !== "replay") throw new Error('gap.json: "market" must be "replay" (the live market stays honest)');
  for (const k of ["cover", "account"] as const) {
    if (typeof c[k] !== "string" || !isAddress(c[k] as string)) throw new Error(`gap.json: "${k}" must be an address`);
  }
  const num = (k: string, fallback: number) => {
    const v = c[k] ?? fallback;
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) throw new Error(`gap.json: "${k}" must be a positive integer`);
    return v;
  };
  return {
    market: "replay",
    cover: getAddress(c.cover as string),
    account: getAddress(c.account as string),
    fridayDrawdownBps: num("fridayDrawdownBps", 800),
    mondayDrawdownBps: num("mondayDrawdownBps", 2500),
    weekendSeconds: num("weekendSeconds", 360),
  };
}

const sameControl = (a: GapControl, b: GapControl) => JSON.stringify(a) === JSON.stringify(b);
const usd = (x: bigint) => formatUnits(x, 6);
const px = (x: bigint) => formatUnits(x, 8);
const bpsOf = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * BPS) / whole));

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
}

export function createGap(ctx: Ctx) {
  const paths = gapPaths(ctx.cfg.expectedChainId);
  const market = ctx.markets.replay;
  let lastControlError = "";
  let retryAt = 0; // after a transient error, wait before resuming

  async function snapshot(control: GapControl) {
    const [v, h, pos] = await Promise.all([
      ctx.client.readContract({ address: control.account, abi: agentAccountAbi, functionName: "valuation" }),
      ctx.client.readContract({ address: control.cover, abi: bondlineCoverAbi, functionName: "health", args: [control.account] }),
      ctx.client.readContract({ address: control.cover, abi: bondlineCoverAbi, functionName: "position", args: [control.account] }),
    ]);
    return { v, h, pos };
  }

  /** New feed answers that put the account at principal x (1 - drawdown), scaling both prices by one factor. */
  async function targetAnswers(control: GapControl, drawdownBps: number) {
    const { v, pos } = await snapshot(control);
    if (!v.pricesValid) throw new GapAbort("the account's prices are not valid");
    if (v.stockValue === 0n) throw new GapAbort("the account holds no stocks, so a price gap can't move its value");
    const target = (pos.principal * (BPS - BigInt(drawdownBps))) / BPS;
    if (target <= v.cash) {
      throw new GapAbort(
        `impossible: the account's cash (${usd(v.cash)}) is already worth more than the target value (${usd(target)})`,
      );
    }
    const num = target - v.cash;
    const den = v.stockValue;
    if (num * 100n < den * 5n || num > den * 2n) {
      throw new GapAbort(`price factor ${Number((num * 10_000n) / den) / 10_000} is out of range [0.05, 2]`);
    }
    const answers = {} as Record<StockSymbol, bigint>;
    const before = {} as Record<StockSymbol, bigint>;
    for (const a of market.assets) {
      const cur = (await feedLatest(ctx.client, a.feed)).answer;
      const next = (cur * num + den / 2n) / den;
      if (next <= 0n) throw new GapAbort(`scaled ${a.symbol} price is not positive`);
      before[a.symbol] = cur;
      answers[a.symbol] = next;
    }
    return {
      answers,
      before,
      factor: Number((num * 1_000_000n) / den) / 1_000_000,
      principal: pos.principal,
      cashBefore: v.cash,
      stockValueBefore: v.stockValue,
      valueBefore: v.value,
      target,
    };
  }

  async function pushAll(answers: Record<StockSymbol, bigint>, label: string, only?: StockSymbol[]) {
    const out: { symbol: StockSymbol; answer: string; price: string; updatedAt: string; tx: string }[] = [];
    for (const a of market.assets) {
      if (only && !only.includes(a.symbol)) continue;
      let pushed = false;
      for (let attempt = 0; attempt < 5 && !pushed; attempt++) {
        const res = await pushWithBlockTime(ctx, a.feed, answers[a.symbol], label, { symbol: a.symbol, label: GAP_LABEL });
        if (res.sent && !res.sent.ok) throw new GapAbort(`${label} push for ${a.symbol} reverted (${res.sent.hash})`);
        if (res.sent) {
          out.push({
            symbol: a.symbol,
            answer: answers[a.symbol].toString(),
            price: px(answers[a.symbol]),
            updatedAt: iso(res.updatedAt!),
            tx: res.sent.hash,
          });
          pushed = true;
        } else {
          await sleep(2_000); // no block newer than the feed's latest round yet
        }
      }
      if (!pushed) throw new Error(`${label}: no new block to timestamp the ${a.symbol} push; will retry`);
    }
    return out;
  }

  /** Re-pushes the same answers to any feed whose timestamp is not fresh by the wall clock (an idle chain lags). */
  async function keepFresh(answers: Record<StockSymbol, bigint>, label: string, slack: number) {
    const refreshes: Awaited<ReturnType<typeof pushAll>> = [];
    for (let i = 0; i < 5; i++) {
      const rounds = await Promise.all(market.assets.map((a) => feedLatest(ctx.client, a.feed)));
      const stale = market.assets.filter((_, j) => nowSec() - Number(rounds[j].updatedAt) > slack).map((a) => a.symbol);
      if (!stale.length) return refreshes;
      refreshes.push(...(await pushAll(answers, `${label} refresh`, stale)));
    }
    return refreshes;
  }

  async function friday(p: Progress) {
    const c = p.control;
    const t = await targetAnswers(c, c.fridayDrawdownBps);
    ctx.log.info("gap-friday", { label: GAP_LABEL, factor: t.factor, valueBefore: t.valueBefore, target: t.target });
    const pushes = await pushAll(t.answers, "gap friday close");
    const refreshes = await keepFresh(t.answers, "gap friday close", FRESH_SLACK);
    const after = await snapshot(c);
    p.record.friday = {
      drawdownBps: c.fridayDrawdownBps,
      factor: t.factor,
      valueBefore: usd(t.valueBefore),
      cash: usd(t.cashBefore),
      stockValueBefore: usd(t.stockValueBefore),
      prices: Object.fromEntries(
        market.assets.map((a) => [a.symbol, { before: px(t.before[a.symbol]), after: px(t.answers[a.symbol]) }]),
      ),
      valueAfter: usd(after.v.value),
      lossAfter: usd(after.h.loss),
      lossBps: bpsOf(after.h.loss, t.principal),
      settleable: after.h.settleable,
      pushes,
      refreshes,
    };
    p.weekendEndsAt = nowSec() + c.weekendSeconds;
    p.step = "weekend";
  }

  async function weekend(p: Progress) {
    const c = p.control;
    const end = p.weekendEndsAt ?? nowSec() + c.weekendSeconds;
    ctx.log.info("gap-weekend", { label: GAP_LABEL, until: iso(end), seconds: c.weekendSeconds, note: "pushing nothing" });
    let lastLog = nowSec();
    while (nowSec() < end) {
      await sleep(Math.min(5_000, (end - nowSec()) * 1000 + 50));
      if (nowSec() - lastLog >= 60) {
        lastLog = nowSec();
        ctx.log.info("gap-weekend-waiting", { secondsLeft: Math.max(0, end - nowSec()) });
      }
    }
    const rounds = await Promise.all(market.assets.map((a) => feedLatest(ctx.client, a.feed)));
    const ages = Object.fromEntries(market.assets.map((a, i) => [a.symbol, nowSec() - Number(rounds[i].updatedAt)]));
    p.record.weekend = {
      seconds: c.weekendSeconds,
      from: iso(end - c.weekendSeconds),
      to: iso(end),
      marketMaxPriceAge: market.maxPriceAge,
      priceAgeAtEndSeconds: ages,
      note: "no pushes: the replay prices went stale, so agents waited and nothing could settle",
    };
    p.step = "monday";
  }

  async function monday(p: Progress) {
    const c = p.control;
    const t = await targetAnswers(c, c.mondayDrawdownBps);
    if (!p.mondayFromBlock) {
      p.mondayFromBlock = (await ctx.client.getBlockNumber()).toString();
      writeJson(paths.progress, p);
    }
    ctx.log.info("gap-monday", { label: GAP_LABEL, factor: t.factor, valueBefore: t.valueBefore, target: t.target });
    const pushes = await pushAll(t.answers, "gap monday open");
    const refreshes = await keepFresh(t.answers, "gap monday open", FRESH_SLACK);
    p.record.monday = {
      drawdownBps: c.mondayDrawdownBps,
      factor: t.factor,
      prices: Object.fromEntries(
        market.assets.map((a) => [a.symbol, { before: px(t.before[a.symbol]), after: px(t.answers[a.symbol]) }]),
      ),
      targetValue: usd(t.target),
      pushes,
      refreshes,
    };
    p.step = "settle";
  }

  async function settled(p: Progress) {
    const c = p.control;
    const deadline = nowSec() + SETTLE_WAIT;
    const refreshes: Awaited<ReturnType<typeof pushAll>> = [];
    for (;;) {
      const pos = await ctx.client.readContract({ address: c.cover, abi: bondlineCoverAbi, functionName: "position", args: [c.account] });
      if (pos.status === SETTLED) break;
      if (pos.status === CLOSED) throw new GapAbort("the user closed the cover before it settled");
      if (nowSec() > deadline) throw new GapAbort(`not settled within ${SETTLE_WAIT} seconds of the Monday open`);
      // Keep the Monday prices fresh until the settle loop gets to it.
      const rounds = await Promise.all(market.assets.map((a) => feedLatest(ctx.client, a.feed)));
      const stale = market.assets.filter((_, i) => nowSec() - Number(rounds[i].updatedAt) > market.maxPriceAge - 120).map((a) => a.symbol);
      if (stale.length) {
        const answers = Object.fromEntries(market.assets.map((a, i) => [a.symbol, rounds[i].answer])) as Record<StockSymbol, bigint>;
        refreshes.push(...(await pushAll(answers, "gap monday open refresh", stale)));
      }
      await sleep(5_000);
    }
    const events = await ctx.client.getContractEvents({
      address: c.cover,
      abi: bondlineCoverAbi,
      eventName: "Settled",
      args: { account: c.account },
      fromBlock: BigInt(p.mondayFromBlock ?? "0"),
      toBlock: "latest",
    });
    const ev = events[events.length - 1];
    if (!ev) throw new Error("settled, but the Settled event was not found yet; will retry");
    const { value, loss, limit, payout, caller, user } = ev.args as {
      value: bigint;
      loss: bigint;
      limit: bigint;
      payout: bigint;
      caller: Address;
      user: Address;
    };
    const principal = BigInt((p.record.principalRaw as string) ?? "0");
    if (refreshes.length) (p.record.monday as Record<string, unknown>).lateRefreshes = refreshes;
    p.record.settle = {
      tx: ev.transactionHash,
      block: ev.blockNumber,
      caller,
      settledBy: caller.toLowerCase() === ctx.keeper.toLowerCase() ? "our keeper" : "another caller",
      user,
      value: usd(value),
      loss: usd(loss),
      limit: usd(limit),
      payout: usd(payout),
      lossBps: bpsOf(loss, principal),
      payoutBps: bpsOf(payout, principal),
    };
    p.record.summary = {
      principal: usd(principal),
      limitBps: p.record.limitBps,
      fridayLossBps: (p.record.friday as { lossBps: number }).lossBps,
      mondayLoss: usd(loss),
      userLoses: usd(loss - payout),
      bondPays: usd(payout),
      settleTx: ev.transactionHash,
    };
    p.record.completedAt = new Date().toISOString();
  }

  function loadProgress(control: GapControl): Progress {
    if (existsSync(paths.progress)) {
      try {
        const saved = JSON.parse(readFileSync(paths.progress, "utf8")) as Progress;
        if (sameControl(saved.control, control)) return saved;
      } catch {
        // fall through: start over
      }
    }
    return { control, step: "friday", startedAt: new Date().toISOString(), record: {} };
  }

  function finish(control: GapControl) {
    rmSync(paths.progress, { force: true });
    try {
      if (sameControl(parseControl(readFileSync(paths.control, "utf8")), control)) rmSync(paths.control, { force: true });
    } catch {
      rmSync(paths.control, { force: true });
    }
  }

  async function run(control: GapControl) {
    const p = loadProgress(control);
    const c = control;
    const [isOffer, pos, agent] = await Promise.all([
      ctx.client.readContract({ address: market.address, abi: bondlineMarketAbi, functionName: "isOffer", args: [c.cover] }),
      ctx.client.readContract({ address: c.cover, abi: bondlineCoverAbi, functionName: "position", args: [c.account] }),
      ctx.client.readContract({ address: c.account, abi: agentAccountAbi, functionName: "agent" }).catch(() => null),
    ]);
    try {
      if (!isOffer) throw new GapAbort("the cover is not an offer of the replay market");
      if (pos.status === SETTLED && p.step === "monday" && p.mondayFromBlock) p.step = "settle"; // settled while we were refreshing
      if (pos.status !== ACTIVE && !(p.step === "settle" && pos.status === SETTLED)) {
        throw new GapAbort(`the account's cover is ${COVER_STATUS[pos.status] ?? pos.status}, not Active`);
      }
      if (!(c.fridayDrawdownBps < pos.limitBps && pos.limitBps < c.mondayDrawdownBps && c.mondayDrawdownBps < 10_000)) {
        throw new GapAbort(
          `need fridayDrawdownBps (${c.fridayDrawdownBps}) < limitBps (${pos.limitBps}) < mondayDrawdownBps (${c.mondayDrawdownBps}) < 10000`,
        );
      }
      if (c.weekendSeconds <= market.maxPriceAge) {
        ctx.log.warn("gap-weekend-short", { weekendSeconds: c.weekendSeconds, maxPriceAge: market.maxPriceAge, note: "prices may not go stale" });
      }
      if (p.step === "friday") {
        Object.assign(p.record, {
          label: GAP_LABEL,
          description:
            "Scripted gap on the replay market, after the replay of real prices ended. Our keeper pushed a scripted " +
            `"Friday close" (the account ${c.fridayDrawdownBps / 100}% down), pushed nothing for a ${c.weekendSeconds}-second ` +
            `"weekend" so the prices went stale, then pushed a scripted "Monday open" gap (${c.mondayDrawdownBps / 100}% down). ` +
            "Our keeper then settled the cover at the fresh Monday prices and the underwriter's bond paid the loss " +
            "beyond the limit. The gap prices are scripted, not real.",
          chainId: ctx.cfg.expectedChainId,
          market: "replay",
          marketAddress: market.address,
          cover: c.cover,
          account: c.account,
          user: pos.user,
          agent,
          keeper: ctx.keeper,
          limitBps: pos.limitBps,
          principal: usd(pos.principal),
          principalRaw: pos.principal.toString(),
          startedAt: p.startedAt,
        });
        ctx.log.info("gap-start", { label: GAP_LABEL, cover: c.cover, account: c.account, limitBps: pos.limitBps, principal: pos.principal });
      }
      for (;;) {
        const step = p.step;
        if (step === "friday") await friday(p);
        else if (step === "weekend") await weekend(p);
        else if (step === "monday") await monday(p);
        else {
          await settled(p);
          writeJson(paths.output, p.record);
          finish(control);
          ctx.log.info("gap-done", { label: GAP_LABEL, output: paths.output, summary: p.record.summary });
          return;
        }
        writeJson(paths.progress, p);
      }
    } catch (e) {
      if (!(e instanceof GapAbort)) throw e; // transient: progress is saved; the next tick resumes
      const failed = join(paths.stateDir, `gap-failed-${Date.now()}.json`);
      writeJson(failed, { ...p, error: e.message });
      finish(control);
      ctx.log.error("gap-aborted", { label: GAP_LABEL, reason: e.message, saved: failed });
    }
  }

  return async function gapTick(): Promise<void> {
    if (!existsSync(paths.control)) return;
    let control: GapControl;
    try {
      control = parseControl(readFileSync(paths.control, "utf8"));
    } catch (e) {
      const msg = describeError(e).message as string;
      if (msg !== lastControlError) ctx.log.error("gap-control-invalid", { file: paths.control, error: msg });
      lastControlError = msg;
      return;
    }
    lastControlError = "";
    const phase = replayPhase(ctx);
    if (phase !== "ended") {
      ctx.once(`gap-wait-${phase}`, "info", "gap-waiting", {
        replayPhase: phase,
        note: "the scripted gap runs only after the replay window has ended",
      });
      return;
    }
    if (nowSec() < retryAt) return;
    try {
      await run(control);
    } catch (e) {
      retryAt = nowSec() + 30;
      throw e; // logged by the loop; progress is saved and the scenario resumes in 30 s
    }
  };
}
