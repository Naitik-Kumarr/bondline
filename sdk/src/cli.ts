// `bondline`: read-only command line over the SDK. Prints JSON. Sends nothing, holds no key.
//   bondline offers [--market live|replay] [--agent 0x..] [--listed]
//   bondline quote --market replay --offer 0 --amount 100 --limit-bps 1000 [--user 0x..]
//   bondline record <agent address | careful | bold>
//   bondline accounts [--market ..] [--agent 0x..] [--user 0x..]
// RPC: BONDLINE_RPC_URL (default: the Robinhood Chain testnet public RPC).
import type { Address } from "viem";
import { Bondline } from "./client.ts";
import { configFromEnv, resolveAgentAddress as resolveAgent } from "./config.ts";
import { toJson } from "./units.ts";

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

const USAGE = `bondline: read Bondline offers, quotes, records and accounts (read-only, JSON output)

  bondline offers [--market live|replay] [--agent <address>] [--listed]
  bondline quote --market <m> --offer <id> --amount <usdg> --limit-bps <bps> [--user <address>]
  bondline record <address | careful | bold>
  bondline accounts [--market <m>] [--agent <address>] [--user <address>]

Set BONDLINE_RPC_URL to use another RPC (or BONDLINE_RAW_DEPLOYMENT + BONDLINE_RPC_URL for a local deployment). Unsigned transactions are built by the SDK (see docs/agents.md) and by
the MCP server (bondline-mcp); this command sends nothing.`;

const str = (v: string | true | undefined, name: string): string => {
  if (typeof v !== "string") throw new Error(`missing --${name}`);
  return v;
};

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const { positional, flags } = parseFlags(rest);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(USAGE);
    return;
  }
  const sdk = new Bondline(configFromEnv());
  let out: unknown;
  switch (cmd) {
    case "offers":
      out = await sdk.listOffers({
        market: typeof flags.market === "string" ? flags.market : undefined,
        agent: typeof flags.agent === "string" ? resolveAgent(flags.agent) : undefined,
        listedOnly: flags.listed === true,
      });
      break;
    case "quote":
      out = await sdk.quoteCover({
        market: str(flags.market, "market"),
        offerId: Number(str(flags.offer, "offer")),
        amount: str(flags.amount, "amount"),
        limitBps: Number(str(flags["limit-bps"], "limit-bps")),
        user: typeof flags.user === "string" ? (flags.user as Address) : undefined,
      });
      break;
    case "record": {
      const a = positional[0];
      if (!a) throw new Error("usage: bondline record <address | careful | bold>");
      out = sdk.getAgentRecord(resolveAgent(a));
      break;
    }
    case "accounts":
      out = await sdk.listAccounts({
        market: typeof flags.market === "string" ? flags.market : undefined,
        agent: typeof flags.agent === "string" ? resolveAgent(flags.agent) : undefined,
        user: typeof flags.user === "string" ? (flags.user as Address) : undefined,
      });
      break;
    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`);
      process.exitCode = 2;
      return;
  }
  console.log(JSON.stringify(toJson(out), null, 2));
}
