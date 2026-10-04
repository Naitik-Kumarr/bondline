import type { Address } from "viem";
import raw from "./deployment.json" with { type: "json" };
import type { StockSymbol } from "./constants.ts";

/**
 * The Robinhood Chain testnet deployment record. The canonical copy lives in deployments/rhTestnet.json;
 * the deploy script syncs it here so every package reads the same addresses.
 */
export type MarketKey = "live" | "replay";

export interface MarketDeployment {
  label: string;
  address: Address | null;
  venue: Address | null;
  deployBlock: number | null;
  maxPriceAge: number;
  spreadBps: number;
  feeds: Record<StockSymbol, Address | null>;
}

export interface Deployment {
  chainId: number;
  status: string;
  /** Set only for a local fork of the testnet (scripts/dev-fork.sh): never shown as the real deployment. */
  fork?: boolean;
  deployedAt: string | null;
  usdg: Address;
  assets: Record<StockSymbol, Address>;
  wallets: Record<"deployer" | "keeper" | "careful" | "bold" | "underwriter" | "buyer", Address>;
  implementations: { cover: Address | null; account: Address | null };
  markets: Record<MarketKey, MarketDeployment>;
  replay: { source: string; windowStart: number; windowEnd: number; speed: number; startsAt: number | null };
  /** The read-only ProofOfCover lookup, deployed after the markets (docs/PROOF_OF_COVER.md). */
  proofOfCover?: { address: Address; deployTx: string; deployBlock: number; record: string };
}

export const deployment = raw as Deployment;
export const isDeployed = deployment.status === "deployed";
export const isLocalFork = deployment.fork === true;

/** Team-operated wallets, so the site can label them and leave them out of "outside" counts. */
export const TEAM_WALLETS: Record<string, string> = Object.fromEntries(
  Object.entries(deployment.wallets).map(([role, address]) => [address.toLowerCase(), role]),
);
export const isTeamWallet = (address: string) => address.toLowerCase() in TEAM_WALLETS;
