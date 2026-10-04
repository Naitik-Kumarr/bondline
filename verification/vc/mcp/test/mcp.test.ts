// The MCP server exercised by a real MCP client over stdio, against a local Anvil chain (port 8562) with Bondline
// deployed by contracts/script/Deploy.s.sol (LOCAL=true). Anvil's public test keys sign; the server holds none.
// The server process is spawned as an agent host would spawn it (bin/bondline-mcp.mjs) and pointed at the local
// chain with BONDLINE_RAW_DEPLOYMENT and BONDLINE_RPC_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createPublicClient, createWalletClient, defineChain, erc20Abi, getAddress, http, keccak256, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentAccountAbi, bondlineCoverAbi, bondlineMarketAbi } from "@bondline/shared";
import { ANVIL_KEYS, CHAIN_ID, mintUsdg, startLocalChain, type LocalChain } from "../../sdk/test/local-chain.ts";

const BIN = new URL("../bin/bondline-mcp.mjs", import.meta.url).pathname;
const accounts = ANVIL_KEYS.map((k) => privateKeyToAccount(k));
const [, , underwriter, user, outsideAgent] = accounts;

let chain: LocalChain;
let client: Client;
let pub: PublicClient;
const localChain = () => defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [chain.rpcUrl] } } });
const wallet = (i: number) => createWalletClient({ account: accounts[i], chain: localChain(), transport: http(chain.rpcUrl) });

type Tx = { to: Address; from?: Address; data: Hex; value: string; chainId: number; description: string };
async function sendTx(i: number, tx: Tx) {
  assert.equal(tx.value, "0");
  assert.equal(tx.chainId, CHAIN_ID);
  if (tx.from) assert.equal(tx.from.toLowerCase(), accounts[i].address.toLowerCase());
  const hash = await wallet(i).sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return { hash, receipt };
}

/** Calls a tool and parses its JSON text. Fails the test if the tool reports an error. */
async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0].text;
  assert.ok(!r.isError, `${name} failed: ${text}`);
  return JSON.parse(text);
}
async function callError(name: string, args: Record<string, unknown>): Promise<string> {
  const r = await client.callTool({ name, arguments: args });
  assert.equal(r.isError, true, `${name} should have failed`);
  return (r.content as { text: string }[])[0].text;
}

before(async () => {
  chain = await startLocalChain();
  pub = createPublicClient({ chain: localChain(), transport: http(chain.rpcUrl) }) as PublicClient;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN],
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", BONDLINE_RAW_DEPLOYMENT: chain.rawPath, BONDLINE_RPC_URL: chain.rpcUrl },
    stderr: "pipe",
  });
  client = new Client({ name: "bondline-e2e", version: "0.0.0" });
  await client.connect(transport);
}, { timeout: 600_000 });

after(async () => {
  try {
    await client?.close();
  } finally {
    chain?.stop();
  }
});

describe("bondline MCP server over stdio", { concurrency: false }, () => {
  let offerCover: Address;
  let account: Address;

  it("announces itself and exactly the six tools, each read-only with a description and an input schema", async () => {
    assert.equal(client.getServerVersion()?.name, "bondline");
    assert.match(client.getInstructions() ?? "", /holds no keys and sends nothing/);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["build_cover_transactions", "build_offer_authorization", "build_trade_transaction", "get_agent_record", "list_offers", "quote_cover"]);
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 40, t.name);
      assert.equal(t.inputSchema.type, "object");
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} must not claim to write`);
    }
  });

  it("list_offers: an empty market, with the chain and both markets", async () => {
    const r = await call("list_offers", {});
    assert.equal(r.chainId, CHAIN_ID);
    assert.equal(r.offers.length, 0);
    assert.deepEqual(r.markets.map((m: { key: string }) => m.key), ["live", "replay"]);
  });

  it("build_offer_authorization: step 1 gives typed data, the underwriter signs once, step 2 gives the one transaction", async () => {
    await mintUsdg(chain, underwriter.address, 1000);
    const args = { market: "live", underwriter: underwriter.address, agent: outsideAgent.address, bond: "400", min_limit_bps: 500, max_limit_bps: 2000, fee_bps: 100, max_stock_bps: 3000, name: "MCP outside agent 1%" };
    const s1 = await call("build_offer_authorization", args);
    assert.equal(s1.step, "sign");
    assert.equal(s1.typedData.primaryType, "ReceiveWithAuthorization");
    assert.equal(s1.typedData.domain.name, "Global Dollar");
    assert.equal(s1.typedData.domain.chainId, CHAIN_ID);
    assert.equal(s1.typedData.message.value, "400000000");
    assert.equal(s1.typedData.message.from, underwriter.address);
    assert.ok(s1.typedData.types.EIP712Domain, "includes EIP712Domain for eth_signTypedData_v4 wallets");

    // an ordinary wallet signs the JSON as it is (uint256 fields are strings in the JSON; viem wants bigints)
    const { EIP712Domain: _d, ...types } = s1.typedData.types;
    const m = s1.typedData.message;
    const signature = await wallet(2).signTypedData({ account: underwriter, domain: s1.typedData.domain, types, primaryType: s1.typedData.primaryType, message: { ...m, value: BigInt(m.value), validAfter: BigInt(m.validAfter), validBefore: BigInt(m.validBefore) } });

    // the wrong signer is refused, before anything is sent
    const forged = await wallet(3).signTypedData({ account: user, domain: s1.typedData.domain, types, primaryType: s1.typedData.primaryType, message: { ...m, value: BigInt(m.value), validAfter: BigInt(m.validAfter), validBefore: BigInt(m.validBefore) } });
    assert.match(await callError("build_offer_authorization", { authorization: s1.authorization, signature: forged }), /not the underwriter/);
    assert.match(await callError("build_offer_authorization", { authorization: s1.authorization }), /both/);

    const s2 = await call("build_offer_authorization", { authorization: s1.authorization, signature });
    assert.equal(s2.step, "send");
    assert.equal(s2.sendFrom, underwriter.address);
    const { receipt } = await sendTx(2, s2.transaction);
    const created = parseEventLogs({ abi: bondlineMarketAbi, logs: receipt.logs, eventName: "OfferCreated" })[0];
    assert.equal(created.args.agent, outsideAgent.address);
    assert.equal(created.args.underwriter, underwriter.address);
    offerCover = created.args.cover;
    assert.equal(await pub.getTransactionCount({ address: underwriter.address }), 1, "one transaction, no separate approve");
  });

  it("build_offer_authorization rejects missing fields and terms the market would refuse", async () => {
    assert.match(await callError("build_offer_authorization", { market: "live" }), /step 1 needs/);
    const bad = { market: "live", underwriter: underwriter.address, agent: outsideAgent.address, bond: "10", min_limit_bps: 500, max_limit_bps: 3000, fee_bps: 100, max_stock_bps: 3000, name: "x" };
    assert.match(await callError("build_offer_authorization", bad), /maxLimitBps/);
  });

  it("list_offers, get_agent_record and quote_cover read the new offer", async () => {
    const r = await call("list_offers", { agent: outsideAgent.address });
    assert.equal(r.offers.length, 1);
    const o = r.offers[0];
    assert.equal(o.cover, offerCover);
    assert.equal(o.bond, "400000000");
    assert.equal(o.free, "400000000");
    assert.equal(o.reserved, "0");
    assert.equal(o.name, "MCP outside agent 1%");
    assert.deepEqual(o.terms, { minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000 });
    assert.equal((await call("list_offers", { listed_only: true, market: "replay" })).offers.length, 0);

    const none = await call("get_agent_record", { agent: outsideAgent.address });
    assert.equal(none.record, null);
    const careful = await call("get_agent_record", { agent: "careful" });
    assert.equal(careful.summary.name, "Careful");
    assert.equal(careful.record.hasRecord, false);
    assert.equal(careful.record.accounts, undefined, "compact by default");
    assert.ok((await call("get_agent_record", { agent: "careful", full: true })).record.accounts);

    await mintUsdg(chain, user.address, 300);
    const q = await call("quote_cover", { market: "live", offer_id: 0, amount: "100", limit_bps: 1000, user: user.address });
    assert.equal(q.ok, true);
    assert.equal(q.premium, "1000000");
    assert.equal(q.principal, "99000000");
    assert.equal(q.reservationNeeded, "19800000");
    assert.equal(q.capacityAllows, true);
    assert.equal(q.reference.label, "A reference price from a simple published model, not actuarial.");

    const refused = await call("quote_cover", { market: "live", offer_id: 0, amount: "5000", limit_bps: 500 });
    assert.equal(refused.ok, false);
    assert.match(refused.problems.join(" "), /not enough free bond/);
    assert.match(await callError("quote_cover", { market: "nowhere", offer_id: 0, amount: "1", limit_bps: 500 }), /unknown market/);
    assert.match(await callError("quote_cover", { market: "live", offer_id: 0, amount: "1.2345678", limit_bps: 500 }), /decimals/);
  });

  it("build_cover_transactions: approve exactly the deposit, then open; the user sends both", async () => {
    assert.match(await callError("build_cover_transactions", { market: "live", offer_id: 0, user: user.address, amount: "5000", limit_bps: 500 }), /refused/);
    const r = await call("build_cover_transactions", { market: "live", offer_id: 0, user: user.address, amount: "100", limit_bps: 1000, rules: { maxTradeBps: 1000, maxStockBps: 3000 } });
    assert.equal(r.sendInOrder.length, 2);
    assert.equal(r.sendInOrder[0].call.function, "approve");
    assert.equal(r.sendInOrder[0].call.args.amount, "100000000");
    assert.equal(r.sendInOrder[1].call.function, "open");
    await sendTx(3, r.sendInOrder[0]);
    const { receipt } = await sendTx(3, r.sendInOrder[1]);
    assert.equal(await pub.readContract({ address: chain.raw.usdg as Address, abi: erc20Abi, functionName: "allowance", args: [user.address, offerCover] }), 0n);
    const logs = parseEventLogs({ abi: bondlineCoverAbi, logs: receipt.logs });
    const opened = logs.find((l) => l.eventName === "Opened")!;
    assert.equal(opened.args.user, user.address);
    assert.equal(opened.args.limitBps, 1000);
    assert.equal(logs.find((l) => l.eventName === "Deposited")!.args.net, 99_000_000n);
    account = opened.args.account;
    const after = (await call("list_offers", { agent: outsideAgent.address })).offers[0];
    assert.equal(after.accounts, 1);
    assert.equal(after.reserved, "19800000");
  });

  it("build_trade_transaction: the agent sends it; the returned decision hash is the one the event carries", async () => {
    const decision = { action: "buy", asset: "AMZN", usdAmount: 8, reason: "MCP e2e: a small AMZN position, inside the per-trade rule." };
    const r = await call("build_trade_transaction", { account, asset: "AMZN", side: "buy", usd_amount: "8", min_out_tolerance_bps: 50, decision });
    assert.equal(r.mustBeSentBy, outsideAgent.address);
    assert.equal(r.transaction.call.function, "trade");
    assert.equal(r.decision.hash, keccak256(r.decision.hex));
    assert.equal(r.decision.json, '{"action":"buy","asset":"AMZN","reason":"MCP e2e: a small AMZN position, inside the per-trade rule.","usdAmount":8}');
    assert.deepEqual(r.warnings, []);
    assert.notEqual(r.minOut, "0");

    const { receipt } = await sendTx(4, r.transaction);
    const traded = parseEventLogs({ abi: agentAccountAbi, logs: receipt.logs, eventName: "Traded" })[0];
    assert.ok(traded);
    assert.equal(traded.address.toLowerCase(), account.toLowerCase());
    assert.equal(traded.args.decisionHash, r.decision.hash);
    assert.equal(traded.args.usdAmount, 8_000_000n);
    assert.ok(traded.args.amountOut >= BigInt(r.minOut));

    // sell everything, with the decision given as a JSON string (used byte for byte)
    const raw = '{"action":"sell","asset":"AMZN","reason":"MCP e2e: flat again"}';
    const sell = await call("build_trade_transaction", { account, asset: "AMZN", side: "sell", usd_amount: "max", min_out_tolerance_bps: 50, decision: raw });
    assert.equal(sell.decision.json, raw);
    const done = await sendTx(4, sell.transaction);
    const sold = parseEventLogs({ abi: agentAccountAbi, logs: done.receipt.logs, eventName: "Traded" })[0];
    assert.equal(sold.args.isBuy, false);
    assert.equal(sold.args.decisionHash, sell.decision.hash);
  });

  it("build_trade_transaction refuses bad input and warns about a missing floor", async () => {
    assert.match(await callError("build_trade_transaction", { account, asset: "NVDA", side: "buy", usd_amount: "1", decision: { a: 1 } }), /not one of this account's assets/);
    assert.match(await callError("build_trade_transaction", { account, asset: "TSLA", side: "hold", usd_amount: "1", decision: { a: 1 } }), /./);
    assert.match(await callError("build_trade_transaction", { account, asset: "TSLA", side: "buy", usd_amount: "1", decision: "{nope" }), /valid JSON/);
    const w = await call("build_trade_transaction", { account, asset: "TSLA", side: "buy", usd_amount: "1", decision: { action: "buy" } });
    assert.match(w.warnings.join(" "), /no minOut/);
    assert.equal(getAddress(w.transaction.to), getAddress(account));
  });
});
