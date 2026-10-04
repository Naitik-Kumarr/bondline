// Live mirror: copies Chainlink's TSLA/USD and AMZN/USD rounds from Robinhood Chain mainnet into the live
// MirrorFeeds, with their real values and real timestamps. Unchanged rounds are skipped, so over a weekend the live
// prices stay exactly as stale as they are on mainnet.
import { createPublicClient, type PublicClient } from "viem";
import { aggregatorV3Abi, MAINNET_FEEDS, mirrorFeedAbi, robinhoodMainnet } from "@bondline/shared";
import { iso, transport } from "./config.ts";
import { feedLatest, type Ctx } from "./context.ts";

export function mainnetClient(): PublicClient {
  const url = process.env.MAINNET_RPC_URL ?? robinhoodMainnet.rpcUrls.default.http[0];
  return createPublicClient({ chain: robinhoodMainnet, transport: transport(url, "keeper") }) as PublicClient;
}

export function createMirror(ctx: Ctx, mainnet: PublicClient = mainnetClient()) {
  return async function mirrorTick(): Promise<void> {
    for (const asset of ctx.markets.live.assets) {
      const source = MAINNET_FEEDS[asset.symbol];
      const [roundId, answer, , updatedAt] = await mainnet.readContract({
        address: source,
        abi: aggregatorV3Abi,
        functionName: "latestRoundData",
      });
      const mirrored = await feedLatest(ctx.client, asset.feed);
      const key = `mirror-${asset.symbol}`;

      if (updatedAt <= mirrored.updatedAt) {
        if (updatedAt < mirrored.updatedAt) {
          ctx.once(`${key}-behind-${mirrored.updatedAt}`, "warn", "mirror-feed-ahead", {
            symbol: asset.symbol,
            mainnetUpdatedAt: iso(updatedAt),
            liveFeedUpdatedAt: iso(mirrored.updatedAt),
            note: "the live feed already holds a newer timestamp than mainnet; nothing to push",
          });
        }
        continue; // unchanged round
      }
      if (answer <= 0n) {
        ctx.once(`${key}-invalid-${roundId}`, "warn", "mirror-invalid-answer", { symbol: asset.symbol, roundId, answer });
        continue;
      }
      const block = await ctx.client.getBlock({ blockTag: "latest" });
      if (updatedAt > block.timestamp) {
        ctx.once(`${key}-ahead-${roundId}`, "info", "mirror-waiting", {
          symbol: asset.symbol,
          mainnetUpdatedAt: iso(updatedAt),
          testnetBlockTime: iso(block.timestamp),
          note: "mainnet round is newer than the testnet block time; waiting",
        });
        continue;
      }
      const sent = await ctx.queue.send(
        `mirror ${asset.symbol}`,
        async () => {
          const latest = await feedLatest(ctx.client, asset.feed);
          if (updatedAt <= latest.updatedAt) return null;
          return { address: asset.feed, abi: mirrorFeedAbi, functionName: "push", args: [answer, updatedAt] };
        },
        { feed: "live", symbol: asset.symbol, mainnetRoundId: roundId, answer, updatedAt: iso(updatedAt) },
      );
      if (sent?.ok) {
        ctx.log.info("mirror-pushed", {
          symbol: asset.symbol,
          answer,
          updatedAt: iso(updatedAt),
          mainnetRoundId: roundId,
          tx: sent.hash,
        });
      }
    }
  };
}
