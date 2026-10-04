// Replay driver: pushes the real TSLA and AMZN Chainlink prices of 28 Sep - 2 Oct 2026 into the replay feeds, sped
// up, with fresh timestamps. Stateless: the position is derived from the start time and the clock, so the process
// can restart or move machines. Before the start it does nothing; after the window it stops, and the replay prices
// go stale ("market closed").
import { iso, nowSec, replayEndsAt, replayTimeAt } from "./config.ts";
import { pushWithBlockTime, type Ctx } from "./context.ts";
import { answerAt, loadSeries } from "./replay-data.ts";

export type ReplayPhase = "unscheduled" | "waiting" | "running" | "ended";

export function replayPhase(ctx: Pick<Ctx, "cfg">, now = nowSec()): ReplayPhase {
  const s = ctx.cfg.replay;
  if (s.startsAt === null) return "unscheduled";
  const t = replayTimeAt(s, now);
  if (t === null) return "waiting";
  return t >= s.windowEnd ? "ended" : "running";
}

export function createReplay(ctx: Ctx) {
  const series = loadSeries();
  const s = ctx.cfg.replay;
  let pushes = 0;

  return async function replayTick(): Promise<void> {
    const now = nowSec();
    const phase = replayPhase(ctx, now);
    if (phase === "unscheduled") {
      ctx.once("replay-unscheduled", "info", "replay-unscheduled", {
        note: "no replay start time (deployment replay.startsAt or REPLAY_STARTS_AT); replay feeds untouched",
      });
      return;
    }
    if (phase === "waiting") {
      ctx.once("replay-waiting", "info", "replay-waiting", { startsAt: iso(s.startsAt!), inSeconds: s.startsAt! - now });
      return;
    }
    if (phase === "ended") {
      ctx.once("replay-ended", "info", "replay-ended", {
        endedAt: iso(replayEndsAt(s)!),
        note: "replay window over: no more pushes, replay prices go stale (market closed)",
        pushes,
      });
      return;
    }

    const t = replayTimeAt(s, now)!;
    for (const asset of ctx.markets.replay.assets) {
      const round = answerAt(series[asset.symbol], t);
      if (!round) continue;
      const res = await pushWithBlockTime(ctx, asset.feed, round.answer, `replay ${asset.symbol}`, {
        feedKind: "replay",
        symbol: asset.symbol,
        replayTime: iso(t),
      });
      if (res.sent?.ok) {
        pushes++;
        ctx.log.info("replay-pushed", {
          symbol: asset.symbol,
          answer: round.answer,
          replayTime: iso(t),
          sourceRound: round.roundId,
          sourceUpdatedAt: iso(round.updatedAt),
          updatedAt: iso(res.updatedAt!),
          tx: res.sent.hash,
        });
      } else if (!res.sent) {
        ctx.log.debug("replay-skip", { symbol: asset.symbol, note: "no block newer than the feed's latest round yet" });
      }
    }
  };
}
