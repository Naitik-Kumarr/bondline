// End to end on a local Anvil chain (port 8562) with Bondline deployed by contracts/script/Deploy.s.sol (LOCAL=true).
// Every key is one of Anvil's public test keys; the "outside agent" is an Anvil key standing in for a third party.
// Nothing here touches a public chain. The SDK only builds unsigned transactions: this test's own wallets sign them.
//
//   1. an underwriter backs the outside agent with ONE signature (USDG EIP-3009) and ONE transaction
//   2. a user opens a cover with the SDK's two transactions (approve exactly the deposit, then open)
//   3. the outside agent trades the user's account with SDK-built trade transactions: one executed, one refused
//   4. events and the decision hash are checked, by the SDK and independently from the raw transaction
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  parseAbi,
  toFunctionSelector,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentAccountAbi, bondlineCoverAbi, bondlineMarketAbi, BLOCK_REASONS } from "@bondline/shared";
import { Bondline, configFromRaw, type UnsignedTransaction } from "../src/index.ts";
import { ANVIL_KEYS, mintUsdg, startLocalChain, type LocalChain } from "./local-chain.ts";

const mockAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);

let chain: LocalChain;
let sdk: Bondline;
let pub: PublicClient;
const accounts = ANVIL_KEYS.map((k) => privateKeyToAccount(k));
const [deployer, , underwriter, user, outsideAgent, user2, agent2] = accounts;
const wallet = (i: number): WalletClient => createWalletClient({ account: accounts[i], chain: sdk.config.chain, transport: http(chain.rpcUrl) });

/** Sends an SDK-built unsigned transaction from `w` and waits for it. The test refuses a tx meant for someone else. */
async function send(w: WalletClient, tx: UnsignedTransaction) {
  if (tx.from) assert.equal(tx.from.toLowerCase(), w.account!.address.toLowerCase(), "the SDK says another address must send this");
  assert.equal(tx.chainId, sdk.config.chainId);
  assert.equal(tx.value, 0n);
  const hash = await w.sendTransaction({ account: w.account!, chain: sdk.config.chain, to: tx.to, data: tx.data, value: tx.value });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", tx.description);
  return { hash, receipt };
}

const mint = (to: Address, usdg: string) => mintUsdg(chain, to, Number(usdg));
const balance = (who: Address) => pub.readContract({ address: sdk.config.usdg, abi: erc20Abi, functionName: "balanceOf", args: [who] });

const TERMS = { agent: outsideAgent.address, minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000, name: "Outside agent 1%" };
const RULES = { assetMask: 3, maxStockBps: 3000, maxTradeBps: 1000, maxDailyBps: 20_000, maxSlippageBps: 50, maxPriceAge: 14_400 };

let offerId = -1;
let cover: Address;
let account: Address;

before(async () => {
  chain = await startLocalChain();
  sdk = new Bondline(configFromRaw(chain.raw, chain.rpcUrl));
  pub = createPublicClient({ chain: sdk.config.chain, transport: http(chain.rpcUrl) }) as PublicClient;
  assert.equal(deployer.address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"); // Anvil #0
}, { timeout: 600_000 });

after(() => chain?.stop());

describe("end to end on a local chain", { concurrency: false }, () => {
  it("the SDK sees the empty market and both markets' assets", async () => {
    assert.deepEqual(await sdk.listOffers(), []);
    const live = await sdk.getMarket("live");
    assert.deepEqual(live.assets.map((a) => a.symbol), ["TSLA", "AMZN"]);
    assert.equal(live.capBps, 3000);
  });

  it("underwriting: ONE signature and ONE transaction create and fund an offer naming the outside agent", async () => {
    await mint(underwriter.address, "1000");
    assert.equal(await pub.getTransactionCount({ address: underwriter.address }), 0);

    const auth = sdk.buildOfferAuthorization({ market: "live", underwriter: underwriter.address, terms: TERMS, bond: "500" });
    assert.equal(auth.typedData.domain.chainId, 8562);
    assert.equal(auth.typedData.message.to, sdk.marketConfig("live").address);
    const signature = await wallet(2).signTypedData({ account: underwriter, ...auth.typedData });
    const tx = await sdk.buildCreateOfferFromSignature({ authorization: auth, signature });
    // a signature from anyone else is refused before it is ever sent
    const forged = await wallet(3).signTypedData({ account: user, ...auth.typedData });
    await assert.rejects(sdk.buildCreateOfferFromSignature({ authorization: auth, signature: forged }), /not the underwriter/);

    // no approve was ever sent: the allowance is zero, and the underwriter's whole footprint is this one transaction
    assert.equal(await pub.readContract({ address: sdk.config.usdg, abi: erc20Abi, functionName: "allowance", args: [underwriter.address, auth.market] }), 0n);
    const { receipt } = await send(wallet(2), tx);
    assert.equal(await pub.getTransactionCount({ address: underwriter.address }), 1);

    const market = parseEventLogs({ abi: bondlineMarketAbi, logs: receipt.logs });
    const created = market.find((l) => l.eventName === "OfferCreated")!;
    const funded = market.find((l) => l.eventName === "OfferFunded")!;
    assert.equal(created.args.underwriter, underwriter.address);
    assert.equal(created.args.agent, outsideAgent.address);
    assert.equal(funded.args.bond, 500_000_000n);
    const used = parseEventLogs({ abi: mockAbi, logs: receipt.logs }).find((l) => l.eventName === "AuthorizationUsed")!;
    assert.equal(used.args.authorizer, underwriter.address);
    assert.equal(used.args.nonce, auth.nonce);
    assert.equal(await balance(auth.market), 0n, "the market keeps no USDG");

    const offers = await sdk.listOffers({ agent: outsideAgent.address });
    assert.equal(offers.length, 1);
    const o = offers[0];
    offerId = o.id;
    cover = o.cover;
    assert.equal(o.underwriter, underwriter.address);
    assert.equal(o.agent, outsideAgent.address);
    assert.equal(o.underwriterIsTeam, false);
    assert.equal(o.name, "Outside agent 1%");
    assert.deepEqual(o.terms, { minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000 });
    assert.equal(o.bond, 500_000_000n);
    assert.equal(o.reserved, 0n);
    assert.equal(o.free, 500_000_000n);
    assert.equal(o.premiums, 0n);
    assert.equal(o.claimsPaid, 0n);
    assert.equal(o.accounts, 0);
    assert.equal(created.args.cover, cover);

    // the same signature cannot be used twice
    await assert.rejects(pub.call({ account: underwriter, to: tx.to, data: tx.data }));
  });

  it("a record lookup for the outside agent says there is none (an honest null, not a made-up score)", () => {
    const r = sdk.getAgentRecord(outsideAgent.address);
    assert.equal(r.record, null);
    assert.equal(r.summary, null);
  });

  it("quotes a cover and refuses what the bond cannot back", async () => {
    await mint(user.address, "300");
    const q = await sdk.quoteCover({ market: "live", offerId, amount: "100", limitBps: 1000, user: user.address });
    assert.equal(q.ok, true, q.problems.join("; "));
    assert.equal(q.premium, 1_000_000n);
    assert.equal(q.principal, 99_000_000n);
    assert.equal(q.limitAmount, 9_900_000n);
    assert.equal(q.reservationNeeded, 19_800_000n);
    assert.equal(q.capacityAllows, true);
    assert.equal(q.balance?.enough, true);
    assert.ok(q.reference && q.reference.worstCase.fairBps > 0);
    assert.equal(q.reference.record, null);

    const tooBig = await sdk.quoteCover({ market: "live", offerId, amount: "5000", limitBps: 500 });
    assert.equal(tooBig.ok, false);
    assert.equal(tooBig.capacityAllows, false);
    // the contract agrees with the quote: a 5000 USDG deposit at 5% reserves 1237.5 against a 500 bond
    assert.equal(tooBig.reservationNeeded, 1_237_500_000n);
    await assert.rejects(sdk.buildCoverTransactions({ market: "live", offerId, user: user.address, amount: "5000", limitBps: 500 }), /not enough free bond/);
  });

  it("cover: the user opens it with SDK-built transactions (approve exactly the deposit, then open)", async () => {
    const { transactions, quote } = await sdk.buildCoverTransactions({ market: "live", offerId, user: user.address, amount: "100", limitBps: 1000, rules: RULES });
    assert.equal(transactions.length, 2);
    const before = await balance(user.address);

    await send(wallet(3), transactions[0]);
    assert.equal(await pub.readContract({ address: sdk.config.usdg, abi: erc20Abi, functionName: "allowance", args: [user.address, cover] }), 100_000_000n, "approved exactly the deposit");
    const { receipt } = await send(wallet(3), transactions[1]);
    assert.equal(await pub.readContract({ address: sdk.config.usdg, abi: erc20Abi, functionName: "allowance", args: [user.address, cover] }), 0n, "the allowance is fully used");
    assert.equal(before - (await balance(user.address)), 100_000_000n);

    const logs = parseEventLogs({ abi: bondlineCoverAbi, logs: receipt.logs });
    const opened = logs.find((l) => l.eventName === "Opened")!;
    const deposited = logs.find((l) => l.eventName === "Deposited")!;
    assert.equal(opened.args.user, user.address);
    assert.equal(opened.args.limitBps, 1000);
    assert.deepEqual({ ...opened.args.rules }, RULES);
    assert.equal(deposited.args.fee, quote.premium);
    assert.equal(deposited.args.net, quote.principal);
    assert.equal(deposited.args.reserveAdded, quote.reservationNeeded);
    account = opened.args.account;
    assert.equal(await balance(account), 99_000_000n);

    const [o] = await sdk.listOffers({ agent: outsideAgent.address });
    assert.equal(o.accounts, 1);
    assert.equal(o.bond, 501_000_000n); // 500 + the 1 USDG premium
    assert.equal(o.premiums, 1_000_000n);
    assert.equal(o.reserved, 19_800_000n);
    assert.equal(o.free, 481_200_000n);

    const accts = await sdk.listAccounts({ agent: outsideAgent.address });
    assert.equal(accts.length, 1);
    assert.equal(accts[0].account, account);
    assert.equal(accts[0].user, user.address);
    assert.equal(accts[0].status, "Active");
    assert.equal(accts[0].principal, 99_000_000n);
    assert.equal(accts[0].value, 99_000_000n);
    assert.equal(accts[0].paused, false);
    assert.deepEqual(accts[0].rules, RULES);
  });

  it("trade: only the named agent can send it; a buy executes and its decision hash verifies", async () => {
    const decision = { action: "buy", asset: "TSLA", usdAmount: 9, reason: "Outside agent e2e: small starter position inside the 10% per-trade rule." };
    const quote = await sdk.quoteTrade({ account, asset: "TSLA", side: "buy", usdAmount: "9", toleranceBps: 50 });
    assert.ok(quote.expectedOut > 0n);
    const built = await sdk.buildTradeTransaction({ account, asset: "TSLA", side: "buy", usdAmount: "9", minOutToleranceBps: 50, decision });
    assert.equal(built.transaction.from, outsideAgent.address);
    assert.equal(built.minOut, quote.suggestedMinOut);
    assert.deepEqual(built.warnings, []);

    // the user (or anyone else) cannot send the agent's trade
    await assert.rejects(pub.call({ account: user, to: built.transaction.to, data: built.transaction.data }), new RegExp(toFunctionSelector("NotAgent()")));

    const { hash, receipt } = await send(wallet(4), built.transaction);
    const traded = parseEventLogs({ abi: agentAccountAbi, logs: receipt.logs, eventName: "Traded" })[0];
    assert.ok(traded, "a Traded event");
    assert.equal(traded.address.toLowerCase(), account.toLowerCase());
    assert.equal(traded.args.isBuy, true);
    assert.equal(traded.args.usdAmount, 9_000_000n);
    assert.equal(traded.args.amountOut, quote.expectedOut, "filled at the quoted price");
    assert.equal(traded.args.decisionHash, built.decision.hash);

    // independent check, without the SDK: re-hash the decision bytes from the transaction input
    const tx = await pub.getTransaction({ hash });
    const d = decodeFunctionData({ abi: agentAccountAbi, data: tx.input });
    assert.equal(d.functionName, "trade");
    const bytes = d.args![4] as Hex;
    assert.equal(keccak256(bytes), traded.args.decisionHash);
    assert.deepEqual(JSON.parse(Buffer.from(bytes.slice(2), "hex").toString("utf8")), decision);

    const v = await sdk.verifyDecision(hash);
    assert.equal(v.ok, true);
    assert.equal(v.event, "Traded");
    assert.equal(v.decisionHash, built.decision.hash);
    assert.equal(v.recomputedHash, built.decision.hash);
    assert.equal(v.decisionJson, built.decision.json);

    const [a] = await sdk.listAccounts({ agent: outsideAgent.address });
    assert.ok(a.stockValue > 0n);
    assert.ok(a.loss > 0n && a.loss <= 9_100n, `the loss is the demo exchange's 10 bps spread on 9 USDG (9000 units), got ${a.loss}`);
  });

  it("trade: one the rules refuse is recorded as Blocked, changes nothing, and its decision hash verifies too", async () => {
    const decision = { action: "buy", asset: "AMZN", usdAmount: 60, reason: "Outside agent e2e: deliberately too large for the 10% per-trade rule." };
    const built = await sdk.buildTradeTransaction({ account, asset: "AMZN", side: "buy", usdAmount: "60", decision });
    assert.match(built.warnings.join(" "), /no minOut/);
    const [before] = await sdk.listAccounts({ agent: outsideAgent.address });
    const { hash, receipt } = await send(wallet(4), built.transaction);
    assert.equal(parseEventLogs({ abi: agentAccountAbi, logs: receipt.logs, eventName: "Traded" }).length, 0);
    const blocked = parseEventLogs({ abi: agentAccountAbi, logs: receipt.logs, eventName: "Blocked" })[0];
    assert.ok(blocked, "a Blocked event");
    assert.equal(BLOCK_REASONS[Number(blocked.args.reason)].key, "TradeTooLarge");
    assert.equal(blocked.args.decisionHash, built.decision.hash);
    const [after] = await sdk.listAccounts({ agent: outsideAgent.address });
    assert.equal(after.value, before.value);
    assert.equal(after.stockValue, before.stockValue);

    const v = await sdk.verifyDecision(hash);
    assert.equal(v.ok, true);
    assert.equal(v.event, "Blocked");
    assert.equal(v.blockReason, "TradeTooLarge");
  });

  it("trade: a sell of everything executes, and verifyDecision rejects a transaction that is not a trade", async () => {
    const decision = { action: "sell", asset: "TSLA", usdAmount: 0, reason: "Outside agent e2e: take the position off." };
    const built = await sdk.buildTradeTransaction({ account, asset: "TSLA", side: "sell", usdAmount: "max", minOutToleranceBps: 50, decision });
    const { hash, receipt } = await send(wallet(4), built.transaction);
    const traded = parseEventLogs({ abi: agentAccountAbi, logs: receipt.logs, eventName: "Traded" })[0];
    assert.equal(traded.args.isBuy, false);
    assert.equal(traded.args.stockValueAfter, 0n);
    assert.equal(traded.args.decisionHash, built.decision.hash);
    assert.equal((await sdk.verifyDecision(hash)).ok, true);

    await mint(deployer.address, "1"); // any transaction that is not a trade
    const mintTx = (await pub.getBlock({ blockTag: "latest" })).transactions[0] as Hex;
    const notTrade = await sdk.verifyDecision(mintTx);
    assert.equal(notTrade.ok, false);
  });

  it("asset and amount mistakes fail before anything is built", async () => {
    await assert.rejects(sdk.buildTradeTransaction({ account, asset: "NVDA", side: "buy", usdAmount: "1", decision: { a: 1 } }), /not one of this account's assets/);
    await assert.rejects(sdk.buildTradeTransaction({ account, asset: "TSLA", side: "buy", usdAmount: "1.0000001", decision: { a: 1 } }), /decimals/);
    await assert.rejects(sdk.buildTradeTransaction({ account, asset: "TSLA", side: "buy", usdAmount: "1", decision: "not json" }), /valid JSON/);
  });

  it("the SDK's decision hash for this exact JSON matches the Bondline agents' encoder", async () => {
    const { encodeDecision } = await import("../../agents/src/decision.ts");
    const d = { action: "buy", asset: "TSLA", usdAmount: 9, reason: "x" };
    const built = await sdk.buildTradeTransaction({ account, asset: "TSLA", side: "buy", usdAmount: "9", minOut: 0n, decision: d });
    assert.equal(built.decision.hash, encodeDecision(d).hash);
  });
});
