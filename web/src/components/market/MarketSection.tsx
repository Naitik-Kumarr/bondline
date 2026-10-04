import { LABELS } from "@bondline/shared/constants";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { Reveal } from "@/components/ui/Reveal";
import { AgentCard } from "./AgentCard";
import type { BoardMarket } from "./data";
import { duration, int, usd, usdgToUsd, utcTime } from "./fmt";

const TITLES = { replay: "Replay market", live: "Live market" } as const;

/** The market's label (LABELS.replayMarket / liveMarket) after its "Replay market:" prefix, which the heading says. */
function note(label: string) {
  const rest = label.replace(/^[^:]+:\s*/, "");
  return rest ? rest[0].toUpperCase() + rest.slice(1) : label;
}
const NOTES = { replay: note(LABELS.replayMarket), live: note(LABELS.liveMarket) } as const;

/** The market's own prices, and whether they are fresh enough to trade and settle on. */
function PriceStrip({ market, now }: { market: BoardMarket; now: number }) {
  const known = market.prices.filter((p) => p.price != null && p.updatedAt != null);
  if (known.length === 0) return null;
  const oldest = Math.min(...known.map((p) => p.updatedAt!));
  const age = Math.max(0, now - oldest);
  const fresh = age <= market.maxPriceAge;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-2">
      {known.map((p) => (
        <span key={p.symbol} className="inline-flex items-baseline gap-1.5">
          <span className="font-mono text-[11.5px] tracking-[0.06em] text-ink-3">{p.symbol}</span>
          <span className="num text-ink">
            ${p.price!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </span>
      ))}
      <Pill
        size="sm"
        dot
        tone={fresh ? "positive" : "caution"}
        title={`This market accepts prices up to ${duration(market.maxPriceAge)} old for trades and settles. Oldest price updated ${utcTime(oldest, { seconds: true })}.`}
      >
        {fresh ? "Prices fresh" : "Prices stale"} · <span className="num">{duration(age)}</span> old
      </Pill>
      {!fresh ? (
        <span className="text-[12.5px] text-ink-3">Agents wait and nothing settles until prices move again.</span>
      ) : null}
    </div>
  );
}

export function MarketSection({ market, now }: { market: BoardMarket; now: number }) {
  const id = `market-${market.key}`;
  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      <Reveal className="mb-6 sm:mb-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <div className="max-w-[44rem]">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id={id} className="font-display text-display-m text-ink">
                {TITLES[market.key]}
              </h2>
              {market.key === "replay" ? (
                <DemoLabel kind="replay" title={LABELS.replayMarket}>
                  Demo prices
                </DemoLabel>
              ) : (
                <Pill size="sm" tone="accent" dot title={LABELS.liveMarket}>
                  Real Chainlink prices
                </Pill>
              )}
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{NOTES[market.key]}</p>
          </div>
          <dl className="flex shrink-0 gap-7 text-[13px]">
            <div>
              <dt className="text-ink-3">Bonded</dt>
              <dd className="num mt-1 text-[18px] text-ink">{usd(usdgToUsd(market.bond))}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Free to sell</dt>
              <dd className="num mt-1 text-[18px] text-ink">{usd(usdgToUsd(market.free))}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Covers</dt>
              <dd className="num mt-1 text-[18px] text-ink">{int(market.covers)}</dd>
            </div>
          </dl>
        </div>
        <div className="mt-5">
          <PriceStrip market={market} now={now} />
        </div>
      </Reveal>

      {market.agents.length === 0 ? (
        <div className="rounded-card-lg border border-dashed border-line-strong px-6 py-12 text-center text-[15px] text-ink-2">
          No offers in this market yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
          {market.agents.map((g, i) => (
            <Reveal key={g.agent.agent} delay={i * 0.06} className="h-full">
              <AgentCard rank={i + 1} agent={g.agent} offers={g.offers} />
            </Reveal>
          ))}
        </div>
      )}
    </section>
  );
}
