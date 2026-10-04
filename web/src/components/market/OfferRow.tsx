import { CAP_BPS } from "@bondline/shared/constants";
import { Suspense } from "react";
import { AddressPill } from "@/components/ui/AddressPill";
import { ButtonLink } from "@/components/ui/Button";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import type { OfferView } from "@/lib/bondline/book";
import { cn } from "@/lib/cn";
import { CapacityBar } from "./CapacityBar";
import { OfferYield } from "./OfferYield";
import type { AgentPrices } from "./data";
import { bpsPct, int, modelPct, usd, usdgToUsd } from "./fmt";

function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] leading-tight text-ink-3">{label}</dt>
      <dd className="num mt-1.5 text-[19px] leading-none tracking-[-0.02em] text-ink sm:text-[21px]">{value}</dd>
      {hint ? <dd className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{hint}</dd> : null}
    </div>
  );
}

/**
 * One offer: one underwriter's bond behind this agent. The premium sits next to the agent's reference price;
 * then the limit range, the 30% cap and the free bond (capacity), with a link to buy cover from it.
 */
export function OfferRow({
  offer,
  prices,
  className,
  showMarket = false,
}: {
  offer: OfferView;
  prices: AgentPrices;
  className?: string;
  showMarket?: boolean;
}) {
  const bond = usdgToUsd(offer.bond);
  const free = usdgToUsd(offer.free);
  const reserved = usdgToUsd(offer.reserved);
  const active = offer.accounts.filter((a) => a.health.status === "Active").length;
  const settled = offer.accounts.filter((a) => a.health.status === "Settled").length;
  const closed = offer.accounts.filter((a) => a.health.status === "Closed").length;
  const open = offer.listed && offer.free > 0n;
  const name = offer.terms.name?.trim() || `Offer ${offer.id}`;

  return (
    <div className={cn("rounded-card border border-line bg-surface p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">{name}</p>
          <p className="num mt-0.5 text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
            {showMarket ? `${offer.market} market · ` : null}offer #{offer.id}
          </p>
        </div>
        {open ? (
          <ButtonLink
            href={`/cover?market=${offer.market}&offer=${offer.id}`}
            size="sm"
            iconRight={<ArrowRightIcon size={14} />}
          >
            Get covered
          </ButtonLink>
        ) : (
          <Pill tone="caution" dot>
            {offer.listed ? "Full: no free bond" : "Delisted"}
          </Pill>
        )}
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
        <Fact label="Premium" value={bpsPct(offer.terms.feeBps)} hint="of each deposit" />
        <Fact
          label="Limit you pick"
          value={
            <>
              {bpsPct(offer.terms.minLimitBps)} to {bpsPct(offer.terms.maxLimitBps)}
            </>
          }
          hint="loss limit"
        />
        <Fact label="Cover to" value={`−${bpsPct(CAP_BPS)}`} hint={`the ${bpsPct(CAP_BPS)} cap`} />
      </dl>

      {prices.worstCaseBps != null ? (
        <p className="mt-4 rounded-field bg-accent-tint px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          Premium <span className="num text-ink">{bpsPct(offer.terms.feeBps)}</span> vs the agent&apos;s reference
          price <span className="num text-ink">{modelPct(prices.worstCaseBps)}</span> at the maximum stock share allowed after a buy
          {prices.recordBps != null ? (
            <>
              {" "}
              · <span className="num text-ink">{modelPct(prices.recordBps)}</span> its record
            </>
          ) : null}
          <span className="text-ink-3"> (model: {bpsPct(prices.limitBps)} limit, {prices.termDays} days)</span>
        </p>
      ) : null}

      <Suspense fallback={<div aria-hidden="true" className="mt-4 h-[74px] rounded-field bg-sunken/60" />}>
        <OfferYield offer={offer} />
      </Suspense>

      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-[12.5px] text-ink-3">Capacity · free bond</span>
          <span className="num text-[13px] text-ink">
            {usd(free)} <span className="text-ink-3">of {usd(bond)}</span>
          </span>
        </div>
        <CapacityBar
          share={bond > 0 ? free / bond : 0}
          label={`${usd(free)} of a ${usd(bond)} bond is free to back new cover`}
        />
        <p className="mt-2 text-[12px] text-ink-3">
          <span className="num">{usd(reserved)}</span> reserved for <span className="num">{int(active)}</span> active
          cover{active === 1 ? "" : "s"}
          {settled ? (
            <>
              , <span className="num">{int(settled)}</span> settled
            </>
          ) : null}
          {closed ? (
            <>
              , <span className="num">{int(closed)}</span> closed
            </>
          ) : null}
          . Every deposit reserves its worst case first.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line pt-4">
        <span className="text-[12.5px] text-ink-3">Underwriter</span>
        <AddressPill address={offer.underwriter} flagTeam />
      </div>
    </div>
  );
}
