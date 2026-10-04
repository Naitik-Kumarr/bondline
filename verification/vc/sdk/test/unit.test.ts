// Unit tests: no chain, no network. A stubbed read-only client answers the contract reads.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFunctionData, erc20Abi, hashDomain, hashTypedData, keccak256, recoverAddress, stringToBytes, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  agentAccountAbi,
  bondlineCoverAbi,
  bondlineMarketAbi,
  PRICING_VECTORS,
  USDG,
  USDG_DOMAIN,
  USDG_DOMAIN_SEPARATOR,
} from "@bondline/shared";
import {
  Bondline,
  buildCoverTransactions,
  buildCreateOfferTransaction,
  buildOfferAuthorization,
  buildTradeTransaction,
  canonicalJson,
  encodeDecision,
  parseBaseUnits,
  parseUsdg,
  resolveAgentAddress,
  testnetConfig,
  toJson,
  validateRules,
  validateTerms,
  type RulesInput,
} from "../src/index.ts";
// The Bondline agents' own encoder: the SDK's decision hash must match it for the same input.
import { encodeDecision as agentEncodeDecision } from "../../agents/src/decision.ts";

const CAREFUL: Address = "0x230d2a366d7724a6f5F416BB1d80299BC8E487eF";
const UNDERWRITER: Address = "0x243fCc3956213b6f8Efd28E39C0f0D288e2134e0";
const USER: Address = "0x3C5154180b729724c890d5609896B3cCc219f01F";
const COVER: Address = "0x74E53674d072838b57E9d65EF99d21A598130d50";
const ACCOUNT: Address = "0x4462A953Db52Cda1fbd745e29cc62E72943Ed9F4";
const TSLA: Address = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";
const AMZN: Address = "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02";
const TEST_KEY: Hex = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // Anvil's public key #2

const RULES: RulesInput = { assetMask: 3, maxStockBps: 3000, maxTradeBps: 1000, maxDailyBps: 20_000, maxSlippageBps: 50, maxPriceAge: 14_400 };
const cfg = testnetConfig();
const LIVE = cfg.markets.find((m) => m.key === "live")!.address;

describe("units", () => {
  it("parses USDG decimals exactly and rejects bad input", () => {
    assert.equal(parseUsdg("100"), 100_000_000n);
    assert.equal(parseUsdg("0.000001"), 1n);
    assert.equal(parseUsdg(12.5), 12_500_000n);
    assert.equal(parseUsdg(5n), 5n);
    assert.throws(() => parseUsdg("1.0000001"));
    assert.throws(() => parseUsdg("-1"));
    assert.throws(() => parseUsdg("1e6"));
    assert.throws(() => parseUsdg(""));
    assert.throws(() => parseUsdg(Number.NaN));
  });
  it("parses base units and serialises bigints", () => {
    assert.equal(parseBaseUnits("123"), 123n);
    assert.throws(() => parseBaseUnits("1.5"));
    assert.deepEqual(toJson({ a: 1n, b: [2n] }), { a: "1", b: ["2"] });
  });
  it("resolves team agent names and addresses", () => {
    assert.equal(resolveAgentAddress("careful"), CAREFUL);
    assert.equal(resolveAgentAddress(CAREFUL.toLowerCase()), CAREFUL);
    assert.throws(() => resolveAgentAddress("deployer"));
  });
});

describe("decision JSON", () => {
  const d = { reason: "TSLA is down 2% on thin volume; sizing a small starter position.", usdAmount: 25, asset: "TSLA", action: "buy" };
  it("is canonical: sorted keys, no whitespace", () => {
    assert.equal(canonicalJson(d), '{"action":"buy","asset":"TSLA","reason":"TSLA is down 2% on thin volume; sizing a small starter position.","usdAmount":25}');
    assert.equal(canonicalJson({ b: 1, a: undefined, c: [{ z: 1, y: 2 }] }), '{"b":1,"c":[{"y":2,"z":1}]}');
  });
  it("hashes as keccak256 of the exact bytes, equal to the Bondline agents' encoder", () => {
    const e = encodeDecision(d);
    assert.equal(e.hash, keccak256(stringToBytes(e.json)));
    assert.equal(e.hex, toHex(stringToBytes(e.json)));
    const a = agentEncodeDecision(d);
    assert.equal(e.json, a.json);
    assert.equal(e.hash, a.hash);
    assert.equal(e.hex, a.hex);
  });
  it("hashes non-ASCII text by bytes", () => {
    const e = encodeDecision({ reason: "tesla ↑ 3% — buy", action: "buy" });
    assert.equal(e.hash, keccak256(stringToBytes(e.json)));
    assert.equal(e.bytes, stringToBytes(e.json).length);
  });
  it("trims the reason to fit like the agents do, and rejects what cannot fit", () => {
    const long = { action: "buy", reason: "x".repeat(2000) };
    const e = encodeDecision(long);
    assert.ok(e.bytes <= 800);
    assert.equal(e.hash, agentEncodeDecision(long).hash);
    assert.throws(() => encodeDecision({ blob: "y".repeat(900) }), /over the 800-byte limit/);
  });
  it("uses a JSON string exactly as given", () => {
    const raw = '{"action": "hold",  "why":"no edge"}';
    assert.equal(encodeDecision(raw).json, raw);
    assert.equal(encodeDecision(raw).hash, keccak256(stringToBytes(raw)));
    assert.throws(() => encodeDecision("not json"));
    assert.throws(() => encodeDecision([1] as never));
  });
});

describe("cover transactions", () => {
  const txs = buildCoverTransactions({ chainId: 46630, usdg: USDG, cover: COVER, user: USER, limitBps: 1000, rules: RULES, amount: 100_000_000n });
  it("is an approve for exactly the deposit, then open", () => {
    assert.equal(txs.length, 2);
    const [approve, open] = txs;
    assert.equal(approve.to, USDG);
    const a = decodeFunctionData({ abi: erc20Abi, data: approve.data });
    assert.equal(a.functionName, "approve");
    assert.deepEqual(a.args, [COVER, 100_000_000n]);
    assert.equal(open.to, COVER);
    const o = decodeFunctionData({ abi: bondlineCoverAbi, data: open.data });
    assert.equal(o.functionName, "open");
    assert.equal(o.args![0], 1000);
    assert.deepEqual(o.args![1], RULES);
    assert.equal(o.args![2], 100_000_000n);
    for (const t of txs) {
      assert.equal(t.value, 0n);
      assert.equal(t.chainId, 46630);
      assert.equal(t.from, USER);
    }
  });
});

describe("validation mirrors the contracts", () => {
  const ctx = { assetCount: 2, offerMaxStockBps: 3000, marketMaxPriceAge: 90_000 };
  it("accepts good rules and names each broken one", () => {
    assert.deepEqual(validateRules(RULES, ctx), []);
    assert.equal(validateRules({ ...RULES, assetMask: 0 }, ctx).length, 1);
    assert.equal(validateRules({ ...RULES, assetMask: 4 }, ctx).length, 1);
    assert.equal(validateRules({ ...RULES, maxStockBps: 3001 }, ctx).length, 1);
    assert.equal(validateRules({ ...RULES, maxTradeBps: 0 }, ctx).length, 1);
    assert.equal(validateRules({ ...RULES, maxTradeBps: 10_001 }, ctx).length, 1);
    assert.equal(validateRules({ ...RULES, maxDailyBps: 100_001 }, ctx).length, 1);
    assert.equal(validateRules({ ...RULES, maxSlippageBps: 501 }, ctx).length, 1);
    assert.equal(validateRules({ ...RULES, maxPriceAge: 90_001 }, ctx).length, 1);
    assert.deepEqual(validateRules({ ...RULES, maxSlippageBps: 500, maxPriceAge: 90_000, maxTradeBps: 10_000, maxDailyBps: 100_000 }, ctx), []);
  });
  it("accepts good terms and names each broken one", () => {
    const t = { agent: CAREFUL, minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000, name: "Careful 1%" };
    assert.deepEqual(validateTerms(t), []);
    assert.equal(validateTerms({ ...t, agent: "0x0000000000000000000000000000000000000000" }).length, 1);
    assert.equal(validateTerms({ ...t, minLimitBps: 0 }).length, 1);
    assert.equal(validateTerms({ ...t, minLimitBps: 2500 }).length, 1);
    assert.equal(validateTerms({ ...t, maxLimitBps: 3000 }).length, 1);
    assert.equal(validateTerms({ ...t, feeBps: 501 }).length, 1);
    assert.equal(validateTerms({ ...t, maxStockBps: 0 }).length, 1);
    assert.equal(validateTerms({ ...t, name: "" }).length, 1);
    assert.equal(validateTerms({ ...t, name: "n".repeat(65) }).length, 1);
    assert.deepEqual(validateTerms({ ...t, maxLimitBps: 2999, feeBps: 500, name: "n".repeat(64) }), []);
  });
});

describe("offer authorization", () => {
  const terms = { agent: CAREFUL, minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000, name: "Outside agent 1%" };
  const auth = () => buildOfferAuthorization({ domain: cfg.usdgDomain, market: LIVE, underwriter: UNDERWRITER, terms, bond: 500_000_000n, now: 1_800_000_000 });

  it("uses USDG's EIP-712 domain, which matches the on-chain DOMAIN_SEPARATOR", () => {
    assert.deepEqual(cfg.usdgDomain, USDG_DOMAIN);
    assert.equal(hashDomain({ domain: USDG_DOMAIN as never, types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] } }), USDG_DOMAIN_SEPARATOR);
  });
  it("is a ReceiveWithAuthorization from the underwriter to the market for exactly the bond", () => {
    const a = auth();
    assert.equal(a.typedData.primaryType, "ReceiveWithAuthorization");
    assert.deepEqual(a.typedData.message, { from: UNDERWRITER, to: LIVE, value: 500_000_000n, validAfter: 0n, validBefore: 1_800_003_600n, nonce: a.nonce });
    assert.match(a.nonce, /^0x[0-9a-f]{64}$/);
    assert.notEqual(auth().nonce, auth().nonce);
  });
  it("rejects bad terms and a zero bond", () => {
    assert.throws(() => buildOfferAuthorization({ domain: cfg.usdgDomain, market: LIVE, underwriter: UNDERWRITER, terms: { ...terms, feeBps: 900 }, bond: 1n }), /feeBps/);
    assert.throws(() => buildOfferAuthorization({ domain: cfg.usdgDomain, market: LIVE, underwriter: UNDERWRITER, terms, bond: 0n }), /bond/);
  });
  it("builds one createOfferWithAuthorization transaction whose v, r, s recover the signer", async () => {
    const signer = privateKeyToAccount(TEST_KEY);
    const a = buildOfferAuthorization({ domain: cfg.usdgDomain, market: LIVE, underwriter: signer.address, terms, bond: 500_000_000n, now: 1_800_000_000 });
    const signature = await signer.signTypedData(a.typedData);
    const tx = buildCreateOfferTransaction({ chainId: 46630, authorization: a, signature });
    assert.equal(tx.to, LIVE);
    assert.equal(tx.from, signer.address);
    const d = decodeFunctionData({ abi: bondlineMarketAbi, data: tx.data });
    assert.equal(d.functionName, "createOfferWithAuthorization");
    const [t, bond, validAfter, validBefore, nonce, v, r, s] = d.args as [typeof terms, bigint, bigint, bigint, Hex, number, Hex, Hex];
    assert.deepEqual(t, terms);
    assert.equal(bond, 500_000_000n);
    assert.equal(validBefore, 1_800_003_600n);
    assert.equal(nonce, a.nonce);
    const digest = hashTypedData(a.typedData);
    const recovered = await recoverAddress({ hash: digest, signature: { r, s, v: BigInt(v) } });
    assert.equal(recovered, signer.address);
  });
});

describe("trade transaction", () => {
  it("encodes trade(asset, isBuy, usdAmount, minOut, decision) with the decision hash", () => {
    const decision = { action: "buy", asset: "TSLA", usdAmount: 25, reason: "starter" };
    const { transaction, decision: enc } = buildTradeTransaction({ chainId: 46630, account: ACCOUNT, agent: CAREFUL, asset: TSLA, isBuy: true, usdAmount: 25_000_000n, minOut: 7n, decision });
    assert.equal(transaction.to, ACCOUNT);
    assert.equal(transaction.from, CAREFUL);
    const d = decodeFunctionData({ abi: agentAccountAbi, data: transaction.data });
    assert.equal(d.functionName, "trade");
    const [asset, isBuy, usd, minOut, bytes] = d.args as [Address, boolean, bigint, bigint, Hex];
    assert.equal(asset, TSLA);
    assert.equal(isBuy, true);
    assert.equal(usd, 25_000_000n);
    assert.equal(minOut, 7n);
    assert.equal(keccak256(bytes), enc.hash);
    assert.equal(enc.hash, agentEncodeDecision(decision).hash);
  });
});

// ---- the read paths, against a stub client that answers like the deployed contracts would

type Call = { address: Address; functionName: string; args?: readonly unknown[] };
function stubClient(overrides: { free?: bigint; listed?: boolean } = {}) {
  const assets = [TSLA, AMZN];
  const free = overrides.free ?? 19_360_000n;
  const answers: Record<string, (c: Call) => unknown> = {
    venue: () => "0x338499703bde8EbA6308750745D53495B362f7d5",
    assets: () => assets,
    feeds: () => ["0xF18710dA444EFEB3f9E2Fa3e90c61d609906972D", "0x404e911Bafc0293A30B77fAd33f1521C466fC524"],
    maxPriceAge: () => 90_000,
    capBps: () => 3000,
    offerCount: () => 1n,
    offers: () => [{ cover: COVER, underwriter: UNDERWRITER, agent: CAREFUL, listed: overrides.listed ?? true }],
    offer: () => ({ cover: COVER, underwriter: UNDERWRITER, agent: CAREFUL, listed: overrides.listed ?? true }),
    terms: () => ({ agent: CAREFUL, minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000, name: "Careful 1%" }),
    bond: () => 25_300_000n,
    reserved: () => 25_300_000n - free,
    free: () => free,
    premiums: () => 300_000n,
    claimsPaid: () => 0n,
    accountCount: () => 1n,
    listed: () => overrides.listed ?? true,
    quoteDeposit: (c) => {
      const [amount, limit] = c.args as [bigint, number];
      const fee = (amount * 100n) / 10_000n;
      const net = amount - fee;
      return [fee, net, (net * BigInt(3000 - limit) + 9_999n) / 10_000n];
    },
    balanceOf: () => 1_000_000_000n,
  };
  return {
    readContract: async (c: Call) => {
      const f = answers[c.functionName];
      if (!f) throw new Error(`stub: no answer for ${c.functionName}`);
      return f(c);
    },
  } as never;
}

describe("quoteCover (stubbed chain)", () => {
  it("quotes premium, principal, reservation and capacity with the exact contract arithmetic", async () => {
    const sdk = new Bondline(cfg, { client: stubClient() });
    const q = await sdk.quoteCover({ market: "live", offerId: 0, amount: "100", limitBps: 1000, user: USER });
    assert.equal(q.ok, true, q.problems.join("; "));
    assert.equal(q.premium, 1_000_000n);
    assert.equal(q.principal, 99_000_000n);
    assert.equal(q.limitAmount, 9_900_000n);
    assert.equal(q.reservationNeeded, 19_800_000n); // ceil(99 x (30% - 10%))
    assert.equal(q.capacityAllows, true); // 19.80 <= free 19.36 + premium 1.00
    assert.equal(q.rulesAreDefaults, true);
    assert.equal(q.balance?.enough, true);
  });
  it("uses the shared model for the reference price: Careful's rules give the published vector", async () => {
    const v = PRICING_VECTORS.find((x) => x.name.startsWith("Careful's rules"))!;
    const sdk = new Bondline(cfg, { client: stubClient() });
    const q = await sdk.quoteCover({ market: "live", offerId: 0, amount: "100", limitBps: v.limitBps });
    assert.ok(q.reference);
    assert.equal(q.reference.sigmaAsset, "TSLA");
    assert.ok(Math.abs(q.reference.worstCase.fairBps - v.fairBps) < 1e-6, `${q.reference.worstCase.fairBps} vs ${v.fairBps}`);
    assert.equal(q.reference.record, null); // Careful has no record in the shipped snapshot
    assert.equal(q.reference.offerPremiumBps, 101.01);
  });
  it("flags what the contract would refuse", async () => {
    const sdk = new Bondline(cfg, { client: stubClient({ free: 1_000_000n }) });
    const q = await sdk.quoteCover({ market: "live", offerId: 0, amount: "100", limitBps: 1000 });
    assert.equal(q.ok, false);
    assert.equal(q.capacityAllows, false);
    assert.match(q.problems.join(" "), /not enough free bond/);
    await assert.rejects(sdk.buildCoverTransactions({ market: "live", offerId: 0, user: USER, amount: "100", limitBps: 1000 }), /refused/);

    const bad = await new Bondline(cfg, { client: stubClient() }).quoteCover({ market: "live", offerId: 0, amount: "0.5", limitBps: 4000, rules: { maxStockBps: 9000, maxSlippageBps: 900 } });
    assert.equal(bad.ok, false);
    const p = bad.problems.join(" | ");
    assert.match(p, /outside the offer's range/);
    assert.match(p, /1 USDG minimum/);
    assert.match(p, /maxStockBps/);
    assert.match(p, /maxSlippageBps/);
    assert.match(p, /below the 3000 bps cap/);

    const delisted = await new Bondline(cfg, { client: stubClient({ listed: false }) }).quoteCover({ market: "live", offerId: 0, amount: "100", limitBps: 1000 });
    assert.match(delisted.problems.join(" "), /delisted/);
  });
  it("lists offers with free = bond - reserved and flags the team underwriter", async () => {
    const [o] = await new Bondline(cfg, { client: stubClient() }).listOffers({ market: "live" });
    assert.equal(o.free, 19_360_000n);
    assert.equal(o.bond - o.reserved, o.free);
    assert.equal(o.name, "Careful 1%");
    assert.equal(o.underwriterIsTeam, true);
  });
  it("builds the cover transactions it quoted", async () => {
    const sdk = new Bondline(cfg, { client: stubClient() });
    const { transactions, quote } = await sdk.buildCoverTransactions({ market: "live", offerId: 0, user: USER, amount: "100", limitBps: 1000 });
    assert.equal(transactions.length, 2);
    const a = decodeFunctionData({ abi: erc20Abi, data: transactions[0].data });
    assert.deepEqual(a.args, [COVER, quote.amount]);
  });
});

describe("shipped record", () => {
  it("loads the snapshot for a team agent and returns nulls for an unknown agent", () => {
    const sdk = new Bondline(cfg, { client: stubClient() });
    const careful = sdk.getAgentRecord(CAREFUL);
    assert.equal(careful.record?.agent, CAREFUL);
    assert.equal(careful.summary?.name, "Careful");
    const nobody = sdk.getAgentRecord("0x0000000000000000000000000000000000000001");
    assert.equal(nobody.record, null);
    assert.equal(nobody.summary, null);
  });
});
