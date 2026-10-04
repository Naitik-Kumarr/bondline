import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, decodeFunctionData, keccak256, hexToString, hashDomain, parseEventLogs, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ANVIL_KEYS, CHAIN_ID, mintUsdg, startLocalChain } from "../sdk/test/local-chain.ts";

const out: Record<string, unknown> = {};
const note = (k: string, v: unknown) => { out[k] = v; console.log(k, "=>", typeof v === "string" ? v : JSON.stringify(v)); };
const cast = (...a: string[]) => spawnSync("/Users/naitik/.foundry/bin/cast", a, { encoding: "utf8" }).stdout.trim();
const accts = ANVIL_KEYS.map((k) => privateKeyToAccount(k));
const [, , UW, USER, AGENT, STRANGER] = accts;

const chain = await startLocalChain();
const lc = defineChain({ id: CHAIN_ID, name: "l", nativeCurrency: { name: "E", symbol: "E", decimals: 18 }, rpcUrls: { default: { http: [chain.rpcUrl] } } });
const pub = createPublicClient({ chain: lc, transport: http(chain.rpcUrl) });
const w = (i: number) => createWalletClient({ account: accts[i], chain: lc, transport: http(chain.rpcUrl) });
const client = new Client({ name: "vc", version: "0" });
let tp: StdioClientTransport | undefined;
try {
  tp = new StdioClientTransport({ command: process.execPath, args: ["/Users/naitik/surety/mcp/bin/bondline-mcp.mjs"], env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", BONDLINE_RAW_DEPLOYMENT: chain.rawPath, BONDLINE_RPC_URL: chain.rpcUrl }, stderr: "pipe" });
  await client.connect(tp);
  const raw = async (name: string, args: any) => { const r = await client.callTool({ name, arguments: args }); return { err: !!r.isError, text: (r.content as any)[0].text as string }; };
  const call = async (name: string, args: any) => { const r = await raw(name, args); if (r.err) throw new Error(`${name}: ${r.text}`); return JSON.parse(r.text); };
  const errs = async (name: string, args: any) => { try { const r = await raw(name, args); return r.err ? r.text.slice(0, 160) : "NO ERROR: " + r.text.slice(0, 200); } catch (e: any) { return "protocol-level: " + String(e.message).slice(0, 200); } };

  await mintUsdg(chain, UW.address, 1000);
  await mintUsdg(chain, USER.address, 1000);
  const usdg = chain.raw.usdg as Address;
  const market = (chain.raw as any).markets?.live?.market ?? undefined;
  const list0 = await call("list_offers", {});
  const marketAddr = list0.markets.find((m: any) => m.key === "live").address as Address;
  note("market live (from server)", marketAddr);

  // ---- A: typed data independent check
  const terms = { agent: AGENT.address, min_limit_bps: 500, max_limit_bps: 2000, fee_bps: 100, max_stock_bps: 3000, name: "vc-offer" };
  const s1 = await call("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "500", ...terms });
  const td = s1.typedData;
  const dsOnChain = (await pub.readContract({ address: usdg, abi: parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]), functionName: "DOMAIN_SEPARATOR" })) as Hex;
  const dsHash = hashDomain({ domain: td.domain, types: { EIP712Domain: td.types.EIP712Domain } });
  note("A domain separator equals on-chain", { onchain: dsOnChain, computed: dsHash, equal: dsOnChain === dsHash });
  note("A typedData message", td.message);
  note("A verifyingContract==usdg, to==market, value==500e6", td.domain.verifyingContract === usdg && td.message.to === marketAddr && td.message.value === "500000000" && td.message.from === UW.address);
  const types = { ReceiveWithAuthorization: td.types.ReceiveWithAuthorization };
  const m = td.message;
  const msg = { ...m, value: BigInt(m.value), validAfter: BigInt(m.validAfter), validBefore: BigInt(m.validBefore) };
  const sig = await w(2).signTypedData({ account: UW, domain: td.domain, types, primaryType: "ReceiveWithAuthorization", message: msg });
  note("A validBefore - now (s)", Number(m.validBefore) - Math.floor(Date.now() / 1000));

  // tamper tests on step 2
  const tamper = (patch: any) => ({ authorization: { ...s1.authorization, ...patch }, signature: sig });
  note("A tamper bond", await errs("build_offer_authorization", tamper({ bond: "600000000" })));
  note("A tamper nonce", await errs("build_offer_authorization", tamper({ nonce: "0x" + "11".repeat(32) })));
  note("A tamper validBefore", await errs("build_offer_authorization", tamper({ validBefore: "99999999999" })));
  note("A tamper underwriter", await errs("build_offer_authorization", tamper({ underwriter: STRANGER.address })));
  note("A tamper market", await errs("build_offer_authorization", tamper({ market: STRANGER.address })));
  note("A tamper terms.agent (not signed over)", (await errs("build_offer_authorization", tamper({ terms: { ...s1.authorization.terms, agent: STRANGER.address } }))).slice(0, 80));
  note("A sig stranger", await errs("build_offer_authorization", { authorization: s1.authorization, signature: await w(5).signTypedData({ account: STRANGER, domain: td.domain, types, primaryType: "ReceiveWithAuthorization", message: msg }) }));
  note("A sig garbage", await errs("build_offer_authorization", { authorization: s1.authorization, signature: "0x" + "00".repeat(65) }));
  note("A sig short", await errs("build_offer_authorization", { authorization: s1.authorization, signature: "0x1234" }));

  const s2 = await call("build_offer_authorization", { authorization: s1.authorization, signature: sig });
  const tx2 = s2.transaction;
  const abiOffer = parseAbi(["function createOfferWithAuthorization((address agent,uint16 minLimitBps,uint16 maxLimitBps,uint16 feeBps,uint16 maxStockBps,string name) terms,uint256 bond,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) returns (uint256,address)"]);
  const dec2 = decodeFunctionData({ abi: abiOffer, data: tx2.data });
  const selCast = cast("sig", "createOfferWithAuthorization((address,uint16,uint16,uint16,uint16,string),uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)");
  note("A selector (cast sig) vs data", { cast: selCast, data: tx2.data.slice(0, 10), equal: selCast === tx2.data.slice(0, 10) });
  note("A decoded offer tx", { to: tx2.to, toIsMarket: tx2.to === marketAddr, value: tx2.value, chainId: tx2.chainId, args: JSON.parse(JSON.stringify(dec2.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) });
  const [dt, bond, va, vb, nonce, v, r, s] = dec2.args as any;
  const ok = dt.agent === AGENT.address && dt.minLimitBps === 500 && dt.maxLimitBps === 2000 && dt.feeBps === 100 && dt.maxStockBps === 3000 && dt.name === "vc-offer" && bond === 500_000_000n && va === 0n && vb === BigInt(m.validBefore) && nonce === m.nonce && sig.toLowerCase() === ("0x" + r.slice(2) + s.slice(2) + v.toString(16)).toLowerCase();
  note("A calldata args == intended terms+bond+sig", ok);
  const h = await w(2).sendTransaction({ to: tx2.to, data: tx2.data });
  const rc = await pub.waitForTransactionReceipt({ hash: h });
  note("A offer tx status", rc.status);
  note("A underwriter nonce after", await pub.getTransactionCount({ address: UW.address }));
  // replay
  try { await w(2).sendTransaction({ to: tx2.to, data: tx2.data, gas: 3_000_000n }).then((x) => pub.waitForTransactionReceipt({ hash: x })).then((x) => note("A replay status", x.status)); } catch (e: any) { note("A replay reverts", String(e.shortMessage ?? e.message).slice(0, 120)); }
  // other sender cannot use the signature
  try { const x = await w(5).sendTransaction({ to: tx2.to, data: tx2.data, gas: 3_000_000n }); const y = await pub.waitForTransactionReceipt({ hash: x }); note("A stranger sending signed tx", y.status); } catch (e: any) { note("A stranger sending reverts", String(e.shortMessage ?? e.message).slice(0, 120)); }

  const offers = await call("list_offers", { agent: AGENT.address });
  const offer = offers.offers[0];
  note("B offer view", { id: offer.id, bond: offer.bond, reserved: offer.reserved, free: offer.free, agent: offer.agent === AGENT.address, listed: offer.listed });

  // ---- B: cover builder
  const bc = await call("build_cover_transactions", { market: "live", offer_id: offer.id, user: USER.address, amount: "100", limit_bps: 1000 });
  const [t1, t2] = bc.sendInOrder;
  const erc = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
  const d1 = decodeFunctionData({ abi: erc, data: t1.data });
  note("B approve selector", { cast: cast("sig", "approve(address,uint256)"), data: t1.data.slice(0, 10) });
  note("B approve to/spender/amount", { to: t1.to, toIsUSDG: t1.to === usdg, spender: d1.args[0], spenderIsOfferCover: d1.args[0] === offer.cover, amount: String(d1.args[1]), exact100e6: d1.args[1] === 100_000_000n, from: t1.from === USER.address });
  const abiOpen = parseAbi(["function open(uint16 limitBps,(uint8 assetMask,uint16 maxStockBps,uint16 maxTradeBps,uint32 maxDailyBps,uint16 maxSlippageBps,uint32 maxPriceAge) rules,uint256 amount) returns (address)"]);
  const d2 = decodeFunctionData({ abi: abiOpen, data: t2.data });
  note("B open selector", { cast: cast("sig", "open(uint16,(uint8,uint16,uint16,uint32,uint16,uint32),uint256)"), data: t2.data.slice(0, 10) });
  note("B open decoded", { to: t2.to, toIsOfferCover: t2.to === offer.cover, args: JSON.parse(JSON.stringify(d2.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) });
  const bal0 = await pub.readContract({ address: usdg, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [USER.address] });
  for (const t of [t1, t2]) { const x = await w(3).sendTransaction({ to: t.to, data: t.data }); const y = await pub.waitForTransactionReceipt({ hash: x }); note("B tx status " + t.call.function, y.status); if (t.call.function === "open") out.openReceipt = y; }
  const allowance = await pub.readContract({ address: usdg, abi: parseAbi(["function allowance(address,address) view returns (uint256)"]), functionName: "allowance", args: [USER.address, offer.cover] });
  const bal1 = await pub.readContract({ address: usdg, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [USER.address] });
  note("B allowance after (expect 0), user spent", { allowance: String(allowance), spent: String(bal0 - bal1) });
  const accs = await call("list_offers", { agent: AGENT.address });
  note("B offer after cover", { bond: accs.offers[0].bond, reserved: accs.offers[0].reserved, free: accs.offers[0].free, accounts: accs.offers[0].accounts });
  const account = (await pub.readContract({ address: offer.cover, abi: parseAbi(["function accountAt(uint256) view returns (address)"]), functionName: "accountAt", args: [0n] })) as Address;
  note("B account", account);

  // ---- C: trade
  const decision = { action: "buy", asset: "TSLA", usdAmount: 10, reason: "vc: ünïcode ✓ \"quoted\"" , z: [3, 1, { b: 1, a: 2 }] };
  const tr = await call("build_trade_transaction", { account, asset: "TSLA", side: "buy", usd_amount: "10", min_out_tolerance_bps: 100, decision });
  const tx = tr.transaction;
  const abiTrade = parseAbi(["function trade(address asset,bool isBuy,uint256 usdAmount,uint256 minOut,bytes decision)"]);
  const dt3 = decodeFunctionData({ abi: abiTrade, data: tx.data });
  note("C trade selector", { cast: cast("sig", "trade(address,bool,uint256,uint256,bytes)"), data: tx.data.slice(0, 10) });
  const decBytes = dt3.args[4] as Hex;
  note("C decision json in calldata", hexToString(decBytes));
  note("C hash returned vs keccak(calldata bytes) vs cast keccak", { returned: tr.decision.hash, mine: keccak256(decBytes), cast: cast("keccak", decBytes), equal: tr.decision.hash === keccak256(decBytes) && keccak256(decBytes) === cast("keccak", decBytes) });
  note("C node canonical (independent)", JSON.stringify({ a: 1 }) && hexToString(decBytes) === '{"action":"buy","asset":"TSLA","reason":"vc: ünïcode ✓ \\"quoted\\"","usdAmount":10,"z":[3,1,{"a":2,"b":1}]}');
  note("C trade args", { to: tx.to === account, usd: String(dt3.args[2]), minOut: String(dt3.args[3]), isBuy: dt3.args[1], from: tx.from === AGENT.address, mustBeSentBy: tr.mustBeSentBy });
  const hx = await w(4).sendTransaction({ to: tx.to, data: tx.data });
  const rcT = await pub.waitForTransactionReceipt({ hash: hx });
  const ev = parseEventLogs({ abi: parseAbi(["event Traded(address indexed asset,bool isBuy,uint256 usdAmount,uint256 tokenAmount,uint256 price,uint256 stockValueAfter,uint256 valueAfter,bytes32 decisionHash)", "event Blocked(bytes32 reason,bytes32 decisionHash)"]), logs: rcT.logs });
  note("C events", ev.map((e) => ({ name: e.eventName, hash: (e.args as any).decisionHash })));
  // minOut too high -> what happens (revert or Blocked?)
  const trHigh = await call("build_trade_transaction", { account, asset: "TSLA", side: "buy", usd_amount: "10", min_out: "9999999999999999999999999", decision });
  try { const x = await w(4).sendTransaction({ to: trHigh.transaction.to, data: trHigh.transaction.data, gas: 2_000_000n }); const y = await pub.waitForTransactionReceipt({ hash: x }); note("C absurd minOut result", { status: y.status, logs: y.logs.length }); } catch (e: any) { note("C absurd minOut reverts", String(e.shortMessage ?? e.message).slice(0, 140)); }

  // ---- D: bad inputs
  const base = { market: "live", offer_id: offer.id, amount: "100", limit_bps: 1000 };
  const q = async (patch: any) => { const r = await raw("quote_cover", { ...base, ...patch }); if (r.err) return "ERR " + r.text.slice(0, 120); const j = JSON.parse(r.text); return { ok: j.ok, problems: j.problems, premium: j.premium, principal: j.principal }; };
  for (const [k, p] of Object.entries<any>({
    "amount -5": { amount: "-5" }, "amount 1e2": { amount: "1e2" }, "amount 0x64": { amount: "0x64" }, "amount 1.0000001": { amount: "1.0000001" }, "amount '' ": { amount: "" }, "amount ' 100 '": { amount: " 100 " }, "amount number 0.0000001": { amount: 0.0000001 }, "amount number 1e21": { amount: 1e21 }, "amount .5": { amount: ".5" }, "amount '1,5'": { amount: "1,5" }, "amount NaN": { amount: "NaN" }, "amount 0.999999": { amount: "0.999999" }, "amount 1": { amount: "1" },
    "limit 0": { limit_bps: 0 }, "limit 499": { limit_bps: 499 }, "limit 2001": { limit_bps: 2001 }, "limit 3000": { limit_bps: 3000 }, "limit 65536": { limit_bps: 65536 }, "limit -1": { limit_bps: -1 }, "limit 10.5": { limit_bps: 10.5 },
    "offer 99": { offer_id: 99 }, "offer -1": { offer_id: -1 }, "market bogus": { market: "bogus" }, "market zero addr": { market: "0x0000000000000000000000000000000000000000" },
    "rules assetMask 0": { rules: { assetMask: 0 } }, "rules assetMask 255": { rules: { assetMask: 255 } }, "rules maxStock 9000": { rules: { maxStockBps: 9000 } }, "rules slippage 501": { rules: { maxSlippageBps: 501 } }, "rules maxPriceAge 0": { rules: { maxPriceAge: 0 } }, "rules maxPriceAge huge": { rules: { maxPriceAge: 99999999 } }, "rules maxTrade 70000": { rules: { maxTradeBps: 70000 } }, "rules maxDaily 100001": { rules: { maxDailyBps: 100001 } }, "amount 10000 (capacity)": { amount: "10000" },
  })) note("D quote " + k, await q(p));
  const bt = async (patch: any) => errs("build_trade_transaction", { account, asset: "TSLA", side: "buy", usd_amount: "10", min_out: "0", decision: { reason: "x" }, ...patch });
  for (const [k, p] of Object.entries<any>({ "asset NVDA": { asset: "NVDA" }, "asset zero": { asset: "0x0000000000000000000000000000000000000000" }, "asset usdg addr": { asset: usdg }, "side hold": { side: "hold" }, "usd -1": { usd_amount: "-1" }, "usd 0": { usd_amount: "0" }, "usd max buy": { usd_amount: "max" }, "min_out -1": { min_out: "-1" }, "min_out 1.5": { min_out: "1.5" }, "min_out 2^256": { min_out: (2n ** 256n).toString() }, "decision array": { decision: [1] }, "decision null str": { decision: "null" }, "decision bad json": { decision: "{oops" }, "decision 900B": { decision: { a: "x".repeat(900) } }, "decision 900B reason": { decision: { reason: "x".repeat(900) } }, "account not account": { account: STRANGER.address }, "account bad": { account: "0x123" }, "both min_out and tolerance": { min_out_tolerance_bps: 50 }, "tolerance 10001": { min_out_tolerance_bps: 10001, min_out: undefined } }))
    note("D trade " + k, await bt(p));
  note("D offer auth zero agent", await errs("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "5", ...terms, agent: "0x0000000000000000000000000000000000000000" }));
  note("D offer auth bond 0", await errs("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "0", ...terms }));
  note("D offer auth fee 501", await errs("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "5", ...terms, fee_bps: 501 }));
  note("D offer auth name 65 bytes", await errs("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "5", ...terms, name: "é".repeat(33) }));
  note("D offer auth fee 70000 (uint16 overflow)", await errs("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "5", ...terms, fee_bps: 70000 }));
  note("D offer auth maxStock 70000", await errs("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "5", ...terms, max_stock_bps: 70000 }));
  note("D offer auth minLimit 65536+500", await errs("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "5", ...terms, min_limit_bps: 65536 + 500 }));
  note("D offer auth valid_for_seconds 0", await errs("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "5", ...terms, valid_for_seconds: 0 }));
  note("D offer auth bond huge", await errs("build_offer_authorization", { market: "live", underwriter: UW.address, bond: "99999999999999999999999999999999999999999999999999999999999999999999999999999999999" }));
  note("D get_agent_record junk", await errs("get_agent_record", { agent: "nobody" }));
  note("D get_agent_record unknown addr", (await errs("get_agent_record", { agent: STRANGER.address })).slice(0, 120));
  note("D get_agent_record path-ish", await errs("get_agent_record", { agent: "../../../etc/passwd" }));
  note("D list_offers market bogus", await errs("list_offers", { market: "bogus" }));
  note("D unknown tool", await errs("send_transaction", {}));
  note("D no-key claim: server env has no key", "n/a");
} finally {
  await client.close().catch(() => {});
  chain.stop();
}
