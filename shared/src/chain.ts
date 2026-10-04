import { defineChain } from "viem";

/** Robinhood Chain testnet: where Bondline runs. Gas is ETH. */
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

/** Robinhood Chain mainnet: read-only, for Chainlink's TSLA and AMZN prices. */
export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

export const EXPLORER_URL = "https://explorer.testnet.chain.robinhood.com";
/** Robinhood Chain testnet faucet: gas ETH and test Stock Tokens. */
export const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";
/** Paxos's testnet faucet, for test USDG (Paxos lists Robinhood Chain testnet USDG in its docs). */
export const USDG_FAUCET_URL = "https://faucet.paxos.com";

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER_URL}/address/${address}`;
