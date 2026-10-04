"use client";

import { Providers } from "@/app/providers";
import { WalletButton } from "./WalletButton";

/** The full wallet stack around a single button, for pages that don't otherwise load wagmi (the landing page). */
export default function WalletIsland({ autoOpen = false }: { autoOpen?: boolean }) {
  return (
    <Providers>
      <WalletButton autoOpen={autoOpen} />
    </Providers>
  );
}
