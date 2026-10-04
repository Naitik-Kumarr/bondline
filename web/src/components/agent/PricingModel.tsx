import { LABELS } from "@bondline/shared/constants";
import { PRICING_MODEL, priceCover, VOLATILITY, type PriceBreakdown } from "@bondline/shared/pricing";
import type { ReactNode } from "react";
import type { AgentPrices } from "@/components/market/data";
import { bpsPct, bpsText, int, modelPct, pct } from "@/components/market/fmt";
import { Card } from "@/components/ui/Card";
import { DemoLabel } from "@/components/ui/Pill";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeader } from "@/components/ui/Section";

const FORMULA: [string, string][] = [
  ["w", "share of the account in stocks"],
  ["σ", "annual volatility of the most volatile allowed stock"],
  ["σa", "w × σ"],
  ["T", "the term in years (30 days on the board)"],
  ["L", "limit;  band = cap − L;  cap = 30%"],
  ["P", "min(1, 2 × N(−L / (σa × √T)))"],
  ["gap", "min(band, 0.5826 × σa × √g)"],
  ["fair", "2 × P × gap  +  band × r × T"],
];

/** A formula as aligned rows: the name, then "= definition". Wraps on narrow screens instead of scrolling. */
export function FormulaRows({ rows, nameWidth = "3rem", className }: { rows: [string, string][]; nameWidth?: string; className?: string }) {
  return (
    <dl
      className={`num grid gap-x-3 gap-y-1.5 text-[12px] leading-relaxed sm:text-[12.5px] ${className ?? ""}`}
      style={{ gridTemplateColumns: `${nameWidth} minmax(0, 1fr)` }}
    >
      {rows.map(([name, def], i) => (
        <div key={i} className="contents">
          <dt className="text-ink">{name}</dt>
          <dd className="text-ink-2">
            {def ? <span className="text-ink-3">= </span> : null}
            {def}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const dateText = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

function Row({ label, note, worst, record }: { label: ReactNode; note?: ReactNode; worst: ReactNode; record: ReactNode }) {
  return (
    <tr className="border-t border-line align-top">
      <th scope="row" className="py-3.5 pr-6 text-left font-normal">
        <span className="num text-[13.5px] text-ink">{label}</span>
        {note ? <span className="mt-1 block max-w-[34rem] text-[12px] leading-snug text-ink-3">{note}</span> : null}
      </th>
      <td className="num whitespace-nowrap py-3.5 pr-4 text-right text-[13.5px] text-ink">{worst}</td>
      <td className="num whitespace-nowrap py-3.5 text-right text-[13.5px] text-accent-ink">{record}</td>
    </tr>
  );
}

/** The published model, its inputs (σ with its source and window) and both prices, step by step. */
export function PricingModel({ prices }: { prices: AgentPrices }) {
  if (prices.worstCaseShare == null) return null;
  const limit = prices.limitBps / 10_000;
  const run = (w: number | null): PriceBreakdown | null =>
    w == null ? null : priceCover({ stockShare: w, sigma: prices.sigma, limit, termDays: prices.termDays });
  const worst = run(prices.worstCaseShare)!;
  const record = run(prices.recordShare);
  const vol = VOLATILITY.assets[prices.sigmaAsset];
  const dash = <span className="text-ink-4">–</span>;
  const both = (f: (b: PriceBreakdown) => ReactNode) => ({ worst: f(worst), record: record ? f(record) : dash });

  return (
    <Section spacing="sm" aria-labelledby="model">
      <SectionHeader
        eyebrow="The pricing model"
        title={<span id="model">How the two prices are computed</span>}
        size="m"
        lead={
          <>
            {LABELS.modelPrice} It prices the gap: the loss a price jump carries past the limit, where no stop-loss can
            sell, plus the cost of keeping the bond&apos;s reserve locked.
          </>
        }
      />
      <div className="mt-8 flex flex-col gap-4">
        <Reveal>
          <Card tone="sunken" className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-10">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">The formula</p>
                <DemoLabel kind="model" title={LABELS.modelPrice} />
              </div>
              <FormulaRows rows={FORMULA} className="mt-4" />
            </div>
            <ul className="flex flex-col gap-3 text-[13.5px] leading-relaxed text-ink-3 md:pt-9">
              <li>
                <span className="num text-ink-2">N</span>: the normal CDF. <span className="num text-ink-2">P</span> is
                the chance the account touches its limit within the term, with zero drift.
              </li>
              <li>
                <span className="num text-ink-2">g = 1.5/252</span>: the variance of one weekend gap, about 1.5 trading
                days. A stated assumption.
              </li>
              <li>
                <span className="num text-ink-2">0.5826</span>: the overshoot constant of a Gaussian random walk
                (Siegmund; Broadie, Glasserman and Kou).
              </li>
              <li>
                <span className="num text-ink-2">×{PRICING_MODEL.loading}</span>: a stated loading for fat tails.{" "}
                <span className="num text-ink-2">r = {pct(PRICING_MODEL.reserveRate, 0)}</span> a year: the stated cost
                of the locked reserve.
              </li>
            </ul>
          </Card>
        </Reveal>

        <Reveal delay={0.06}>
          <Card>
            <div className="overflow-x-auto" data-lenis-prevent="">
              <table className="w-full border-collapse">
                <caption className="sr-only">The model&apos;s inputs and steps for both reference prices</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pb-3 text-left text-[12.5px] font-normal text-ink-3">
                      Input or step
                    </th>
                    <th scope="col" className="whitespace-nowrap pb-3 pr-4 text-right text-[12.5px] font-normal text-ink-3">
                      Max share
                    </th>
                    <th scope="col" className="whitespace-nowrap pb-3 text-right text-[12.5px] font-normal text-accent-ink">
                      Its record
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <Row
                    label="w"
                    note="Max share: the maximum stock share allowed after a buy. Record: the 95th percentile it kept."
                    worst={pct(prices.worstCaseShare)}
                    record={prices.recordShare != null ? pct(prices.recordShare) : dash}
                  />
                  <Row
                    label={`σ (${prices.sigmaAsset})`}
                    note={
                      <>
                        Chainlink {vol.description} on Robinhood Chain mainnet, {dateText(vol.window.from)} to{" "}
                        {dateText(vol.window.to)}: <span className="num">{int(vol.window.returns)}</span> daily returns,
                        annualised with √252. 95% range <span className="num">{pct(vol.ci95[0])}</span> to{" "}
                        <span className="num">{pct(vol.ci95[1])}</span>. Feed{" "}
                        <span className="num break-all">{vol.feed}</span>.
                      </>
                    }
                    worst={pct(prices.sigma, 2)}
                    record={record ? pct(prices.sigma, 2) : dash}
                  />
                  <Row label="σa = w × σ" {...both((b) => pct(b.sigmaAccount, 2))} />
                  <Row
                    label="T"
                    note={`${prices.termDays} days of cover, as the board quotes`}
                    {...both((b) => b.inputs.termYears.toFixed(4))}
                  />
                  <Row
                    label="L, band"
                    note={`limit, and cap − limit (cap ${bpsPct(PRICING_MODEL.cap * 10_000)})`}
                    {...both((b) => `${pct(b.inputs.limit, 0)}, ${pct(b.band, 0)}`)}
                  />
                  <Row label="L ÷ (σa √T)" {...both((b) => (Number.isFinite(b.distance) ? b.distance.toFixed(3) : "∞"))} />
                  <Row label="P" note="chance to touch the limit in the term" {...both((b) => pct(b.pTouch, 2))} />
                  <Row label="gap" note="expected overshoot past the limit" {...both((b) => bpsText(b.bps.gap))} />
                  <Row label="2 × P × gap" note="the risk part" {...both((b) => bpsText(b.bps.riskPart))} />
                  <Row label="band × r × T" note="the reserve part" {...both((b) => bpsText(b.bps.reservePart))} />
                  <tr className="border-t border-line-strong">
                    <th scope="row" className="pt-4 text-left text-[14px] font-medium text-ink">
                      fair
                    </th>
                    <td className="num whitespace-nowrap pt-4 pr-4 text-right text-[15px] text-ink">
                      {bpsText(worst.bps.fair)}
                      <span className="block text-[12px] text-ink-3">{modelPct(worst.bps.fair)}</span>
                    </td>
                    <td className="num whitespace-nowrap pt-4 text-right text-[15px] text-accent-ink">
                      {record ? (
                        <>
                          {bpsText(record.bps.fair)}
                          <span className="block text-[12px] text-ink-3">{modelPct(record.bps.fair)}</span>
                        </>
                      ) : (
                        dash
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </Reveal>
      </div>
    </Section>
  );
}
