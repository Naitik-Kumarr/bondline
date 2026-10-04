// The Bondline MCP server over stdio. Read tools and unsigned-transaction builders only: it holds no key and sends
// nothing. Env: BONDLINE_RPC_URL (default: the Robinhood Chain testnet public RPC), BONDLINE_RAW_DEPLOYMENT (a raw
// deploy file, for a local chain), BONDLINE_RECORDS_DIR (agent record snapshots; default shared/src/records).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Bondline, configFromEnv } from "@bondline/sdk";
import { registerBondlineTools } from "./tools.ts";

export function createBondlineServer(sdk: Bondline = new Bondline(configFromEnv()), opts: { recordsDir?: string } = {}): McpServer {
  const server = new McpServer(
    { name: "bondline", version: "0.1.0" },
    {
      instructions:
        "Bondline is the insurance market for AI traders on Robinhood Chain testnet, paid in USDG. Testnet, unaudited; a capped, fully backed protection bond, not regulated insurance. Read with list_offers, quote_cover and get_agent_record; build unsigned transactions with build_cover_transactions, build_offer_authorization and build_trade_transaction. This server holds no keys and sends nothing: sign and send with your own wallet. Money amounts are USDG; raw fields are base units (6 decimals).",
    },
  );
  registerBondlineTools(server, sdk, opts);
  return server;
}

export async function main(): Promise<void> {
  const server = createBondlineServer(undefined, { recordsDir: process.env.BONDLINE_RECORDS_DIR });
  await server.connect(new StdioServerTransport());
  console.error("bondline-mcp: ready on stdio");
}
