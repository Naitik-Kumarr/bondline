// Client-side building blocks for the chain actions. Pages wire these into wagmi; the logic lives here once.
import {
  keccak256,
  parseSignature,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { RECEIVE_WITH_AUTHORIZATION_TYPES, USDG, USDG_DOMAIN, usdgAbi } from "@bondline/shared";

export interface OfferTerms {
  agent: Address;
  minLimitBps: number;
  maxLimitBps: number;
  feeBps: number;
  maxStockBps: number;
  name: string;
}

export interface Rules {
  assetMask: number;
  maxStockBps: number;
  maxTradeBps: number;
  maxDailyBps: number;
  maxSlippageBps: number;
  maxPriceAge: number;
}

/**
 * Signs USDG's EIP-3009 ReceiveWithAuthorization for `createOfferWithAuthorization`: the market pulls exactly
 * `bond` from the signer, and only the market can use it. Returns the args for the market call.
 */
export async function signOfferAuthorization(
  wallet: WalletClient,
  params: { from: Address; market: Address; bond: bigint; validForSeconds?: number },
) {
  const nonce = keccak256(toHex(`bondline:${params.from}:${Date.now()}:${Math.random()}`));
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + (params.validForSeconds ?? 3600));
  const signature = await wallet.signTypedData({
    account: params.from,
    domain: USDG_DOMAIN,
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: { from: params.from, to: params.market, value: params.bond, validAfter, validBefore, nonce },
  });
  const { r, s, v, yParity } = parseSignature(signature);
  const vNumber = v !== undefined ? Number(v) : yParity + 27;
  return { bond: params.bond, validAfter, validBefore, nonce, v: vNumber, r: r as Hex, s: s as Hex };
}

/** USDG issuer controls: explain plainly if either blocks the wallet, before anyone signs. */
export async function usdgControls(client: PublicClient, wallet: Address) {
  const [paused, frozen, balance] = await Promise.all([
    client.readContract({ address: USDG, abi: usdgAbi, functionName: "paused" }),
    client.readContract({ address: USDG, abi: usdgAbi, functionName: "isFrozen", args: [wallet] }),
    client.readContract({ address: USDG, abi: usdgAbi, functionName: "balanceOf", args: [wallet] }),
  ]);
  const problem = paused
    ? "USDG transfers are paused by its issuer, Paxos, so nothing can be deposited right now."
    : frozen
      ? "This wallet is frozen by USDG's issuer, Paxos. It can't send or receive USDG, including a payout."
      : null;
  return { paused, frozen, balance, problem };
}

/** Sensible default rules for each persona; the user can tighten them within the offer's terms. */
export function defaultRules(persona: "careful" | "bold", maxPriceAge: number): Rules {
  return persona === "careful"
    ? { assetMask: 3, maxStockBps: 3000, maxTradeBps: 1000, maxDailyBps: 20_000, maxSlippageBps: 50, maxPriceAge }
    : { assetMask: 3, maxStockBps: 8000, maxTradeBps: 4000, maxDailyBps: 60_000, maxSlippageBps: 50, maxPriceAge };
}
