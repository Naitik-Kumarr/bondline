"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { robinhoodTestnet } from "@bondline/shared/chain";
import { RainbowKitProvider, lightTheme, type DisclaimerComponent, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

/**
 * Wallet and chain-read providers: wagmi 2 + viem, TanStack Query, RainbowKit 2.
 * Client-only. Wrapped around the app routes by src/app/(app)/layout.tsx; the landing page loads it only when
 * someone presses Connect (see components/web3/LazyWalletButton.tsx), so it never weighs on the first load.
 */

const base = lightTheme({
  accentColor: "#1f1f1f",
  accentColorForeground: "#ffffff",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "none",
});

export const bondlineRainbowTheme: Theme = {
  ...base,
  colors: {
    ...base.colors,
    accentColor: "#1f1f1f",
    accentColorForeground: "#ffffff",
    actionButtonBorder: "rgba(31, 31, 31, 0.06)",
    actionButtonBorderMobile: "rgba(31, 31, 31, 0.06)",
    actionButtonSecondaryBackground: "#f4f2ed",
    closeButton: "#57554f",
    closeButtonBackground: "#f4f2ed",
    connectButtonBackground: "#ffffff",
    connectButtonInnerBackground: "#f4f2ed",
    connectButtonText: "#1f1f1f",
    error: "#b13f39",
    generalBorder: "rgba(31, 31, 31, 0.08)",
    generalBorderDim: "rgba(31, 31, 31, 0.05)",
    menuItemBackground: "#f4f2ed",
    modalBackdrop: "rgba(31, 31, 31, 0.34)",
    modalBackground: "#ffffff",
    modalBorder: "rgba(31, 31, 31, 0.08)",
    modalText: "#1f1f1f",
    modalTextDim: "#a8a49c",
    modalTextSecondary: "#57554f",
    profileAction: "#ffffff",
    profileActionHover: "#f4f2ed",
    profileForeground: "#faf8f4",
    selectedOptionBorder: "rgba(124, 131, 238, 0.55)",
    standby: "#7c83ee",
  },
  fonts: {
    body: "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  radii: {
    ...base.radii,
    actionButton: "9999px",
    connectButton: "9999px",
    menuButton: "9999px",
    modal: "24px",
    modalMobile: "24px",
  },
  shadows: {
    ...base.shadows,
    connectButton: "0 0 0 1px rgba(31, 31, 31, 0.06)",
    dialog: "0 2px 6px rgba(31, 31, 31, 0.05), 0 28px 64px -24px rgba(31, 31, 31, 0.3)",
    profileDetailsAction: "0 0 0 1px rgba(31, 31, 31, 0.06)",
    selectedOption: "0 0 0 1px rgba(124, 131, 238, 0.4)",
    selectedWallet: "0 0 0 1px rgba(124, 131, 238, 0.4)",
    walletLogo: "0 0 0 1px rgba(31, 31, 31, 0.06)",
  },
};

const Disclaimer: DisclaimerComponent = ({ Text }) => (
  <Text>Bondline runs on Robinhood Chain testnet (chain id 46630). Testnet, unaudited. Test tokens only.</Text>
);

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 2 } },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={bondlineRainbowTheme}
          modalSize="compact"
          initialChain={robinhoodTestnet}
          appInfo={{ appName: "Bondline", disclaimer: Disclaimer }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default Providers;
