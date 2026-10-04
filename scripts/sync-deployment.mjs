// Merges a raw forge deployment (deployments/raw-<chainId>.json) into the canonical record
// (deployments/rhTestnet.json) and syncs it to shared/src/deployment.json for the site and services.
// Usage: node scripts/sync-deployment.mjs 46630
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chainId = process.argv[2] ?? "46630";
const fork = process.argv.includes("--fork");
const raw = JSON.parse(readFileSync(join(root, "deployments", `raw-${chainId}.json`), "utf8"));
const recordPath = join(root, "deployments", "rhTestnet.json");
const record = JSON.parse(readFileSync(recordPath, "utf8"));

// The first block any deployment transaction landed in, from forge's broadcast receipts.
let deployBlock = raw.block;
const broadcast = join(root, "contracts", "broadcast", "Deploy.s.sol", chainId, "run-latest.json");
if (existsSync(broadcast)) {
  const run = JSON.parse(readFileSync(broadcast, "utf8"));
  const blocks = (run.receipts ?? []).map((r) => Number(BigInt(r.blockNumber)));
  if (blocks.length) deployBlock = Math.min(...blocks);
}

record.status = "deployed";
// A local fork of the testnet (scripts/dev-fork.sh) is flagged so it can never be mistaken for the real deployment.
if (fork) record.fork = true;
else delete record.fork;
record.deployedAt = new Date(raw.timestamp * 1000).toISOString();
record.usdg = raw.usdg;
record.assets = { TSLA: raw.tsla, AMZN: raw.amzn };
record.implementations = { cover: raw.coverImplementation, account: raw.accountImplementation };
record.markets.live = {
  ...record.markets.live,
  address: raw.liveMarket,
  venue: raw.liveVenue,
  deployBlock,
  maxPriceAge: raw.liveMaxPriceAge,
  spreadBps: raw.spreadBps,
  feeds: { TSLA: raw.tslaLiveFeed, AMZN: raw.amznLiveFeed },
};
record.markets.replay = {
  ...record.markets.replay,
  address: raw.replayMarket,
  venue: raw.replayVenue,
  deployBlock,
  maxPriceAge: raw.replayMaxPriceAge,
  spreadBps: raw.spreadBps,
  feeds: { TSLA: raw.tslaReplayFeed, AMZN: raw.amznReplayFeed },
};

const json = JSON.stringify(record, null, 2) + "\n";
writeFileSync(recordPath, json);
writeFileSync(join(root, "shared", "src", "deployment.json"), json);
console.log(`synced deployment (block ${deployBlock}): live ${raw.liveMarket}, replay ${raw.replayMarket}`);
