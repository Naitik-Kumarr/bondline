import type { Address, PublicClient } from "viem";
import { mirrorFeedAbi, type MarketKey } from "@bondline/shared";
import type { MarketInfo, NetConfig } from "./config.ts";
import type { Fields, Logger } from "./log.ts";
import type { SentTx, TxQueue } from "./txqueue.ts";

export interface Ctx {
  cfg: NetConfig;
  client: PublicClient;
  queue: TxQueue;
  markets: Record<MarketKey, MarketInfo>;
  log: Logger;
  keeper: Address;
  /** Logs `event` only the first time `key` is seen (until `forget(key)`). */
  once(key: string, level: "info" | "warn", event: string, fields?: Fields): void;
  forget(key: string): void;
}

export function onceLogger(log: Logger): Pick<Ctx, "once" | "forget"> {
  const seen = new Set<string>();
  return {
    once(key, level, event, fields) {
      if (seen.has(key)) return;
      seen.add(key);
      log[level](event, fields);
    },
    forget(key) {
      seen.delete(key);
    },
  };
}

export interface FeedRound {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
}

export async function feedLatest(client: PublicClient, feed: Address): Promise<FeedRound> {
  const [roundId, answer, , updatedAt] = await client.readContract({
    address: feed,
    abi: mirrorFeedAbi,
    functionName: "latestRoundData",
  });
  return { roundId: BigInt(roundId), answer, updatedAt };
}

export interface PushResult {
  sent: SentTx | null;
  /** The timestamp pushed; null if skipped because no block newer than the feed's latest exists yet. */
  updatedAt: bigint | null;
}

/**
 * Pushes `answer` to a MirrorFeed with the latest block's timestamp: never in the future, as fresh as the chain
 * allows. Runs in the queue, so the timestamp is read right before the send. If no block newer than the feed's latest
 * round exists yet, it waits a moment and, on a chain that has gone quiet, sends a zero-value self-transfer to get a
 * new block; it gives up (updatedAt null) after a few tries.
 */
export async function pushWithBlockTime(ctx: Ctx, feed: Address, answer: bigint, label: string, fields: Fields): Promise<PushResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let updatedAt: bigint | null = null;
    const sent = await ctx.queue.send(
      label,
      async () => {
        const [block, latest] = await Promise.all([ctx.client.getBlock({ blockTag: "latest" }), feedLatest(ctx.client, feed)]);
        if (block.timestamp <= latest.updatedAt) return null;
        updatedAt = block.timestamp;
        return { address: feed, abi: mirrorFeedAbi, functionName: "push", args: [answer, block.timestamp] };
      },
      { feed, answer, ...fields },
    );
    if (sent) return { sent, updatedAt };
    await new Promise((r) => setTimeout(r, 1_100)); // a busy chain has a newer block within a second
    if (attempt > 0) await ctx.queue.nudge(`nudge for ${label}`);
  }
  return { sent: null, updatedAt: null };
}
