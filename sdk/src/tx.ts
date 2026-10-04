// Pure builders: no network, no keys. Each returns an UNSIGNED transaction (to, data, value, chainId) or typed data;
// the caller's own wallet signs and sends it.
import { bytesToHex, encodeFunctionData, erc20Abi, getAddress, parseSignature, type Address, type Hex } from "viem";
import { agentAccountAbi, bondlineCoverAbi, bondlineMarketAbi, RECEIVE_WITH_AUTHORIZATION_TYPES } from "@bondline/shared";
import type { Eip712Domain } from "./config.ts";
import { encodeDecision, type EncodedDecision } from "./decision.ts";

export interface UnsignedTransaction {
  to: Address;
  data: Hex;
  /** Always 0: Bondline moves only USDG. */
  value: bigint;
  chainId: number;
  /** The address that must send it, when the contract restricts the caller. */
  from?: Address;
  description: string;
  call: { contract: string; function: string; args: Record<string, unknown> };
}

export interface RulesInput {
  /** Bit i set means the market's asset i may be traded. */
  assetMask: number;
  maxStockBps: number;
  maxTradeBps: number;
  maxDailyBps: number;
  maxSlippageBps: number;
  maxPriceAge: number;
}

export interface TermsInput {
  agent: Address;
  minLimitBps: number;
  maxLimitBps: number;
  feeBps: number;
  maxStockBps: number;
  name: string;
}

// The contracts' own bounds (BondlineMarket, BondlineCover).
export const CONTRACT_BOUNDS = {
  capBps: 3000,
  maxFeeBps: 500,
  maxNameBytes: 64,
  minDeposit: 1_000_000n,
  maxSlippageBps: 500,
  maxDailyBps: 100_000,
} as const;

/** The reasons the contract would refuse these rules, empty if it would accept them. Mirrors `_validRules`. */
export function validateRules(rules: RulesInput, ctx: { assetCount: number; offerMaxStockBps: number; marketMaxPriceAge: number }): string[] {
  const p: string[] = [];
  if (rules.assetMask === 0 || rules.assetMask >= 1 << ctx.assetCount) p.push(`assetMask must be 1..${(1 << ctx.assetCount) - 1}`);
  if (rules.maxStockBps > ctx.offerMaxStockBps) p.push(`maxStockBps ${rules.maxStockBps} is above the offer's ${ctx.offerMaxStockBps}`);
  if (rules.maxTradeBps === 0 || rules.maxTradeBps > 10_000) p.push("maxTradeBps must be 1..10000");
  if (rules.maxDailyBps === 0 || rules.maxDailyBps > CONTRACT_BOUNDS.maxDailyBps) p.push(`maxDailyBps must be 1..${CONTRACT_BOUNDS.maxDailyBps}`);
  if (rules.maxSlippageBps > CONTRACT_BOUNDS.maxSlippageBps) p.push(`maxSlippageBps must be 0..${CONTRACT_BOUNDS.maxSlippageBps}`);
  if (rules.maxPriceAge === 0 || rules.maxPriceAge > ctx.marketMaxPriceAge) p.push(`maxPriceAge must be 1..${ctx.marketMaxPriceAge} seconds`);
  return p;
}

/** The reasons the market would refuse these terms. Mirrors `_validTerms`. */
export function validateTerms(t: TermsInput): string[] {
  const p: string[] = [];
  if (!/^0x[0-9a-fA-F]{40}$/.test(t.agent) || /^0x0{40}$/.test(t.agent)) p.push("agent must be a non-zero address");
  if (t.minLimitBps === 0 || t.minLimitBps > t.maxLimitBps) p.push("need 0 < minLimitBps <= maxLimitBps");
  if (t.maxLimitBps >= CONTRACT_BOUNDS.capBps) p.push(`maxLimitBps must be below the ${CONTRACT_BOUNDS.capBps} bps cap`);
  if (t.feeBps > CONTRACT_BOUNDS.maxFeeBps) p.push(`feeBps must be at most ${CONTRACT_BOUNDS.maxFeeBps}`);
  if (t.maxStockBps === 0 || t.maxStockBps > 10_000) p.push("maxStockBps must be 1..10000");
  const nameBytes = new TextEncoder().encode(t.name).length;
  if (nameBytes === 0 || nameBytes > CONTRACT_BOUNDS.maxNameBytes) p.push(`name must be 1..${CONTRACT_BOUNDS.maxNameBytes} bytes`);
  return p;
}

const rulesTuple = (r: RulesInput) => ({
  assetMask: r.assetMask,
  maxStockBps: r.maxStockBps,
  maxTradeBps: r.maxTradeBps,
  maxDailyBps: r.maxDailyBps,
  maxSlippageBps: r.maxSlippageBps,
  maxPriceAge: r.maxPriceAge,
});

/**
 * A user's cover: two transactions to send in order, from the user. 1) USDG.approve(cover, amount): exactly the
 * deposit, nothing more. 2) cover.open(limitBps, rules, amount), which clones the user's AgentAccount, takes the
 * premium out of the deposit and sends the rest to the account.
 */
export function buildCoverTransactions(args: {
  chainId: number;
  usdg: Address;
  cover: Address;
  user?: Address;
  limitBps: number;
  rules: RulesInput;
  amount: bigint;
}): UnsignedTransaction[] {
  const { chainId, usdg, cover, user, limitBps, rules, amount } = args;
  const from = user ? getAddress(user) : undefined;
  return [
    {
      to: getAddress(usdg),
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(cover), amount] }),
      value: 0n,
      chainId,
      from,
      description: `Approve the cover to take exactly ${amount} USDG base units (the deposit).`,
      call: { contract: "USDG", function: "approve", args: { spender: getAddress(cover), amount } },
    },
    {
      to: getAddress(cover),
      data: encodeFunctionData({ abi: bondlineCoverAbi, functionName: "open", args: [limitBps, rulesTuple(rules), amount] }),
      value: 0n,
      chainId,
      from,
      description: `Open a cover with a ${limitBps} bps loss limit and deposit ${amount} USDG base units. Send after the approval is mined.`,
      call: { contract: "BondlineCover", function: "open", args: { limitBps, rules: rulesTuple(rules), amount } },
    },
  ];
}

export interface OfferAuthorization {
  /** What the underwriter signs (EIP-712, USDG's ReceiveWithAuthorization). */
  typedData: {
    domain: Eip712Domain;
    types: typeof RECEIVE_WITH_AUTHORIZATION_TYPES;
    primaryType: "ReceiveWithAuthorization";
    message: { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex };
  };
  market: Address;
  terms: TermsInput;
  bond: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

const randomNonce = (): Hex => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));

/**
 * The one signature that creates and funds an offer: the underwriter signs USDG's EIP-3009
 * ReceiveWithAuthorization (from the underwriter, to the market, for the bond). The market pulls the bond only when
 * the underwriter themself calls `createOfferWithAuthorization`, so nobody else can use or redirect the signature.
 */
export function buildOfferAuthorization(args: {
  domain: Eip712Domain;
  market: Address;
  underwriter: Address;
  terms: TermsInput;
  bond: bigint;
  /** Seconds the authorization stays valid from `now`. Default one hour. */
  validForSeconds?: number;
  /** Unix seconds. Defaults to the local clock. */
  now?: number;
  nonce?: Hex;
}): OfferAuthorization {
  const problems = validateTerms(args.terms);
  if (problems.length) throw new Error(`terms would be refused: ${problems.join("; ")}`);
  if (args.bond <= 0n) throw new RangeError("bond must be greater than zero");
  const now = BigInt(args.now ?? Math.floor(Date.now() / 1000));
  const validAfter = 0n;
  const validBefore = now + BigInt(args.validForSeconds ?? 3600);
  const nonce = args.nonce ?? randomNonce();
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) throw new Error("nonce must be 32 bytes of hex");
  return {
    typedData: {
      domain: args.domain,
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message: { from: getAddress(args.underwriter), to: getAddress(args.market), value: args.bond, validAfter, validBefore, nonce },
    },
    market: getAddress(args.market),
    terms: { ...args.terms, agent: getAddress(args.terms.agent) },
    bond: args.bond,
    validAfter,
    validBefore,
    nonce,
  };
}

/** The underwriter's single transaction, once they have signed: market.createOfferWithAuthorization. */
export function buildCreateOfferTransaction(args: { chainId: number; authorization: OfferAuthorization; signature: Hex }): UnsignedTransaction {
  const a = args.authorization;
  const parsed = parseSignature(args.signature);
  const sig = { r: parsed.r, s: parsed.s, v: Number(parsed.v ?? BigInt(parsed.yParity) + 27n) };
  return {
    to: a.market,
    data: encodeFunctionData({
      abi: bondlineMarketAbi,
      functionName: "createOfferWithAuthorization",
      args: [a.terms, a.bond, a.validAfter, a.validBefore, a.nonce, sig.v, sig.r, sig.s],
    }),
    value: 0n,
    chainId: args.chainId,
    from: a.typedData.message.from,
    description: `Create and fund the offer "${a.terms.name}" behind ${a.terms.agent} with ${a.bond} USDG base units, using the signed authorization.`,
    call: {
      contract: "BondlineMarket",
      function: "createOfferWithAuthorization",
      args: { terms: a.terms, bond: a.bond, validAfter: a.validAfter, validBefore: a.validBefore, nonce: a.nonce, v: sig.v, r: sig.r, s: sig.s },
    },
  };
}

/** `trade(asset, isBuy, usdAmount, minOut, decision)` on an agent's account. Only the account's agent may send it. */
export function buildTradeTransaction(args: {
  chainId: number;
  account: Address;
  agent?: Address;
  asset: Address;
  isBuy: boolean;
  /** USDG base units to spend (buy) or the USDG value to sell; max uint256 sells everything. */
  usdAmount: bigint;
  /** Least stock tokens (buy) or USDG (sell) accepted, in base units. */
  minOut: bigint;
  decision: Record<string, unknown> | string;
}): { transaction: UnsignedTransaction; decision: EncodedDecision } {
  const decision = encodeDecision(args.decision);
  return {
    decision,
    transaction: {
      to: getAddress(args.account),
      data: encodeFunctionData({
        abi: agentAccountAbi,
        functionName: "trade",
        args: [getAddress(args.asset), args.isBuy, args.usdAmount, args.minOut, decision.hex],
      }),
      value: 0n,
      chainId: args.chainId,
      from: args.agent ? getAddress(args.agent) : undefined,
      description: `${args.isBuy ? "Buy" : "Sell"} ${args.asset} through the account. The decision JSON hashes to ${decision.hash}.`,
      call: {
        contract: "AgentAccount",
        function: "trade",
        args: { asset: getAddress(args.asset), isBuy: args.isBuy, usdAmount: args.usdAmount, minOut: args.minOut, decision: decision.json },
      },
    },
  };
}
