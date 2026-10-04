import { isLocalFork } from "@bondline/shared/deployment";
import type { ReactNode } from "react";
import { REPO_URL } from "@/components/tour/links";
import { GitHubIcon } from "@/components/ui/icons";
import { DemoLabel } from "@/components/ui/Pill";
import { DesktopNav, MobileNav } from "./SiteNav";
import { Wordmark } from "./Wordmark";

/**
 * Floating pill header. `wallet` is the connect control: <LazyWalletButton/> on the landing page,
 * <WalletButton/> inside the wallet providers on app pages.
 * On a build that reads a local fork of the testnet (deployment record `fork: true`), a "Local fork" label sits
 * next to the wordmark, so nobody mistakes fork data for the real deployment.
 */
export function SiteHeader({ wallet }: { wallet: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="relative mx-auto flex h-14 max-w-[72rem] items-center justify-between gap-3 rounded-full border border-line bg-surface/95 pl-4 pr-2 shadow-soft sm:pl-5 md:bg-surface/80 md:backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2.5">
          <Wordmark />
          {isLocalFork ? (
            <DemoLabel
              kind="demo"
              title="This build reads a local fork of Robinhood Chain testnet, not the public chain. Transactions on it don't exist on the explorer."
              className="h-5 px-2 text-[9.5px]"
            >
              <span className="sm:hidden">Fork</span>
              <span className="hidden sm:inline">Local fork</span>
            </DemoLabel>
          ) : null}
        </div>
        <DesktopNav />
        <div className="flex items-center gap-1.5">
          <a
            href={REPO_URL ?? "https://github.com/Naitik-Kumarr/bondline"}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Bondline on GitHub"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
          >
            <GitHubIcon size={18} />
          </a>
          {wallet}
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
