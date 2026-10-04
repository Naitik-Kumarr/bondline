"use client";

import { robinhoodTestnet } from "@bondline/shared/chain";
import type { ReactNode } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { AlertIcon, SwitchIcon } from "./icons";
import { describeTxError } from "./TxStatus";

/**
 * Wrong network → one-click switch to Robinhood Chain testnet (adds the chain to the wallet if it's missing).
 * `block` (default) replaces its children with the prompt; `banner` shows the prompt above them.
 * Needs the wagmi providers (pages under src/app/(app)/). Not connected or on the right chain: renders children.
 */
export function NetworkGuard({
  children,
  mode = "block",
  className,
}: {
  children?: ReactNode;
  mode?: "block" | "banner";
  className?: string;
}) {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  const wrong = isConnected && chainId !== robinhoodTestnet.id;
  if (!wrong) return <>{children}</>;

  const prompt = (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-4 rounded-card-lg border border-[rgb(138_94_12/0.18)] bg-caution-soft p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
        <div>
          <p className="font-medium text-ink">Your wallet is on another network.</p>
          <p className="mt-1 text-[14px] text-ink-2">
            Bondline runs on {robinhoodTestnet.name} (chain id {robinhoodTestnet.id}).
          </p>
          {error ? <p className="mt-1 text-[13px] text-negative">{describeTxError(error)}</p> : null}
        </div>
      </div>
      <Button
        onClick={() => switchChain({ chainId: robinhoodTestnet.id })}
        loading={isPending}
        loadingLabel="Switching network"
        icon={<SwitchIcon size={15} />}
        className="self-start sm:self-auto"
      >
        Switch to Robinhood Chain testnet
      </Button>
    </div>
  );

  return mode === "banner" ? (
    <>
      {prompt}
      {children}
    </>
  ) : (
    prompt
  );
}
