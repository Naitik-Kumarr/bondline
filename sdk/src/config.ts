// Where the SDK points: a chain, an RPC, USDG and one or more Bondline markets. The default is the Robinhood Chain
// testnet deployment recorded in @bondline/shared. `configFromRaw` reads the raw file `forge script Deploy` writes,
// which is how the end-to-end test points the SDK at a local Anvil chain.
import { readFileSync } from "node:fs";
import { defineChain, getAddress, isAddress, type Address, type Chain } from "viem";
import {
  deployment,
  isDeployed,
  robinhoodTestnet,
  STOCKS,
  USDG_DOMAIN,
  type Deployment,
  type StockSymbol,
} from "@bondline/shared";

export interface MarketConfig {
  /** "live" and "replay" on the testnet. */
  key: string;
  label: string;
  address: Address;
  /** Oldest price (seconds) the market's settle, withdraw and demo exchange accept. */
  maxPriceAge: number;
}

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export interface BondlineConfig {
  chainId: number;
  rpcUrl: string;
  chain: Chain;
  usdg: Address;
  /** USDG's EIP-712 domain: what an underwriter signs EIP-3009 authorizations against. */
  usdgDomain: Eip712Domain;
  markets: MarketConfig[];
  /** Lower-case token address -> symbol, used to name a market's assets and to pick the volatility for pricing. */
  assetSymbols: Record<string, StockSymbol>;
  explorerUrl?: string;
}

export const TESTNET_RPC_URL = robinhoodTestnet.rpcUrls.default.http[0];

/** The Robinhood Chain testnet deployment from @bondline/shared. Throws if it has not been deployed. */
export function testnetConfig(opts: { rpcUrl?: string; deployment?: Deployment } = {}): BondlineConfig {
  const d = opts.deployment ?? deployment;
  if (!(opts.deployment ? opts.deployment.status === "deployed" : isDeployed)) {
    throw new Error("Bondline is not deployed in this checkout (shared/src/deployment.json status is not 'deployed')");
  }
  const markets: MarketConfig[] = [];
  for (const key of ["live", "replay"] as const) {
    const m = d.markets[key];
    if (m.address) markets.push({ key, label: m.label, address: getAddress(m.address), maxPriceAge: m.maxPriceAge });
  }
  const assetSymbols: Record<string, StockSymbol> = {};
  for (const [symbol, address] of Object.entries(d.assets)) assetSymbols[address.toLowerCase()] = symbol as StockSymbol;
  const chain = d.chainId === robinhoodTestnet.id ? robinhoodTestnet : defineChain({ ...robinhoodTestnet, id: d.chainId });
  return {
    chainId: d.chainId,
    rpcUrl: opts.rpcUrl ?? TESTNET_RPC_URL,
    chain,
    usdg: getAddress(d.usdg),
    usdgDomain: { ...USDG_DOMAIN, chainId: d.chainId, verifyingContract: getAddress(d.usdg) },
    markets,
    assetSymbols,
    explorerUrl: robinhoodTestnet.blockExplorers.default.url,
  };
}

/** The raw deployment file written by contracts/script/Deploy.s.sol (deployments/raw-<chainId>.json). */
export interface RawDeployment {
  chainId: number;
  usdg: string;
  tsla: string;
  amzn: string;
  liveMarket: string;
  replayMarket: string;
  liveMaxPriceAge: number;
  replayMaxPriceAge: number;
}

/** A config for any chain Bondline was deployed to with the deploy script (a local Anvil chain, or a fork). */
export function configFromRaw(raw: RawDeployment, rpcUrl: string): BondlineConfig {
  const chain = defineChain({
    id: raw.chainId,
    name: `Bondline chain ${raw.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return {
    chainId: raw.chainId,
    rpcUrl,
    chain,
    usdg: getAddress(raw.usdg),
    usdgDomain: { name: USDG_DOMAIN.name, version: USDG_DOMAIN.version, chainId: raw.chainId, verifyingContract: getAddress(raw.usdg) },
    markets: [
      { key: "live", label: "Live", address: getAddress(raw.liveMarket), maxPriceAge: raw.liveMaxPriceAge },
      { key: "replay", label: "Replay", address: getAddress(raw.replayMarket), maxPriceAge: raw.replayMaxPriceAge },
    ],
    assetSymbols: { [raw.tsla.toLowerCase()]: "TSLA", [raw.amzn.toLowerCase()]: "AMZN" },
  };
}

export { STOCKS };

/**
 * The config for a process: BONDLINE_RAW_DEPLOYMENT (a raw deploy file) with BONDLINE_RPC_URL points at a local chain;
 * otherwise the Robinhood Chain testnet, at BONDLINE_RPC_URL if set.
 */
export function configFromEnv(env: Record<string, string | undefined> = process.env): BondlineConfig {
  const raw = env.BONDLINE_RAW_DEPLOYMENT;
  if (raw) {
    const rpc = env.BONDLINE_RPC_URL;
    if (!rpc) throw new Error("BONDLINE_RAW_DEPLOYMENT needs BONDLINE_RPC_URL");
    return configFromRaw(JSON.parse(readFileSync(raw, "utf8")) as RawDeployment, rpc);
  }
  return testnetConfig({ rpcUrl: env.BONDLINE_RPC_URL });
}

/** An address, or the name of a team agent ("careful", "bold") from the testnet deployment record. */
export function resolveAgentAddress(nameOrAddress: string): Address {
  if (isAddress(nameOrAddress)) return getAddress(nameOrAddress);
  const w = (deployment.wallets as Record<string, Address>)[nameOrAddress.toLowerCase()];
  if (w && ["careful", "bold"].includes(nameOrAddress.toLowerCase())) return getAddress(w);
  throw new Error(`not an address or a team agent name ("careful", "bold"): ${nameOrAddress}`);
}
