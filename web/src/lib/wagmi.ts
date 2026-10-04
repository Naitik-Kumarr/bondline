import { robinhoodTestnet } from "@bondline/shared/chain";
import { connectorsForWallets, type WalletList } from "@rainbow-me/rainbowkit";
import { injectedWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { getAddress, isAddress, type Address } from "viem";
import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { mock } from "wagmi/connectors";

/**
 * WalletConnect is optional. Without NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID the app offers browser-injected wallets
 * only: the generic "Browser Wallet" plus every wallet that announces itself over EIP-6963 (MetaMask, Rabby, ...),
 * which RainbowKit lists under "Installed". No WalletConnect connector is created, so nothing throws.
 */
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || undefined;

// NEXT_PUBLIC_RH_RPC_URL points the browser at a local fork of the testnet in development (scripts/dev-fork.sh).
export const RPC_URL = process.env.NEXT_PUBLIC_RH_RPC_URL?.trim() || undefined;

/** True only for an RPC on this machine (a local fork), never a public chain. */
function isLocalRpc(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "http:" && (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]");
  } catch {
    return false;
  }
}

/**
 * Dev-only end-to-end wallet: with NEXT_PUBLIC_E2E_ACCOUNT set AND NEXT_PUBLIC_RH_RPC_URL on localhost, a wagmi `mock`
 * connector connects as that address. It forwards every wallet request (eth_sendTransaction, eth_signTypedData_v4)
 * to the local node, where the account is unlocked, so no key is ever in the bundle. Unset (production): no change.
 */
const E2E_ACCOUNT: Address | undefined = (() => {
  const raw = process.env.NEXT_PUBLIC_E2E_ACCOUNT?.trim();
  return raw && isAddress(raw) && isLocalRpc(RPC_URL) ? getAddress(raw) : undefined;
})();
export const isE2E = E2E_ACCOUNT !== undefined;

// The mock connector sends wallet requests to the chain's default RPC, so in e2e mode that is the local fork.
const chain: typeof robinhoodTestnet = isE2E
  ? ({ ...robinhoodTestnet, rpcUrls: { default: { http: [RPC_URL] } } } as unknown as typeof robinhoodTestnet)
  : robinhoodTestnet;

const wallets: WalletList = WALLETCONNECT_PROJECT_ID
  ? [
      { groupName: "Browser", wallets: [injectedWallet] },
      { groupName: "Mobile", wallets: [walletConnectWallet, rainbowWallet] },
    ]
  : [{ groupName: "Browser", wallets: [injectedWallet] }];

const connectors: CreateConnectorFn[] = connectorsForWallets(wallets, {
  appName: "Bondline",
  appDescription: "USDG protection for AI traders. Robinhood Chain testnet.",
  projectId: WALLETCONNECT_PROJECT_ID ?? "",
});
if (E2E_ACCOUNT) connectors.push(mock({ accounts: [E2E_ACCOUNT], features: { defaultConnected: true, reconnect: true } }));

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors,
  transports: { [chain.id]: http(RPC_URL) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
