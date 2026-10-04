"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useRef } from "react";
import { AgentMark } from "@/components/ui/AgentMark";
import { Button, buttonClasses } from "@/components/ui/Button";
import { AlertIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/** Opens the connect modal once, right after the wallet stack loads from a click on the lazy button. */
function AutoOpen({ open }: { open?: () => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !open) return;
    done.current = true;
    open();
  }, [open]);
  return null;
}

/**
 * The header's wallet control, styled with our pill buttons. Needs the providers from src/app/providers.tsx.
 * Disconnected: dark "Connect". Wrong network: "Switch network". Connected: the address's mark + short address.
 */
export function WalletButton({ autoOpen = false, className }: { autoOpen?: boolean; className?: string }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted) {
          return <span aria-hidden="true" className={cn(buttonClasses({ size: "sm" }), "invisible w-[92px]", className)} />;
        }
        if (!account || !chain) {
          return (
            <>
              {autoOpen ? <AutoOpen open={openConnectModal} /> : null}
              <Button size="sm" onClick={openConnectModal} className={className}>
                Connect
              </Button>
            </>
          );
        }
        if (chain.unsupported) {
          return (
            <Button
              size="sm"
              variant="danger"
              onClick={openChainModal}
              icon={<AlertIcon size={14} />}
              className={className}
            >
              Switch network
            </Button>
          );
        }
        return (
          <button
            type="button"
            onClick={openAccountModal}
            aria-label={`Wallet ${account.address}`}
            className={cn(buttonClasses({ variant: "secondary", size: "sm" }), "gap-2 pl-1.5 pr-3.5", className)}
          >
            <AgentMark address={account.address} size={24} />
            <span className="num text-[13px]">{account.displayName}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
