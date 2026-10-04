// Verifies an agent decision from the chain alone: decodes AgentAccount.trade's input, re-hashes the decision bytes and
// compares the hash with the one in the Traded or Blocked event. Read-only.
//
//   TX=0x<hash> RPC_URL=... npm run verify-decision -w @bondline/agents
import { createPublicClient, decodeFunctionData, hexToString, isHash, keccak256, parseEventLogs, type Hex } from "viem";
import { agentAccountAbi, BLOCK_REASONS, robinhoodTestnet } from "@bondline/shared";
import { transport } from "../src/config.ts";

const hash = process.env.TX ?? process.argv[2];
if (!hash || !isHash(hash)) throw new Error("pass a transaction hash as TX=0x... or the first argument");
const client = createPublicClient({ transport: transport(process.env.RPC_URL ?? robinhoodTestnet.rpcUrls.default.http[0], "verify") });

const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
const { functionName, args } = decodeFunctionData({ abi: agentAccountAbi, data: tx.input });
if (functionName !== "trade") throw new Error(`${hash} calls ${functionName}, not trade`);
const decision = args[4] as Hex;
const rehash = keccak256(decision);
const [ev] = parseEventLogs({ abi: agentAccountAbi, logs: receipt.logs }).filter(
  (l) => (l.eventName === "Traded" || l.eventName === "Blocked") && l.address.toLowerCase() === tx.to?.toLowerCase(),
);
if (!ev) throw new Error("no Traded or Blocked event from the account in this transaction");
const eventHash = (ev.args as { decisionHash: Hex }).decisionHash;
console.log(
  JSON.stringify(
    {
      tx: hash,
      account: tx.to,
      agent: tx.from,
      outcome: ev.eventName,
      refusal: ev.eventName === "Blocked" ? BLOCK_REASONS[Number((ev.args as { reason: number }).reason)]?.label : undefined,
      decision: JSON.parse(hexToString(decision)),
      rehash,
      eventHash,
      verified: rehash === eventHash,
    },
    null,
    2,
  ),
);
if (rehash !== eventHash) process.exit(1);
