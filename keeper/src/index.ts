// Bondline keeper: one process, one wallet, one transaction queue.
//   1. live mirror: Chainlink TSLA/AMZN on Robinhood Chain mainnet -> the live MirrorFeeds (real values, real times)
//   2. replay driver: the real 28 Sep - 2 Oct prices, sped up, into the replay MirrorFeeds (fresh timestamps)
//   3. settle loop: settles every covered account whose loss has passed its limit, in both markets
//   4. scripted gap demo, triggered by state/gap.json after the replay window ends
import { createWalletClient, formatEther } from "viem";
import { mirrorFeedAbi } from "@bondline/shared";
import {
  accountFromEnv,
  connect,
  envNumber,
  iso,
  loadEnvFile,
  loadNetConfig,
  readMarkets,
  replayEndsAt,
  rpcHost,
  sleep,
  transport,
} from "./config.ts";
import { onceLogger, type Ctx } from "./context.ts";
import { createGap, gapPaths } from "./gap.ts";
import { createLogger, describeError } from "./log.ts";
import { createMirror } from "./mirror.ts";
import { createReplay } from "./replay.ts";
import { createSettler } from "./settle.ts";
import { TxQueue } from "./txqueue.ts";

const envFile = loadEnvFile();
const log = createLogger("keeper");

process.on("unhandledRejection", (e) => log.error("unhandled-rejection", { error: describeError(e) }));

async function main() {
  const cfg = loadNetConfig();
  const { client, chain } = await connect(cfg, "keeper");
  const keeper = accountFromEnv("KEEPER_PRIVATE_KEY");
  const wallet = createWalletClient({ account: keeper, chain, transport: transport(cfg.rpcUrl, "keeper") });
  const markets = await readMarkets(client, cfg);
  const queue = new TxQueue(client, wallet, log);
  const ctx: Ctx = { cfg, client, queue, markets, log, keeper: keeper.address, ...onceLogger(log) };

  const intervals = {
    live: envNumber("LIVE_INTERVAL_SECONDS", 30),
    replay: envNumber("REPLAY_INTERVAL_SECONDS", 25),
    settle: envNumber("SETTLE_INTERVAL_SECONDS", 15),
    gap: envNumber("GAP_POLL_SECONDS", 5),
  };
  const enabled = { live: process.env.LIVE_MIRROR !== "0", replay: process.env.REPLAY !== "0" };

  const balance = await client.getBalance({ address: keeper.address });
  log.info("start", {
    keeper: keeper.address,
    chainId: chain.id,
    rpc: rpcHost(cfg.rpcUrl),
    deployment: cfg.source,
    envFile: envFile ?? "none",
    ethBalance: formatEther(balance),
    markets: Object.fromEntries(
      Object.values(markets).map((m) => [
        m.key,
        { address: m.address, label: m.label, maxPriceAge: m.maxPriceAge, feeds: Object.fromEntries(m.assets.map((a) => [a.symbol, a.feed])) },
      ]),
    ),
    replay: {
      windowStart: iso(cfg.replay.windowStart),
      windowEnd: iso(cfg.replay.windowEnd),
      speed: cfg.replay.speed,
      startsAt: cfg.replay.startsAt === null ? null : iso(cfg.replay.startsAt),
      endsAt: replayEndsAt(cfg.replay) === null ? null : iso(replayEndsAt(cfg.replay)!),
    },
    intervals,
    enabled,
    gapControlFile: gapPaths(chain.id).control,
    gapOutput: gapPaths(chain.id).output,
    log: log.file,
  });
  if (balance === 0n) log.warn("no-gas", { keeper: keeper.address, note: "the keeper wallet has no ETH; sends will fail" });

  // Every feed must name this wallet as its keeper, or pushes revert NotKeeper.
  for (const m of Object.values(markets)) {
    for (const a of m.assets) {
      const k = await client.readContract({ address: a.feed, abi: mirrorFeedAbi, functionName: "keeper" });
      if (k.toLowerCase() !== keeper.address.toLowerCase()) {
        log.error("feed-keeper-mismatch", { market: m.key, symbol: a.symbol, feed: a.feed, feedKeeper: k, keeper: keeper.address });
      }
    }
  }

  const stops: (() => void)[] = [];
  const loop = (name: string, seconds: number, fn: () => Promise<void>) => {
    let stopped = false;
    stops.push(() => (stopped = true));
    void (async () => {
      while (!stopped) {
        const started = Date.now();
        try {
          await fn();
        } catch (e) {
          log.error(`${name}-error`, { error: describeError(e) });
        }
        await sleep(Math.max(1_000, seconds * 1000 - (Date.now() - started)));
      }
    })();
  };

  const settler = createSettler(ctx);
  loop("settle", intervals.settle, settler.settleTick); // never disabled
  if (enabled.live) loop("mirror", intervals.live, createMirror(ctx));
  if (enabled.replay) loop("replay", intervals.replay, createReplay(ctx));
  loop("gap", intervals.gap, createGap(ctx));
  loop("heartbeat", envNumber("HEARTBEAT_SECONDS", 300), async () => {
    const eth = await client.getBalance({ address: keeper.address });
    log.info("heartbeat", { ethBalance: formatEther(eth), txSent: queue.sent, queued: queue.pending, settle: settler.stats });
  });

  const shutdown = async (signal: string) => {
    log.info("stopping", { signal, queued: queue.pending });
    stops.forEach((s) => s());
    await queue.drain(15_000);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  log.error("fatal", { error: describeError(e) });
  // Give the log a moment to flush, then exit non-zero so systemd restarts us.
  setTimeout(() => process.exit(1), 200);
});
