"use client";

import { bondlineMarketAbi } from "@bondline/shared/abis";
import { robinhoodTestnet } from "@bondline/shared/chain";
import { useState } from "react";
import { parseEventLogs, type Address, type Hex } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { Button } from "@/components/ui/Button";
import { NetworkGuard } from "@/components/ui/NetworkGuard";
import { TxStatus } from "@/components/ui/TxStatus";
import { formatBps } from "@/lib/format";
import { signOfferAuthorization } from "@/lib/bondline/actions";
import { usdg as fmtUsdg } from "@/lib/bondline/format";
import { TOKEN_ERRORS, type AgentInfo, type MarketInfo } from "@/components/account/kit/bondline";
import { CheckList } from "@/components/account/kit/Checks";
import { ConnectButton } from "@/components/account/kit/ConnectPrompt";
import { FundsChecks } from "@/components/account/kit/FundsChecks";
import { useTx } from "@/components/account/kit/useTx";
import { useWalletFunds } from "@/components/account/kit/useWalletFunds";
import type { ValidTerms } from "./terms";

const marketWithTokenErrors = [...bondlineMarketAbi, ...TOKEN_ERRORS] as const;

export interface LiveOfferResult {
  id: number;
  cover: Address;
  hash: Hex;
  name: string;
  bond: bigint;
  agent: AgentInfo;
  market: MarketInfo;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-[14px] text-ink-3">{label}</dt>
      <dd className="text-right text-[15px] text-ink">{children}</dd>
    </div>
  );
}

/**
 * Step 3: one USDG signature (EIP-3009 ReceiveWithAuthorization for exactly the bond, usable only by the market),
 * then one transaction that creates the offer and funds it. No approve step.
 */
export function SignStep({
  agent,
  market,
  valid,
  onLive,
}: {
  agent: AgentInfo;
  market: MarketInfo;
  valid: ValidTerms;
  onLive: (result: LiveOfferResult) => void;
}) {
  const { address, isConnected } = useAccount();
  const funds = useWalletFunds(address);
  const { data: walletClient } = useWalletClient({ chainId: robinhoodTestnet.id });
  const tx = useTx();
  const [phase, setPhase] = useState<"sign" | "send">("sign");

  const ready =
    isConnected &&
    Boolean(walletClient) &&
    !funds.problem &&
    !funds.checking &&
    funds.usdg !== undefined &&
    funds.usdg >= valid.bond &&
    funds.eth !== 0n;

  const go = async () => {
    if (!walletClient || !address) return;
    setPhase("sign");
    const auth = await tx.sign(() =>
      signOfferAuthorization(walletClient, { from: address, market: market.address, bond: valid.bond }),
    );
    if (!auth) return;
    setPhase("send");
    const receipt = await tx.send({
      address: market.address,
      abi: marketWithTokenErrors,
      functionName: "createOfferWithAuthorization",
      args: [valid.terms, auth.bond, auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s],
    });
    if (!receipt) return;
    const [created] = parseEventLogs({ abi: bondlineMarketAbi, logs: receipt.logs, eventName: "OfferCreated" });
    if (!created) return;
    onLive({
      id: Number(created.args.id),
      cover: created.args.cover,
      hash: receipt.transactionHash,
      name: valid.terms.name,
      bond: valid.bond,
      agent,
      market,
    });
  };

  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <dl className="divide-y divide-line border-y border-line">
          <Row label="Offer">{valid.terms.name}</Row>
          <Row label="Agent">{agent.name}</Row>
          <Row label="Market">{market.label}</Row>
          <Row label="Limits buyers can choose">
            <span className="num">
              {formatBps(valid.terms.minLimitBps)} to {formatBps(valid.terms.maxLimitBps)}
            </span>
          </Row>
          <Row label="Premium">
            <span className="num">{formatBps(valid.terms.feeBps)}</span> of each deposit
          </Row>
          <Row label="Most in stocks">
            <span className="num">{formatBps(valid.terms.maxStockBps)}</span>
          </Row>
          <Row label="Bond">
            <span className="num text-bond-ink">{fmtUsdg(valid.bond)} USDG</span>
          </Row>
        </dl>
        <div className="mt-5 rounded-card bg-accent-tint px-4 py-3.5 text-[13.5px] leading-relaxed text-ink-2">
          <div className="eyebrow mb-1.5 text-accent-ink">What you sign</div>
          One USDG authorization (EIP-3009 <span className="num text-[12.5px]">ReceiveWithAuthorization</span>): the
          market may pull exactly <span className="num text-ink">{fmtUsdg(valid.bond)}</span> USDG from this wallet,
          valid for one hour, and only the market can use it. Then one transaction creates the offer and funds its bond.
          No approve step.
        </div>
      </div>

      <div>
        <p className="eyebrow mb-3">Before you sign</p>
        <CheckList>
          {isConnected ? (
            <FundsChecks funds={funds} need={valid.bond} needWhat="this bond" />
          ) : (
            <li className="text-[14px] text-ink-2">Connect the wallet that will underwrite this offer.</li>
          )}
        </CheckList>
        <div className="mt-6">
          {!isConnected ? (
            <ConnectButton size="lg" className="w-full" />
          ) : (
            <NetworkGuard>
              <Button
                size="lg"
                className="w-full"
                disabled={!ready}
                loading={tx.busy}
                loadingLabel={phase === "sign" ? "Waiting for your signature" : "Creating the offer"}
                onClick={go}
              >
                Sign once and create the offer
              </Button>
              <TxStatus
                state={tx.state}
                hash={tx.hash}
                error={tx.error}
                label={phase === "sign" ? "Sign the USDG authorization (no gas)" : "Create and fund the offer"}
                className="mt-4"
              />
            </NetworkGuard>
          )}
        </div>
      </div>
    </div>
  );
}
