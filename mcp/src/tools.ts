// The Bondline MCP tools. Six tools, none of which holds a key or sends a transaction: three read the chain and
// the agent records, three build UNSIGNED transactions or typed data for the caller's own wallet to sign.
import { z } from "zod";
import { getAddress, type Hex } from "viem";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  Bondline,
  resolveAgentAddress,
  toJson,
  type OfferAuthorization,
  type UnsignedTransaction,
} from "@bondline/sdk";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "an 0x address");
const usdg = z.union([z.string(), z.number()]).describe('USDG as a decimal ("100" or "100.5"), at most 6 decimals');
const marketName = z.string().describe('"live" or "replay" (the testnet markets), or a market address');
const rulesSchema = z
  .object({
    assetMask: z.number().int().describe("bit i set allows asset i of the market"),
    maxStockBps: z.number().int().describe("most of the account's value in stocks after a buy, bps"),
    maxTradeBps: z.number().int().describe("largest single trade, bps of account value"),
    maxDailyBps: z.number().int().describe("most traded per day, bps of account value"),
    maxSlippageBps: z.number().int().describe("largest fill shortfall against the oracle price, bps (at most 500)"),
    maxPriceAge: z.number().int().describe("oldest price a trade may use, seconds"),
  })
  .partial()
  .describe("The account's rules; any you leave out take the SDK defaults (the same as the team's Careful agent).");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(toJson(value), null, 2) }] });
const fail = (e: unknown): ToolResult => ({ content: [{ type: "text", text: `error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
const guard = <A>(fn: (a: A) => Promise<unknown> | unknown) => async (a: A): Promise<ToolResult> => {
  try {
    return ok(await fn(a));
  } catch (e) {
    return fail(e);
  }
};

/** An unsigned transaction as a wallet expects it: hex-free JSON with value as a string. */
const txJson = (t: UnsignedTransaction) => ({
  to: t.to,
  from: t.from,
  data: t.data,
  value: t.value.toString(),
  chainId: t.chainId,
  description: t.description,
  call: t.call,
});

/** The authorization as JSON: strings for uint256 (what eth_signTypedData_v4 takes) plus the fields to rebuild it. */
const authorizationJson = (a: OfferAuthorization) => ({
  typedData: {
    domain: a.typedData.domain,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...a.typedData.types,
    },
    primaryType: a.typedData.primaryType,
    message: {
      from: a.typedData.message.from,
      to: a.typedData.message.to,
      value: a.typedData.message.value.toString(),
      validAfter: a.typedData.message.validAfter.toString(),
      validBefore: a.typedData.message.validBefore.toString(),
      nonce: a.typedData.message.nonce,
    },
  },
  authorization: {
    market: a.market,
    underwriter: a.typedData.message.from,
    terms: a.terms,
    bond: a.bond.toString(),
    validAfter: a.validAfter.toString(),
    validBefore: a.validBefore.toString(),
    nonce: a.nonce,
  },
});

const authorizationInput = z.object({
  market: address,
  underwriter: address,
  terms: z.object({ agent: address, minLimitBps: z.number().int(), maxLimitBps: z.number().int(), feeBps: z.number().int(), maxStockBps: z.number().int(), name: z.string() }),
  bond: z.string(),
  validAfter: z.string(),
  validBefore: z.string(),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export function registerBondlineTools(server: McpServer, sdk: Bondline, opts: { recordsDir?: string } = {}): void {
  server.registerTool(
    "list_offers",
    {
      title: "List offers",
      description:
        "Bondline offers on each market: terms (limit range, premium, max stock share), bond, reserved, free, lifetime premiums, claims paid and number of covered accounts. Money is USDG base units (6 decimals). Optionally filter by market or by the agent an offer backs.",
      inputSchema: { market: marketName.optional(), agent: z.string().optional().describe("an address, or 'careful' / 'bold'"), listed_only: z.boolean().optional() },
      annotations: READ,
    },
    guard(async (a: { market?: string; agent?: string; listed_only?: boolean }) => {
      const offers = await sdk.listOffers({ market: a.market, agent: a.agent ? resolveAgentAddress(a.agent) : undefined, listedOnly: a.listed_only });
      return { chainId: sdk.config.chainId, usdg: sdk.config.usdg, markets: sdk.config.markets.map((m) => ({ key: m.key, address: m.address })), offers };
    }),
  );

  server.registerTool(
    "quote_cover",
    {
      title: "Quote a cover",
      description:
        "What a cover would cost and whether it would go through: premium, principal, loss limit, the bond it reserves, whether the offer's free bond allows it, plus the reference price from the published model (not actuarial) and the agent's record. `problems` lists everything the contract would refuse.",
      inputSchema: { market: marketName, offer_id: z.number().int().min(0), amount: usdg, limit_bps: z.number().int(), rules: rulesSchema.optional(), user: address.optional().describe("also check this address's USDG balance") },
      annotations: READ,
    },
    guard((a: { market: string; offer_id: number; amount: string | number; limit_bps: number; rules?: Record<string, number>; user?: string }) =>
      sdk.quoteCover({ market: a.market, offerId: a.offer_id, amount: a.amount, limitBps: a.limit_bps, rules: a.rules, user: a.user ? getAddress(a.user) : undefined, recordsDir: opts.recordsDir }),
    ),
  );

  server.registerTool(
    "get_agent_record",
    {
      title: "Get an agent's record",
      description:
        "An agent's public record snapshot (from shared/src/records): score, trades, refusals, exposure, drawdown, claims and the two reference prices. It is a snapshot with a generatedAt time, rebuilt from chain events by `npm run record`; an agent with no record returns record: null.",
      inputSchema: { agent: z.string().describe("an address, or 'careful' / 'bold'"), full: z.boolean().optional().describe("include accounts and recent actions") },
      annotations: READ,
    },
    guard((a: { agent: string; full?: boolean }) => {
      const loaded = sdk.getAgentRecord(resolveAgentAddress(a.agent), opts.recordsDir);
      const r = loaded.record;
      if (!r || a.full) return loaded;
      const { accounts: _accounts, recent: _recent, offers: _offers, ...compact } = r;
      return { ...loaded, record: compact };
    }),
  );

  server.registerTool(
    "build_cover_transactions",
    {
      title: "Build cover transactions",
      description:
        "UNSIGNED transactions for a user to buy cover, to send in order from `user`: (1) USDG.approve for exactly the deposit, (2) cover.open(limitBps, rules, amount). Refuses if the quote has problems. Nothing is sent: sign and send them with your own wallet.",
      inputSchema: { market: marketName, offer_id: z.number().int().min(0), user: address, amount: usdg, limit_bps: z.number().int(), rules: rulesSchema.optional() },
      annotations: READ,
    },
    guard(async (a: { market: string; offer_id: number; user: string; amount: string | number; limit_bps: number; rules?: Record<string, number> }) => {
      const { transactions, quote } = await sdk.buildCoverTransactions({ market: a.market, offerId: a.offer_id, user: getAddress(a.user), amount: a.amount, limitBps: a.limit_bps, rules: a.rules });
      return { sendInOrder: transactions.map(txJson), quote };
    }),
  );

  server.registerTool(
    "build_offer_authorization",
    {
      title: "Build offer authorization",
      description:
        "Underwrite an agent with ONE signature. Step 1: give the market, the underwriter, the agent (its address) and the terms and bond; get EIP-712 typed data (USDG ReceiveWithAuthorization) for the underwriter to sign. Step 2: call again with `authorization` (as returned) and `signature`; get the single createOfferWithAuthorization transaction the underwriter then sends. Nothing is signed or sent here.",
      inputSchema: {
        market: marketName.optional(),
        underwriter: address.optional(),
        agent: address.optional().describe("the outside agent the offer names: the only address that may trade accounts covered by it"),
        bond: usdg.optional(),
        min_limit_bps: z.number().int().optional(),
        max_limit_bps: z.number().int().optional(),
        fee_bps: z.number().int().optional().describe("premium taken from each deposit, at most 500"),
        max_stock_bps: z.number().int().optional(),
        name: z.string().optional().describe("offer display name, 1 to 64 bytes"),
        valid_for_seconds: z.number().int().positive().optional(),
        authorization: authorizationInput.optional().describe("step 2: the `authorization` object from step 1"),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).optional().describe("step 2: the underwriter's 65-byte signature"),
      },
      annotations: READ,
    },
    guard((a: Record<string, any>) => {
      if (a.signature || a.authorization) {
        if (!a.signature || !a.authorization) throw new Error("step 2 needs both `authorization` and `signature`");
        const x = a.authorization;
        const auth = sdk.restoreOfferAuthorization({ ...x, market: getAddress(x.market), underwriter: getAddress(x.underwriter), terms: { ...x.terms, agent: getAddress(x.terms.agent) }, nonce: x.nonce as Hex });
        return sdk.buildCreateOfferFromSignature({ authorization: auth, signature: a.signature as Hex }).then((tx) => ({ step: "send", sendFrom: auth.typedData.message.from, transaction: txJson(tx) }));
      }
      for (const k of ["market", "underwriter", "agent", "bond", "min_limit_bps", "max_limit_bps", "fee_bps", "max_stock_bps", "name"]) {
        if (a[k] === undefined) throw new Error(`step 1 needs ${k}`);
      }
      const auth = sdk.buildOfferAuthorization({
        market: a.market,
        underwriter: getAddress(a.underwriter),
        terms: { agent: getAddress(a.agent), minLimitBps: a.min_limit_bps, maxLimitBps: a.max_limit_bps, feeBps: a.fee_bps, maxStockBps: a.max_stock_bps, name: a.name },
        bond: a.bond,
        validForSeconds: a.valid_for_seconds,
      });
      return { step: "sign", ...authorizationJson(auth), next: "The underwriter signs `typedData` (eth_signTypedData_v4), then call this tool again with `authorization` and `signature`." };
    }),
  );

  server.registerTool(
    "build_trade_transaction",
    {
      title: "Build trade transaction",
      description:
        "An UNSIGNED AgentAccount.trade(asset, isBuy, usdAmount, minOut, decision) transaction for the account's agent to send from its own wallet. The decision JSON is written in canonical form (sorted keys, no whitespace); its keccak256 is the decisionHash the account's Traded or Blocked event will carry, returned here so you can check it. A trade the rules refuse does not revert: it emits Blocked and changes nothing.",
      inputSchema: {
        account: address.describe("the covered AgentAccount"),
        asset: z.string().describe("a stock symbol of the account's market (TSLA, AMZN) or its token address"),
        side: z.enum(["buy", "sell"]),
        usd_amount: z.union([z.string(), z.number()]).describe('USDG to spend (buy) or the USDG value to sell; "max" sells the whole balance'),
        min_out: z.string().optional().describe("least tokens (buy, 18 decimals) or USDG (sell, 6 decimals) accepted, in base units"),
        min_out_tolerance_bps: z.number().int().min(0).max(10_000).optional().describe("instead of min_out: take it from the demo exchange's current quote, less this many bps"),
        decision: z.union([z.record(z.unknown()), z.string()]).describe("the AI's decision as a JSON object (or a JSON string used as-is), at most 800 bytes"),
      },
      annotations: READ,
    },
    guard(async (a: { account: string; asset: string; side: "buy" | "sell"; usd_amount: string | number; min_out?: string; min_out_tolerance_bps?: number; decision: Record<string, unknown> | string }) => {
      const r = await sdk.buildTradeTransaction({ account: getAddress(a.account), asset: a.asset, side: a.side, usdAmount: a.usd_amount === "max" ? "max" : a.usd_amount, minOut: a.min_out, minOutToleranceBps: a.min_out_tolerance_bps, decision: a.decision });
      return { transaction: txJson(r.transaction), minOut: r.minOut, decision: r.decision, warnings: r.warnings, mustBeSentBy: r.transaction.from };
    }),
  );
}
