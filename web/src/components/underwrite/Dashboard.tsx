"use client";

import { bondlineCoverAbi } from "@bondline/shared/abis";
import NumberFlow from "@number-flow/react";
import { useState } from "react";
import { useAccount } from "wagmi";
import { AddressPill } from "@/components/ui/AddressPill";
import { AgentMark } from "@/components/ui/AgentMark";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { NetworkGuard } from "@/components/ui/NetworkGuard";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { Accent } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { TxStatus } from "@/components/ui/TxStatus";
import { cn } from "@/lib/cn";
import { formatBps } from "@/lib/format";
import { usdg as fmtUsdg } from "@/lib/bondline/format";
import { agentName, marketByKey } from "@/components/account/kit/bondline";
import { ConnectButton } from "@/components/account/kit/ConnectPrompt";
import { Field, NumberInput } from "@/components/account/kit/Fields";
import { Usd } from "@/components/account/kit/Money";
import { useOffers, type LiveOffer } from "@/components/account/kit/useOffers";
import { useTx } from "@/components/account/kit/useTx";
import { parseUsdg } from "@/components/cover/math";

function Figure({
  label,
  children,
  hint,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "bond" | "positive" | "negative";
}) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-ink-3">{label}</div>
      <div
        className={cn(
          "num mt-1.5 text-[22px] leading-none tracking-[-0.02em] text-ink sm:text-[24px]",
          tone === "bond" && "text-bond-ink",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
        )}
      >
        {children}
      </div>
      {hint ? <div className="mt-1.5 text-[12px] leading-snug text-ink-3">{hint}</div> : null}
    </div>
  );
}

function Release({ offer }: { offer: LiveOffer }) {
  const { address } = useAccount();
  const tx = useTx();
  const [text, setText] = useState("");
  const amount = parseUsdg(text);
  const tooMuch = amount !== null && amount > offer.free;
  const ok = amount !== null && amount > 0n && !tooMuch;
  return (
    <div className="mt-6 rounded-card bg-sunken p-4 sm:p-5">
      <Field
        label="Release free bond"
        htmlFor={`release-${offer.cover}`}
        aside={
          <button
            type="button"
            className="num text-ink-2 underline decoration-ink/20 underline-offset-4 hover:text-ink"
            onClick={() => setText(fmtUsdg(offer.free).replace(/,/g, ""))}
          >
            Free {fmtUsdg(offer.free)} USDG
          </button>
        }
        error={tooMuch ? "Only free bond can be released; the rest backs active covers." : undefined}
        hint="Back to your wallet. Reserved bond stays until its covers are settled or closed."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <NumberInput
            id={`release-${offer.cover}`}
            value={text}
            onChange={setText}
            unit="USDG"
            placeholder="0.00"
            invalid={tooMuch}
            className="sm:flex-1"
          />
          <NetworkGuard mode="banner">
            <Button
              variant="secondary"
              size="lg"
              className="sm:w-auto"
              disabled={!ok || !address}
              loading={tx.busy}
              loadingLabel="Releasing"
              onClick={async () => {
                if (!address || !amount) return;
                const receipt = await tx.send({
                  address: offer.cover,
                  abi: bondlineCoverAbi,
                  functionName: "release",
                  args: [address, amount],
                });
                if (receipt) setText("");
              }}
            >
              Release
            </Button>
          </NetworkGuard>
        </div>
      </Field>
      <TxStatus state={tx.state} hash={tx.hash} error={tx.error} label="Release" successLabel="Released to your wallet" className="mt-3" />
    </div>
  );
}

function OfferPanel({ offer }: { offer: LiveOffer }) {
  const accounts = offer.accounts ?? [];
  const active = accounts.filter((a) => a.status === "Active").length;
  const pnl = offer.premiums - offer.claimsPaid;
  const reservedShare = offer.bond > 0n ? Number((offer.reserved * 10_000n) / offer.bond) / 10_000 : 0;
  const market = marketByKey(offer.market);
  return (
    <Card as="article">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <AgentMark address={offer.agent} size={44} />
          <div className="min-w-0">
            <h3 className="truncate text-[19px] font-medium tracking-[-0.01em] text-ink">{offer.terms.name}</h3>
            <p className="mt-0.5 text-[13.5px] text-ink-3">
              Behind {agentName(offer.agent)} · {market?.label} market · Offer #{offer.id} ·{" "}
              <span className="num">{formatBps(offer.terms.feeBps)}</span> premium ·{" "}
              <span className="num">
                {formatBps(offer.terms.minLimitBps)} to {formatBps(offer.terms.maxLimitBps)}
              </span>{" "}
              limits
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {offer.market === "replay" ? <DemoLabel kind="replay" title={market?.note} /> : null}
          <Pill size="sm" dot tone={offer.listed ? "positive" : "neutral"}>
            {offer.listed ? "Listed" : "Delisted"}
          </Pill>
          <AddressPill address={offer.cover} />
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
        <Figure label="Bond" tone="bond">
          <Usd amount={offer.bond} />
        </Figure>
        <Figure label="Reserved" hint="Backs active covers' worst case">
          <Usd amount={offer.reserved} />
        </Figure>
        <Figure label="Free capacity" hint="What new cover can draw on, or you can release">
          <Usd amount={offer.free} />
        </Figure>
      </div>
      <div className="mt-5" aria-hidden="true">
        <div className="h-2 overflow-hidden rounded-full bg-bond-soft">
          <div className="h-full w-full origin-left rounded-full bg-bond-strong" style={{ transform: `scaleX(${reservedShare})` }} />
        </div>
        <div className="num mt-1.5 flex justify-between text-[11.5px] text-ink-3">
          <span>{Math.round(reservedShare * 100)}% reserved</span>
          <span>{Math.round((1 - reservedShare) * 100)}% free</span>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-line pt-6 sm:grid-cols-4">
        <Figure label="Premiums earned" tone="positive">
          <Usd amount={offer.premiums} />
        </Figure>
        <Figure label="Claims paid" tone={offer.claimsPaid > 0n ? "negative" : undefined}>
          <Usd amount={offer.claimsPaid} />
        </Figure>
        <Figure label="P&L" hint="Premiums − claims" tone={pnl > 0n ? "positive" : pnl < 0n ? "negative" : undefined}>
          <Usd amount={pnl} signed />
        </Figure>
        <Figure label="Active covers" hint={`${accounts.length} opened in all`}>
          <NumberFlow value={active} locales="en-US" />
        </Figure>
      </div>

      <Release offer={offer} />
    </Card>
  );
}

/** Every offer the connected wallet underwrites, live from the chain. */
export function UnderwriterDashboard() {
  const { address, isConnected } = useAccount();
  const offersQ = useOffers({ withAccounts: true });
  const mine = address
    ? (offersQ.data ?? []).filter((o) => o.underwriter.toLowerCase() === address.toLowerCase())
    : [];

  return (
    <Container as="section" id="your-offers" aria-labelledby="your-offers-title" className="mt-16 scroll-mt-24 sm:mt-24">
      <h2 id="your-offers-title" className="font-display text-display-m text-ink">
        Your <Accent>offers</Accent>
      </h2>
      <p className="mt-3 max-w-[40rem] text-[16px] leading-relaxed text-ink-2">
        Bond, reserved and free capacity, premiums earned, claims paid and P&amp;L, read live from the chain. You can
        release free bond at any time. You cannot release reserved bond or veto a payout by delisting. Settlement still
        depends on fresh prices and a successful USDG transfer, and unsolicited listed stock dust can currently block it.
      </p>
      <div className="mt-8 flex flex-col gap-5">
        {!isConnected ? (
          <Card tone="sunken" className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[15px] text-ink-2">Connect a wallet to see the offers it underwrites.</p>
            <ConnectButton variant="secondary" />
          </Card>
        ) : offersQ.isPending ? (
          <Card aria-busy="true" aria-label="Loading your offers">
            <div className="flex items-center gap-3">
              <Skeleton rounded="lg" className="size-11" />
              <div className="flex-1">
                <Skeleton className="h-5 w-48" rounded="sm" />
                <Skeleton className="mt-2 h-3.5 w-72 max-w-full" rounded="sm" />
              </div>
            </div>
            <div className="mt-7 grid grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          </Card>
        ) : mine.length === 0 ? (
          <Card tone="sunken">
            <p className="text-[15px] text-ink-2">
              No offers from this wallet yet. Create one above: it takes one signature and one transaction.
            </p>
          </Card>
        ) : (
          mine.map((o) => <OfferPanel key={`${o.market}:${o.id}`} offer={o} />)
        )}
      </div>
    </Container>
  );
}
