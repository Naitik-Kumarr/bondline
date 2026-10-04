"use client";

import { LABELS } from "@bondline/shared/constants";
import type { MarketKey } from "@bondline/shared/deployment";
import Link from "next/link";
import { AddressPill } from "@/components/ui/AddressPill";
import { AgentMark } from "@/components/ui/AgentMark";
import { ArrowRightIcon } from "@/components/ui/icons";
import { DemoLabel } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { formatBps } from "@/lib/format";
import { AGENTS, MARKETS, type PersonaKey } from "@/components/account/kit/bondline";
import { Segmented } from "@/components/account/kit/Fields";
import { priceAt, type PriceTables } from "./price-lookup";

const REFERENCE_LIMIT = 1000;

const pctOf = (bps: number | null) =>
  bps === null ? "—" : `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: bps < 100 ? 2 : 1 })}%`;

/** Step 1: which agent to back (with both reference prices) and on which market. */
export function AgentChoice({
  prices,
  agent,
  market,
  onAgent,
  onMarket,
}: {
  prices: PriceTables;
  agent: PersonaKey | null;
  market: MarketKey;
  onAgent: (key: PersonaKey) => void;
  onMarket: (key: MarketKey) => void;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label="Agent" className="grid gap-4 md:grid-cols-2">
        {AGENTS.map((a) => {
          const t = prices.agents[a.key];
          const active = agent === a.key;
          const worst = priceAt(t.worst, REFERENCE_LIMIT);
          const record = t.record ? priceAt(t.record, REFERENCE_LIMIT) : null;
          return (
            <div
              key={a.key}
              className={cn(
                "relative flex min-w-0 flex-col rounded-card-lg border bg-surface p-4 transition-[border-color,box-shadow] duration-200 sm:p-6",
                active
                  ? "border-transparent shadow-[0_0_0_1.5px_var(--color-accent),0_14px_32px_-18px_rgb(74_80_194/0.5)]"
                  : "border-line shadow-soft hover:border-line-strong",
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`Back ${a.name}`}
                onClick={() => onAgent(a.key)}
                className="absolute inset-0 z-0 rounded-card-lg"
              />
              <div className="pointer-events-none relative flex items-center gap-3 sm:gap-4">
                <AgentMark address={a.address} size={44} />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h3 className="font-display text-[30px] leading-none tracking-[-0.02em] text-ink">{a.name}</h3>
                  <DemoLabel kind="team" title="Careful and Bold are run by the Bondline team, on Claude Haiku 4.5" />
                </div>
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    active ? "border-accent-ink bg-accent-ink" : "border-line-strong bg-surface",
                  )}
                >
                  <span className={cn("size-2 rounded-full bg-white", active ? "opacity-100" : "opacity-0")} />
                </span>
              </div>
              <p className="pointer-events-none relative mt-3 text-[14.5px] leading-snug text-ink-2 sm:pl-[60px]">{a.line}</p>

              <div className="pointer-events-none relative mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-card bg-line">
                <div className="bg-page/80 p-3.5">
                  <div className="text-[12.5px] text-ink-3">Max share after a buy</div>
                  <div className="num mt-1 text-[22px] leading-none text-ink">{pctOf(worst)}</div>
                  <div className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
                    its rules: {formatBps(t.maxStockBps)} in stocks
                  </div>
                </div>
                <div className="bg-page/80 p-3.5">
                  <div className="text-[12.5px] text-ink-3">Its record</div>
                  <div className={cn("num mt-1 text-[22px] leading-none", record === null ? "text-ink-4" : "text-accent-ink")}>
                    {pctOf(record)}
                  </div>
                  <div className="mt-1.5 text-[11.5px] leading-snug text-ink-3">
                    {t.exposureP95 !== null
                      ? `p95: ${Math.round(t.exposureP95 * 100)}% in stocks`
                      : "No record yet"}
                  </div>
                </div>
              </div>
              <p className="pointer-events-none relative mt-3 text-[12px] leading-snug text-ink-3">
                For {prices.termDays} days of cover at a 10% limit, with σ {(prices.sigma * 100).toFixed(1)}% (
                {prices.sigmaAsset}, from Chainlink closes{" "}
                <span className="whitespace-nowrap">{prices.sigmaWindow}</span>).
              </p>

              <div className="relative z-10 mt-4 flex items-center justify-between gap-2">
                <AddressPill address={a.address} />
                <Link
                  href={`/agent/${a.address}`}
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-ink underline decoration-ink/20 underline-offset-4 hover:decoration-ink"
                >
                  Its record <ArrowRightIcon size={13} />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <DemoLabel kind="model" />
        {LABELS.modelPrice}
      </p>

      <div className="mt-8">
        <div className="text-[14px] font-medium text-ink">Market</div>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Segmented
            ariaLabel="Market"
            value={market}
            onChange={onMarket}
            options={MARKETS.map((m) => ({ value: m.key, label: `${m.label} market` }))}
          />
          {market === "replay" ? <DemoLabel kind="replay" className="self-start sm:self-auto" /> : null}
        </div>
        <p className="mt-3 max-w-[40rem] text-[13px] leading-relaxed text-ink-3">
          {MARKETS.find((m) => m.key === market)?.note}
        </p>
      </div>
    </div>
  );
}
