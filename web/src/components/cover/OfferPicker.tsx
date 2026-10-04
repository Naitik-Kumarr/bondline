"use client";

import { AgentMark } from "@/components/ui/AgentMark";
import { DemoLabel } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { formatBps, formatUsd } from "@/lib/format";
import { agentName, marketByKey } from "@/components/account/kit/bondline";
import { toDollars } from "@/components/account/kit/Money";
import type { LiveOffer } from "@/components/account/kit/useOffers";

export const offerKey = (o: Pick<LiveOffer, "market" | "id">) => `${o.market}:${o.id}`;

/** The offers to choose from, as radio cards: agent, market, premium, limit range and free bond. */
export function OfferPicker({
  offers,
  selected,
  onSelect,
}: {
  offers: LiveOffer[] | undefined;
  selected: string | undefined;
  onSelect: (key: string) => void;
}) {
  if (!offers) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading offers">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} rounded="lg" className="h-[148px]" />
        ))}
      </div>
    );
  }
  if (offers.length === 0) {
    return (
      <p className="rounded-card bg-sunken px-5 py-6 text-[15px] text-ink-2">
        No listed offers yet. Underwriters create them on the Underwrite page.
      </p>
    );
  }
  return (
    <div role="radiogroup" aria-label="Offers" className="grid gap-3 sm:grid-cols-2">
      {offers.map((o) => {
        const key = offerKey(o);
        const active = key === selected;
        const share = o.bond > 0n ? Number((o.reserved * 10_000n) / o.bond) / 10_000 : 0;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(key)}
            className={cn(
              "group relative flex min-w-0 flex-col rounded-card border bg-surface p-4 text-left transition-[border-color,box-shadow] duration-200 sm:p-5",
              active
                ? "border-transparent shadow-[0_0_0_1.5px_var(--color-accent),0_10px_28px_-16px_rgb(74_80_194/0.45)]"
                : "border-line shadow-soft hover:border-line-strong",
            )}
          >
            <div className="flex items-start gap-3">
              <AgentMark address={o.agent} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15.5px] font-medium text-ink">{o.terms.name}</span>
                </div>
                <div className="mt-0.5 text-[13px] text-ink-3">
                  Behind {agentName(o.agent)} · {marketByKey(o.market)?.label ?? o.market} market
                </div>
              </div>
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1 inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
                  active ? "border-accent-ink bg-accent-ink" : "border-line-strong bg-surface",
                )}
              >
                <span className={cn("size-1.5 rounded-full bg-white", active ? "opacity-100" : "opacity-0")} />
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-[12.5px]">
              <div>
                <dt className="text-ink-3">Premium</dt>
                <dd className="num mt-0.5 text-[14px] text-ink">{formatBps(o.terms.feeBps)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Limits</dt>
                <dd className="num mt-0.5 text-[14px] text-ink">
                  {formatBps(o.terms.minLimitBps)}–{formatBps(o.terms.maxLimitBps)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Free bond</dt>
                <dd className="num mt-0.5 text-[14px] text-bond-ink">{formatUsd(Math.floor(toDollars(o.free)))}</dd>
              </div>
            </dl>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bond-soft" aria-hidden="true">
              <div className="h-full w-full origin-left rounded-full bg-bond" style={{ transform: `scaleX(${share})` }} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-3">
              <span>
                <span className="num">{formatUsd(Math.round(toDollars(o.bond)))}</span> bond ·{" "}
                <span className="num">{Math.round(share * 100)}%</span> reserved
              </span>
              {o.team ? <DemoLabel kind="team" title="Team-operated test underwriter" /> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
