// Turns the keeper's record of the scripted gap claim (deployments/gap-demo.json) into the hero's data
// (web/src/data/gap-demo.json), so the landing page replays the real claim with its real numbers and transaction.
// Usage: node scripts/sync-gap-demo.mjs [path-to-gap-demo.json]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2] ?? join(root, "deployments", "gap-demo.json");
if (source.includes("fork")) throw new Error("refusing to publish a fork's gap record as the real claim");
const g = JSON.parse(readFileSync(source, "utf8"));
if (g.chainId !== 46630 || !g.settle?.tx) throw new Error("not a completed testnet gap claim");

const principal = Number(g.summary.principal);
const hero = {
  status: "real",
  accountUsd: principal,
  limitBps: g.limitBps,
  fridayDrawdownBps: g.friday.drawdownBps,
  mondayDrawdownBps: g.monday.drawdownBps,
  userLossUsd: Number(g.summary.userLoses),
  bondPaysUsd: Number(g.summary.bondPays),
  settleTx: g.settle.tx,
  market: "replay",
  note:
    "Scripted gap on the Replay market (Robinhood Chain testnet): a team-operated test cover behind Bold, settled by our keeper.",
};
const out = join(root, "web", "src", "data", "gap-demo.json");
writeFileSync(out, JSON.stringify(hero, null, 2) + "\n");
console.log(`hero now replays the real claim: $${hero.accountUsd} account, you lose $${hero.userLossUsd}, bond pays $${hero.bondPaysUsd} (${hero.settleTx})`);
