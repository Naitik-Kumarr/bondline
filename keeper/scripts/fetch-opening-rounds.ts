// Read-only: fetches, from Robinhood Chain mainnet, each replay feed's last Chainlink round before the replay window
// (the opening value) and adds it to keeper/data/replay-rounds.json. Also spot-checks the first and last in-window
// rounds against the chain. Sends no transactions.
//
//   npm run fetch-opening -w @bondline/keeper
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient } from "viem";
import { aggregatorV3Abi, deployment, robinhoodMainnet } from "@bondline/shared";
import { transport } from "../src/config.ts";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "replay-rounds.json");
const data = JSON.parse(readFileSync(file, "utf8"));
const rpc = process.env.MAINNET_RPC_URL ?? robinhoodMainnet.rpcUrls.default.http[0];
const client = createPublicClient({ chain: robinhoodMainnet, transport: transport(rpc, "keeper-data") });
const windowStart = deployment.replay.windowStart;

async function round(proxy: `0x${string}`, id: bigint) {
  const [roundId, answer, , updatedAt] = await client.readContract({
    address: proxy,
    abi: aggregatorV3Abi,
    functionName: "getRoundData",
    args: [id],
  });
  return { roundId: roundId.toString(), answer: answer.toString(), updatedAt: Number(updatedAt) };
}

for (const symbol of ["TSLA", "AMZN"]) {
  const s = data[symbol];
  const first = s.rounds[0];
  const last = s.rounds[s.rounds.length - 1];
  for (const r of [first, last]) {
    const onchain = await round(s.proxy, BigInt(r.roundId));
    if (onchain.answer !== r.answer || onchain.updatedAt !== r.updatedAt) {
      throw new Error(`${symbol} round ${r.roundId} differs from mainnet: ${JSON.stringify(onchain)}`);
    }
  }
  const opening = await round(s.proxy, BigInt(first.roundId) - 1n);
  if (!(opening.updatedAt < windowStart)) throw new Error(`${symbol} opening round is not before the window`);
  if (BigInt(opening.answer) <= 0n) throw new Error(`${symbol} opening answer is not positive`);
  // Put "opening" before "rounds" for readability.
  data[symbol] = { proxy: s.proxy, decimals: s.decimals, opening, rounds: s.rounds };
  console.log(
    `${symbol}: opening round ${opening.roundId} answer ${opening.answer} at ${new Date(opening.updatedAt * 1000).toISOString()}; ` +
      `first and last in-window rounds match mainnet`,
  );
}

writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
console.log(`updated ${file}`);
