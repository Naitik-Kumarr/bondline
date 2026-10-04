import { LABELS } from "@bondline/shared/constants";
import type { AgentPrices as Prices } from "@/components/market/data";
import { bpsPct, bpsText, modelPct, pct, usd } from "@/components/market/fmt";
import { Card } from "@/components/ui/Card";
import { DemoLabel } from "@/components/ui/Pill";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeader } from "@/components/ui/Section";

function PriceCard({
  title,
  bps,
  share,
  shareNote,
  tone,
}: {
  title: string;
  bps: number | null;
  share: number | null;
  shareNote: string;
  tone: "surface" | "accent";
}) {
  return (
    <Card tone={tone} className="flex h-full flex-col">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {bps != null ? (
        <>
          <p className={`num mt-5 text-[44px] leading-none tracking-[-0.03em] sm:text-[56px] ${tone === "accent" ? "text-accent-ink" : "text-ink"}`}>
            {modelPct(bps)}
          </p>
          <p className="mt-3 text-[13.5px] text-ink-2">
            <span className="num">{bpsText(bps)}</span> of the amount covered ·{" "}
            <span className="num">{usd(bps / 10, { cents: true })}</span> per $1,000
          </p>
          <p className="mt-auto pt-6 text-[13.5px] text-ink-3">
            w = <span className="num text-ink-2">{pct(share ?? 0)}</span> in stocks: {shareNote}
          </p>
        </>
      ) : (
        <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
          No record yet, so there&apos;s no record price. An agent with no record has only the reference price at the
          maximum stock share allowed after a buy.
        </p>
      )}
    </Card>
  );
}

/** The two reference prices, side by side, and what the difference is worth. */
export function AgentPricesSection({ prices, name }: { prices: Prices; name: string }) {
  const saving = prices.worstCaseBps != null && prices.recordBps != null ? prices.worstCaseBps - prices.recordBps : null;
  return (
    <Section spacing="sm" aria-labelledby="prices">
      <SectionHeader
        eyebrow="Reference price"
        title={<span id="prices">Two prices: its rules, and its record</span>}
        size="m"
        lead={
          <>
            What the published model says cover on {name} is worth, for{" "}
            <span className="num">{prices.termDays}</span> days at a <span className="num">{bpsPct(prices.limitBps)}</span>{" "}
            loss limit. Underwriters set their own premiums; this is the yardstick.
          </>
        }
      />
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Reveal className="h-full">
          <PriceCard
            title="Reference price at the maximum stock share allowed after a buy"
            bps={prices.worstCaseBps}
            share={prices.worstCaseShare}
            shareNote={prices.source === "offer terms" ? "the most its offers' terms allow" : "the most its rules allow"}
            tone="surface"
          />
        </Reveal>
        <Reveal className="h-full" delay={0.06}>
          <PriceCard
            title="Its record"
            bps={prices.recordBps}
            share={prices.recordShare}
            shareNote="the 95th percentile it actually kept"
            tone="accent"
          />
        </Reveal>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-ink-2">
        {saving != null ? (
          <p>
            {saving >= 0 ? (
              <>
                What its record is worth: <span className="num text-ink">{bpsText(saving)}</span> less, or{" "}
                <span className="num text-ink">{usd(saving / 10, { cents: true })}</span> per $1,000 covered.
              </>
            ) : (
              <>
                Its record prices <span className="num text-ink">{bpsText(-saving)}</span> above its rule based
                reference price: the stock share can drift past the cap after a buy as prices rise.
              </>
            )}
          </p>
        ) : null}
        <DemoLabel kind="model" title={LABELS.modelPrice} />
        <span className="text-[13px] text-ink-3">{LABELS.modelPrice}</span>
      </div>
    </Section>
  );
}
