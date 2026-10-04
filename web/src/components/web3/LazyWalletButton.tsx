"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { Spinner } from "@/components/ui/icons";

const loadIsland = () => import("./WalletIsland");
const WalletIsland = lazy(loadIsland);

/**
 * A Connect button that costs nothing until it's needed: wagmi, RainbowKit and their CSS load on hover, focus
 * or click. Returning visitors who connected before get the wallet stack when the browser is idle, so their
 * address shows. `buttonClassName` comes from the server (buttonClasses()), so no styling code ships here.
 */
export function LazyWalletButton({ buttonClassName }: { buttonClassName: string }) {
  const [active, setActive] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);

  useEffect(() => {
    let connectedBefore = false;
    try {
      connectedBefore = Boolean(window.localStorage.getItem("wagmi.recentConnectorId"));
    } catch {
      connectedBefore = false;
    }
    if (!connectedBefore) return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => setActive(true));
    return () => cancel(id);
  }, []);

  if (active) {
    return (
      <Suspense
        fallback={
          <button type="button" disabled aria-busy="true" className={buttonClassName}>
            <span className="invisible">Connect</span>
            <span className="absolute inset-0 flex items-center justify-center">
              <Spinner size={14} />
              <span className="sr-only">Loading wallets</span>
            </span>
          </button>
        }
      >
        <WalletIsland autoOpen={autoOpen} />
      </Suspense>
    );
  }

  return (
    <button
      type="button"
      className={buttonClassName}
      onPointerEnter={() => void loadIsland()}
      onFocus={() => void loadIsland()}
      onClick={() => {
        setAutoOpen(true);
        setActive(true);
      }}
    >
      Connect
    </button>
  );
}
