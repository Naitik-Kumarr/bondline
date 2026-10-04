"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Button, type ButtonProps } from "@/components/ui/Button";

/** The action slot before a wallet is connected: opens the connect modal. */
export function ConnectButton({ children = "Connect a wallet", ...rest }: Omit<ButtonProps, "onClick">) {
  const { openConnectModal } = useConnectModal();
  return (
    <Button onClick={openConnectModal} disabled={!openConnectModal} {...rest}>
      {children}
    </Button>
  );
}
