import Link from "next/link";
import { AddressPill } from "@/components/ui/AddressPill";
import { AgentMark } from "@/components/ui/AgentMark";
import { Card } from "@/components/ui/Card";
import { ArrowRightIcon } from "@/components/ui/icons";
import type { OfferView } from "@/lib/bondline/book";
import type { BoardAgent } from "./data";
import { int, pct, plural, utcTime } from "./fmt";
import { OfferRow } from "./OfferRow";
import { PriceCaption, PricePills } from "./PricePills";
import { ScoreRing } from "./ScoreRing";
import { Sparkline } from "./Sparkline";

/**
 * One agent on the board: its generated mark, score, record sparkline and two reference prices, then every offer
 * behind it in this market.
 */
export function AgentCard({ rank, agent, offers }: { rank: number; agent: BoardAgent; offers: OfferView[] }) {
  const s = agent.summary;
  const cap = agent.prices.worstCaseShare;
  const href = `/agent/${agent.agent}`;
  return (
    <Card as="article" padding="none" className="flex h-full flex-col overflow-hidden" aria-label={`${agent.name}, agent`}>
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <AgentMark address={agent.agent} size={48} />
            <div className="min-w-0">
              <p className="num text-[11px] uppercase tracking-[0.12em] text-ink-3">No. {String(rank).padStart(2, "0")}</p>
              <h3 className="mt-1 truncate font-display text-[30px] leading-none tracking-[-0.02em] text-ink sm:text-[34px]">
                <Link href={href} className="transition-colors hover:text-accent-ink">
                  {agent.name}
                </Link>
              </h3>
            </div>
          </div>
          <ScoreRing value={s?.score ?? null} size={64} />
        </div>

        <div className="mt-4">
          <AddressPill address={agent.agent} flagTeam />
        </div>

        <p className="mt-4 text-[14.5px] leading-relaxed text-ink-2">
          {cap != null ? (
            <>
              Its rules allow up to <span className="num text-ink">{pct(cap, 0)}</span> in stocks.{" "}
            </>
          ) : null}
          {s?.hasRecord ? (
            <>
              <span className="num text-ink">{int(s.trades)}</span> {plural(s.trades, "trade")},{" "}
              <span className="num text-ink">{int(s.refusals)}</span> {plural(s.refusals, "refusal")},{" "}
              <span className="num text-ink">{int(s.claims)}</span> {plural(s.claims, "claim")} on-chain.
            </>
          ) : (
            <>No record yet: only the reference price at the maximum stock share allowed after a buy.</>
          )}
        </p>
        {s?.generatedAt ? (
          <p className="mt-1.5 text-[12px] text-ink-3">
            Record rebuilt from chain events at {utcTime(Date.parse(s.generatedAt) / 1000)}.
          </p>
        ) : null}

        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between gap-3 text-[12.5px] text-ink-3">
            <span>Stock share after each trade</span>
            {s?.exposureP95 != null ? (
              <span>
                p95 <span className="num text-ink">{pct(s.exposureP95)}</span>
              </span>
            ) : null}
          </div>
          <Sparkline points={agent.series} cap={cap} height={56} />
        </div>

        <div className="mt-6">
          <PriceCaption prices={agent.prices} className="mb-2.5" />
          <PricePills prices={agent.prices} />
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3 border-t border-line bg-page/70 p-3 sm:p-4">
        <p className="px-1 pt-1 text-[12.5px] text-ink-3">
          {offers.length === 1 ? "One offer" : `${offers.length} offers`} behind {agent.name} in this market
        </p>
        {offers.map((o) => (
          <OfferRow key={o.cover} offer={o} prices={agent.prices} />
        ))}
      </div>

      <Link
        href={href}
        className="group flex items-center justify-between gap-3 border-t border-line px-5 py-4 text-[14.5px] font-medium text-ink transition-colors hover:bg-page/60 sm:px-7"
      >
        See {agent.name}&apos;s record
        <ArrowRightIcon
          size={15}
          className="shrink-0 transition-transform duration-[var(--duration-spring)] ease-spring group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </Link>
    </Card>
  );
}
