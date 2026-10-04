import { createPublicClient, createWalletClient, defineChain, http, parseAbi, keccak256, parseEventLogs, hexToString, decodeFunctionData, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Bondline, configFromEnv } from "@bondline/sdk";
import { ANVIL_KEYS, CHAIN_ID, mintUsdg, startLocalChain } from "../sdk/test/local-chain.ts";
const accts = ANVIL_KEYS.map((k) => privateKeyToAccount(k));
const [, , UW, USER, AGENT] = accts;
const chain = await startLocalChain();
process.env.BONDLINE_RAW_DEPLOYMENT = chain.rawPath; process.env.BONDLINE_RPC_URL = chain.rpcUrl;
const lc = defineChain({ id: CHAIN_ID, name: "l", nativeCurrency: { name: "E", symbol: "E", decimals: 18 }, rpcUrls: { default: { http: [chain.rpcUrl] } } });
const pub = createPublicClient({ chain: lc, transport: http(chain.rpcUrl) });
const w = (i: number) => createWalletClient({ account: accts[i], chain: lc, transport: http(chain.rpcUrl) });
const evAbi = parseAbi([
  "event Traded(address indexed asset,bool isBuy,uint256 usdAmount,uint256 amountIn,uint256 amountOut,uint256 price,uint256 valueAfter,uint256 stockValueAfter,bytes32 indexed decisionHash)",
  "event Blocked(address indexed asset,bool isBuy,uint256 usdAmount,uint8 reason,uint256 observed,uint256 limit,bytes32 indexed decisionHash)"]);
const P = (k: string, v: unknown) => console.log(k, "=>", JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
try {
  await mintUsdg(chain, UW.address, 1000); await mintUsdg(chain, USER.address, 1000);
  const sdk = new Bondline(configFromEnv());
  const send = async (i: number, t: { to: Address; data: Hex }) => { const x = await w(i).sendTransaction({ to: t.to, data: t.data, gas: 3_000_000n }); return pub.waitForTransactionReceipt({ hash: x }); };
  const auth = sdk.buildOfferAuthorization({ market: "live", underwriter: UW.address, bond: "500", terms: { agent: AGENT.address, minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000, name: "adv2" } });
  const { EIP712Domain: _x, ...types } = auth.typedData.types as any;
  const sig = await w(2).signTypedData({ account: UW, domain: auth.typedData.domain as any, types: auth.typedData.types, primaryType: "ReceiveWithAuthorization", message: auth.typedData.message });
  const otx = await sdk.buildCreateOfferFromSignature({ authorization: auth, signature: sig });
  P("offer", (await send(2, otx)).status);
  const cov = await sdk.buildCoverTransactions({ market: "live", offerId: 0, user: USER.address, amount: "100", limitBps: 1000 });
  for (const t of cov.transactions) P("cover " + t.call.function, (await send(3, t)).status);
  const acct = (await sdk.listAccounts({ agent: AGENT.address }))[0];
  P("account", { account: acct.account ?? (acct as any).address, keys: Object.keys(acct) });
  const account = ((acct as any).account ?? (acct as any).address) as Address;
  const run = async (label: string, args: any) => {
    const b = await sdk.buildTradeTransaction({ account, ...args });
    const rc = await send(4, b.transaction);
    const evs = parseEventLogs({ abi: evAbi, logs: rc.logs });
    const calldata = decodeFunctionData({ abi: parseAbi(["function trade(address,bool,uint256,uint256,bytes)"]), data: b.transaction.data });
    const mine = keccak256(calldata.args[4] as Hex);
    const v = await sdk.verifyDecision(rc.transactionHash);
    P(label, { status: rc.status, events: evs.map((e) => ({ n: e.eventName, hash: (e.args as any).decisionHash, reason: (e.args as any).reason, usd: (e.args as any).usdAmount })), sdkHash: b.decision.hash, independentHash: mine, eventEqualsIndependent: evs[0] && (evs[0].args as any).decisionHash === mine, verifyDecision: { ok: v.ok, event: v.event, blockReason: (v as any).blockReason }, warnings: b.warnings });
    return rc;
  };
  await run("buy 10", { asset: "TSLA", side: "buy", usdAmount: "9", minOutToleranceBps: 100, decision: { action: "buy", reason: "adv2 buy" } });
  await run("buy absurd minOut", { asset: "TSLA", side: "buy", usdAmount: "10", minOut: "999999999999999999999999", decision: { reason: "minout" } });
  await run("buy 1000 (over limit)", { asset: "TSLA", side: "buy", usdAmount: "1000", minOut: "0", decision: { reason: "too big" } });
  await run("buy 0", { asset: "AMZN", side: "buy", usdAmount: "0", minOut: "0", decision: { reason: "zero" } });
  await run("buy max", { asset: "AMZN", side: "buy", usdAmount: "max", minOut: "0", decision: { reason: "max buy" } });
  await run("sell max TSLA", { asset: "TSLA", side: "sell", usdAmount: "max", minOut: "0", decision: { reason: "sell all" } });
  // verifyDecision on non-trade txs
  // stranger cannot trade
  try { const b = await sdk.buildTradeTransaction({ account, asset: "TSLA", side: "buy", usdAmount: "5", minOut: "0", decision: { reason: "x" } }); const x = await w(5).sendTransaction({ to: b.transaction.to, data: b.transaction.data, gas: 1_000_000n }); P("stranger trade", (await pub.waitForTransactionReceipt({ hash: x })).status); } catch (e: any) { P("stranger trade reverts", String(e.shortMessage ?? e.message).slice(0, 100)); }
} finally { chain.stop(); }
