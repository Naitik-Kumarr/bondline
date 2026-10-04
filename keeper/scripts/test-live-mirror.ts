// Local test of the live mirror's push path, on Anvil only: deploys two fresh MirrorFeeds (keeper = KEEPER_PRIVATE_KEY,
// no first price, so mainnet's latest round is newer), runs the mirror against them twice, and checks that the first
// run copied mainnet's answers and timestamps and the second skipped the unchanged rounds. Needs `forge build` output.
//
//   RPC_URL=http://127.0.0.1:8547 BONDLINE_RAW_DEPLOYMENT=../deployments/raw-31337.json KEEPER_PRIVATE_KEY=0x.. \
//   npm run test:mirror -w @bondline/keeper
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, type Address, type Hex } from "viem";
import { aggregatorV3Abi, MAINNET_FEEDS, mirrorFeedAbi } from "@bondline/shared";
import { accountFromEnv, connect, loadEnvFile, loadNetConfig, readMarkets, transport } from "../src/config.ts";
import { feedLatest, onceLogger, type Ctx } from "../src/context.ts";
import { createLogger } from "../src/log.ts";
import { createMirror, mainnetClient } from "../src/mirror.ts";
import { TxQueue } from "../src/txqueue.ts";

loadEnvFile();
const cfg = loadNetConfig();
const { client, chain } = await connect(cfg, "keeper-test");
if (chain.id !== 31337) throw new Error("test:mirror runs only on a local Anvil chain");
const keeper = accountFromEnv("KEEPER_PRIVATE_KEY");
const wallet = createWalletClient({ account: keeper, chain, transport: transport(cfg.rpcUrl, "keeper-test") });
const log = createLogger("keeper-test");

const artifact = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "out", "MirrorFeed.sol", "MirrorFeed.json"), "utf8"),
);
const deploy = async (description: string): Promise<Address> => {
  const hash = await wallet.deployContract({ abi: mirrorFeedAbi, bytecode: artifact.bytecode.object as Hex, args: [keeper.address, 8, description] });
  const receipt = await client.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
};

const markets = await readMarkets(client, cfg);
const feeds = { TSLA: await deploy("TSLA test mirror"), AMZN: await deploy("AMZN test mirror") };
markets.live = { ...markets.live, assets: markets.live.assets.map((a) => ({ ...a, feed: feeds[a.symbol] })) };
const queue = new TxQueue(client, wallet, log);
const ctx: Ctx = { cfg, client, queue, markets, log, keeper: keeper.address, ...onceLogger(log) };
const mainnet = mainnetClient();
const mirror = createMirror(ctx, mainnet);

await mirror();
const sentAfterFirst = queue.sent;
await mirror();
const sentAfterSecond = queue.sent;

let ok = sentAfterFirst === 2 && sentAfterSecond === 2;
for (const symbol of ["TSLA", "AMZN"] as const) {
  const [, answer, , updatedAt] = await mainnet.readContract({ address: MAINNET_FEEDS[symbol], abi: aggregatorV3Abi, functionName: "latestRoundData" });
  const local = await feedLatest(client, feeds[symbol]);
  const match = local.answer === answer && local.updatedAt === updatedAt;
  ok &&= match;
  console.log(`${symbol}: mainnet ${answer} @ ${updatedAt}; mirrored ${local.answer} @ ${local.updatedAt}: ${match ? "match" : "MISMATCH"}`);
}
console.log(`pushes: first run ${sentAfterFirst}, second run ${sentAfterSecond - sentAfterFirst} (unchanged rounds skipped)`);
console.log(ok ? "live mirror test passed" : "live mirror test FAILED");
process.exit(ok ? 0 : 1);
