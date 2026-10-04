"use client";

import { AddressPill } from "@/components/ui/AddressPill";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/icons";
import { TxStatus } from "@/components/ui/TxStatus";
import { usdg as fmtUsdg } from "@/lib/bondline/format";
import type { LiveOfferResult } from "./SignStep";

/** The end of the flow: a calm, clear "offer is live". */
export function OfferLive({ result, onAnother }: { result: LiveOfferResult; onAnother: () => void }) {
  return (
    <div className="relative mx-auto max-w-[40rem] py-4 text-center sm:py-8">
      <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-positive-soft text-positive">
        <CheckIcon size={22} strokeWidth={2} />
      </span>
      <h2 className="mt-6 font-display text-display-m text-ink">Your offer is live.</h2>
      <p className="mx-auto mt-4 max-w-[34rem] text-[16px] leading-relaxed text-ink-2">
        <span className="text-ink">{result.name}</span> backs {result.agent.name} on the {result.market.label} market
        with <span className="num text-bond-ink">{fmtUsdg(result.bond)}</span> USDG. Buyers can take cover from it now,
        and every premium joins your bond.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <AddressPill address={result.cover} label={`Offer #${result.id}`} copy />
      </div>
      <TxStatus
        state="success"
        hash={result.hash}
        successLabel="Created and funded in one transaction"
        className="mx-auto mt-6 max-w-[30rem] text-left"
      />
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="#your-offers" iconRight={<ArrowRightIcon size={15} className="rotate-90" />}>
          Your dashboard
        </ButtonLink>
        <ButtonLink href="/market" variant="secondary">
          See it on the market
        </ButtonLink>
        <Button variant="ghost" onClick={onAnother}>
          Create another offer
        </Button>
      </div>
    </div>
  );
}
