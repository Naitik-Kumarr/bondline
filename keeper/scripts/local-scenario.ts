// Sets up work for the keeper and agents: one offer behind the Careful agent (createOffer + an exact approve + fund)
// and one behind the Bold agent (createOfferWithAuthorization: one EIP-3009 USDG signature, one transaction), then
// opens a cover on each for a buyer (exact approve + open). Parameterized by env so the same flow can set up the
// testnet later. On any chain other than Anvil (31337) it refuses to run unless CONFIRM_CHAIN_ID names that chain.
//
//   RPC_URL=http://127.0.0.1:8547 BONDLINE_RAW_DEPLOYMENT=../deployments/raw-31337.json \
//   UNDERWRITER_PRIVATE_KEY=0x.. BUYER_PRIVATE_KEY=0x.. FUNDER_PRIVATE_KEY=0x.. \
//   CAREFUL_ADDRESS=0x.. BOLD_ADDRESS=0x.. npm run scenario -w @bondline/keeper
//
// Env (amounts in whole USDG; defaults in brackets):
//   SCENARIO_MARKET [replay] | live          which market to use
//   CAREFUL_ADDRESS / BOLD_ADDRESS           agent addresses (or derived from CAREFUL_/BOLD_PRIVATE_KEY)
//   CAREFUL_COVER / BOLD_COVER               reuse an existing offer (cover address) instead of creating one
//   CAREFUL_FEE_BPS [100]  BOLD_FEE_BPS [400]  premium per deposit
//   CAREFUL_BOND [500]     BOLD_BOND [500]     bond funded at creation
//   MIN_LIMIT_BPS [500]    MAX_LIMIT_BPS [2000]
//   CAREFUL_DEPOSIT [1000] BOLD_DEPOSIT [1000] the buyer's deposit (0 skips that cover)
//   CAREFUL_LIMIT_BPS [1000] BOLD_LIMIT_BPS [1000]
//   MAX_TRADE_BPS [2000] MAX_DAILY_BPS [30000] MAX_SLIPPAGE_BPS [50] MAX_PRICE_AGE [market's max price age]
//   FUNDER_PRIVATE_KEY   optional: tops up the underwriter's and buyer's USDG from this wallet
//   SCENARIO_OUT         where to write the summary [state/scenario-<chainId>-<market>.json]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  createWalletClient,
  domainSeparator,
  formatUnits,
  getAddress,
  isAddress,
  parseEventLogs,
  parseSignature,
  parseUnits,
  toHex,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { randomBytes } from "node:crypto";
import {
  bondlineCoverAbi,
  bondlineMarketAbi,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  usdgAbi,
  type MarketKey,
} from "@bondline/shared";
import {
  accountFromEnv,
  connect,
  envNumber,
  loadEnvFile,
  loadNetConfig,
  readMarket,
  rpcHost,
  transport,
} from "../src/config.ts";

loadEnvFile();
const cfg = loadNetConfig();
const { client, chain } = await connect(cfg, "scenario");
const marketKey = (process.env.SCENARIO_MARKET ?? "replay") as MarketKey;
if (marketKey !== "replay" && marketKey !== "live") throw new Error("SCENARIO_MARKET must be replay or live");
if (chain.id !== 31337 && process.env.CONFIRM_CHAIN_ID !== String(chain.id)) {
  throw new Error(`refusing to send transactions on chain ${chain.id}: set CONFIRM_CHAIN_ID=${chain.id} to confirm`);
}
const market = await readMarket(client, cfg, marketKey);

const usdgUnits = (name: string, fallback: number) => parseUnits(String(envNumber(name, fallback)), 6);
const agentAddress = (name: "CAREFUL" | "BOLD"): Address => {
  const explicit = process.env[`${name}_ADDRESS`];
  if (explicit) {
    if (!isAddress(explicit)) throw new Error(`${name}_ADDRESS is not an address`);
    return getAddress(explicit);
  }
  return accountFromEnv(`${name}_PRIVATE_KEY`).address;
};

const underwriter = accountFromEnv("UNDERWRITER_PRIVATE_KEY");
const buyer = accountFromEnv("BUYER_PRIVATE_KEY");
const funder = process.env.FUNDER_PRIVATE_KEY ? accountFromEnv("FUNDER_PRIVATE_KEY") : null;
const wallet = (account: Account) => createWalletClient({ account, chain, transport: transport(cfg.rpcUrl, "scenario") });
const uw = wallet(underwriter);
const by = wallet(buyer);

const plans = [
  {
    name: "Careful",
    agent: agentAddress("CAREFUL"),
    existing: process.env.CAREFUL_COVER,
    feeBps: envNumber("CAREFUL_FEE_BPS", 100),
    bond: usdgUnits("CAREFUL_BOND", 500),
    maxStockBps: 3000,
    deposit: usdgUnits("CAREFUL_DEPOSIT", 1000),
    limitBps: envNumber("CAREFUL_LIMIT_BPS", 1000),
    withAuthorization: false,
  },
  {
    name: "Bold",
    agent: agentAddress("BOLD"),
    existing: process.env.BOLD_COVER,
    feeBps: envNumber("BOLD_FEE_BPS", 400),
    bond: usdgUnits("BOLD_BOND", 500),
    maxStockBps: 8000,
    deposit: usdgUnits("BOLD_DEPOSIT", 1000),
    limitBps: envNumber("BOLD_LIMIT_BPS", 1000),
    withAuthorization: true,
  },
];

const summary: Record<string, unknown> = {
  chainId: chain.id,
  rpc: rpcHost(cfg.rpcUrl),
  market: marketKey,
  marketAddress: market.address,
  underwriter: underwriter.address,
  buyer: buyer.address,
  offers: [] as unknown[],
};
console.log(
  JSON.stringify({ chainId: chain.id, market: marketKey, marketAddress: market.address, underwriter: underwriter.address, buyer: buyer.address, careful: plans[0].agent, bold: plans[1].agent }),
);

async function send(
  w: WalletClient<Transport, Chain, Account>,
  label: string,
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] },
) {
  const { request } = await (client as PublicClient).simulateContract({ ...call, account: w.account } as Parameters<
    PublicClient["simulateContract"]
  >[0]);
  const hash: Hash = await w.writeContract(request as Parameters<typeof w.writeContract>[0]);
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 1_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash}`);
  return receipt;
}

const balanceOf = (who: Address) => client.readContract({ address: market.usdg, abi: usdgAbi, functionName: "balanceOf", args: [who] });

// Top up USDG from the funder if asked to (local Anvil: the deployer holds 1M mock USDG).
if (funder) {
  const fw = wallet(funder);
  const needs: [string, Address, bigint][] = [
    ["underwriter", underwriter.address, plans.reduce((s, p) => s + (p.existing ? 0n : p.bond), 0n)],
    ["buyer", buyer.address, plans.reduce((s, p) => s + p.deposit, 0n)],
  ];
  for (const [role, who, need] of needs) {
    const have = await balanceOf(who);
    if (have < need) {
      await send(fw, `fund ${role} with ${formatUnits(need - have, 6)} USDG`, {
        address: market.usdg,
        abi: usdgAbi,
        functionName: "transfer",
        args: [who, need - have],
      });
    }
  }
}

// USDG's EIP-712 domain is hardcoded (the token exposes no eip712Domain()); check it against the chain.
const domain = { name: "Global Dollar", version: "1", chainId: chain.id, verifyingContract: market.usdg } as const;
const onchainSeparator = await client.readContract({ address: market.usdg, abi: usdgAbi, functionName: "DOMAIN_SEPARATOR" });
if (domainSeparator({ domain }) !== onchainSeparator) throw new Error("USDG domain separator mismatch: not signing");

for (const p of plans) {
  const terms = {
    agent: p.agent,
    minLimitBps: envNumber("MIN_LIMIT_BPS", 500),
    maxLimitBps: envNumber("MAX_LIMIT_BPS", 2000),
    feeBps: p.feeBps,
    maxStockBps: p.maxStockBps,
    name: `${p.name} (team-operated test offer)`,
  };
  const offer: Record<string, unknown> = { agent: p.name, agentAddress: p.agent, terms };
  let cover: Address;

  if (p.existing) {
    if (!isAddress(p.existing)) throw new Error(`${p.name.toUpperCase()}_COVER is not an address`);
    cover = getAddress(p.existing);
    offer.reused = true;
  } else if (!p.withAuthorization) {
    // Two-step path: createOffer, then an exact approve and fund.
    const created = await send(uw, `${p.name}: createOffer`, {
      address: market.address,
      abi: bondlineMarketAbi,
      functionName: "createOffer",
      args: [terms],
    });
    const [ev] = parseEventLogs({ abi: bondlineMarketAbi, eventName: "OfferCreated", logs: created.logs });
    cover = ev.args.cover;
    const approved = await send(uw, `${p.name}: approve ${formatUnits(p.bond, 6)} USDG`, {
      address: market.usdg,
      abi: usdgAbi,
      functionName: "approve",
      args: [cover, p.bond],
    });
    const funded = await send(uw, `${p.name}: fund`, { address: cover, abi: bondlineCoverAbi, functionName: "fund", args: [p.bond] });
    Object.assign(offer, { id: ev.args.id, createTx: created.transactionHash, approveTx: approved.transactionHash, fundTx: funded.transactionHash });
  } else {
    // One signature, one transaction: EIP-3009 ReceiveWithAuthorization to the market, which pulls the bond,
    // creates the offer and funds it.
    const now = BigInt(Math.floor(Date.now() / 1000));
    const authorization = {
      from: underwriter.address,
      to: market.address,
      value: p.bond,
      validAfter: 0n,
      validBefore: now + 3600n,
      nonce: toHex(randomBytes(32)),
    };
    const signature = await uw.signTypedData({
      domain,
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message: authorization,
    });
    const { r, s, v, yParity } = parseSignature(signature);
    const vNum = v !== undefined ? Number(v) : yParity + 27;
    const created = await send(uw, `${p.name}: createOfferWithAuthorization (one USDG signature)`, {
      address: market.address,
      abi: bondlineMarketAbi,
      functionName: "createOfferWithAuthorization",
      args: [terms, p.bond, authorization.validAfter, authorization.validBefore, authorization.nonce, vNum, r, s],
    });
    const [ev] = parseEventLogs({ abi: bondlineMarketAbi, eventName: "OfferCreated", logs: created.logs });
    cover = ev.args.cover;
    Object.assign(offer, { id: ev.args.id, createAndFundTx: created.transactionHash, oneSignature: true });
  }
  offer.cover = cover;

  if (p.deposit > 0n) {
    const rules = {
      assetMask: 3,
      maxStockBps: p.maxStockBps,
      maxTradeBps: envNumber("MAX_TRADE_BPS", 2000),
      maxDailyBps: envNumber("MAX_DAILY_BPS", 30000),
      maxSlippageBps: envNumber("MAX_SLIPPAGE_BPS", 50),
      maxPriceAge: envNumber("MAX_PRICE_AGE", market.maxPriceAge),
    };
    const approved = await send(by, `${p.name}: buyer approves exactly ${formatUnits(p.deposit, 6)} USDG`, {
      address: market.usdg,
      abi: usdgAbi,
      functionName: "approve",
      args: [cover, p.deposit],
    });
    const opened = await send(by, `${p.name}: open cover (limit ${p.limitBps} bps)`, {
      address: cover,
      abi: bondlineCoverAbi,
      functionName: "open",
      args: [p.limitBps, rules, p.deposit],
    });
    const [ev] = parseEventLogs({ abi: bondlineCoverAbi, eventName: "Opened", logs: opened.logs });
    const [dep] = parseEventLogs({ abi: bondlineCoverAbi, eventName: "Deposited", logs: opened.logs });
    offer.account = ev.args.account;
    offer.rules = rules;
    offer.limitBps = p.limitBps;
    offer.deposit = { amount: formatUnits(dep.args.amount, 6), premium: formatUnits(dep.args.fee, 6), net: formatUnits(dep.args.net, 6), reserved: formatUnits(dep.args.reserveAdded, 6) };
    offer.openTxs = { approve: approved.transactionHash, open: opened.transactionHash };
  }
  (summary.offers as unknown[]).push(offer);
}

const bold = (summary.offers as Record<string, unknown>[])[1];
if (marketKey === "replay" && bold?.account) {
  summary.gapControlExample = {
    market: "replay",
    cover: bold.cover,
    account: bold.account,
    fridayDrawdownBps: 800,
    mondayDrawdownBps: 2500,
    weekendSeconds: 360,
  };
}

const out = resolve(process.env.SCENARIO_OUT ?? join(process.cwd(), "state", `scenario-${chain.id}-${marketKey}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(summary, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
console.log(`wrote ${out}`);
