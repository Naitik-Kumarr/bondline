import type { Metadata } from "next";
import { AutoRefresh } from "@/components/market/AutoRefresh";
import { Countdown } from "@/components/live/Countdown";
import { CoverList } from "@/components/live/CoverList";
import { HowACoverRuns } from "@/components/live/HowACoverRuns";
import { readMarket } from "@/components/live/data";
import { FeedPanel, MarketFigures } from "@/components/live/Panels";
import { utcTime } from "@/components/market/fmt";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { AlertIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { Accent, Section, SectionHeader } from "@/components/ui/Section";
import { equitiesOpen, nextWeeklyRestart } from "@/lib/equities";

// Server-rendered from the chain, regenerated at most every 30 seconds.
export const revalidate = 30;

export const metadata: Metadata = {
  title: "Live market",
  description:
    "The Live market on Robinhood Chain testnet: a countdown to Chainlink's Monday restart of TSLA and AMZN prices, and every cover's health against its limit, read from the chain.",
};

const IST = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default async function LivePage() {
  const nowMs = Date.now();
  const open = equitiesOpen(nowMs);
  const restart = Math.floor(nextWeeklyRestart(nowMs) / 1000);
  const read = await readMarket("live");

  return (
    <>
      <Container className="pb-8 pt-14 sm:pb-10 sm:pt-20">
        <p className="eyebrow mb-4">Live market</p>
        <h1 className="max-w-[18ch] font-display text-display-l text-ink">
          Until the markets <Accent>reopen</Accent>.
        </h1>
        <p className="mt-5 max-w-[44rem] text-[17px] leading-relaxed text-ink-2 sm:text-lg">
          US stocks trade 24 hours a day, five days a week, on Chainlink&apos;s feeds on Robinhood Chain. Over the weekend
          they pause. Our keeper mirrors the last price onto testnet, so settles and withdrawals on the Live market wait
          until prices move again.
        </p>
      </Container>

      <Container className="pb-10 sm:pb-14">
        <Card padding="lg" tone="accent">
          <div className="flex flex-wrap items-center gap-3">
            <p className="eyebrow">{open ? "Chainlink's feeds are trading" : "Chainlink's feeds restart in"}</p>
            <Pill size="sm" tone="accent" dot title="Chainlink's TSLA and AMZN prices on Robinhood Chain mainnet, mirrored by our keeper.">
              Real Chainlink prices
            </Pill>
          </div>
          <div className="mt-6">
            {open ? (
              <p className="font-display text-display-s text-ink">Prices are updating. The next pause is Friday 20:00 New York time.</p>
            ) : (
              <Countdown target={restart} doneLabel="The feeds have restarted. The first fresh price is on its way." />
            )}
          </div>
          {open ? null : (
            <p className="mt-6 text-[14px] leading-relaxed text-ink-2">
              Sunday 20:00 New York time. That is{" "}
              <span className="num text-ink">{utcTime(restart, { seconds: false })}</span>, or{" "}
              <span className="num text-ink">{IST.format(new Date(restart * 1000))} IST</span>.
            </p>
          )}
        </Card>
      </Container>

      <Container className="pb-12 sm:pb-16">
        {read.ok ? (
          <div className="flex flex-col gap-4">
            <MarketFigures view={read.view} />
            <FeedPanel
              view={read.view}
              note="Our keeper pushes Chainlink's mainnet prices onto testnet. It is team operated."
            />
          </div>
        ) : (
          <Card tone="sunken" className="flex items-start gap-3" role="alert">
            <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
            <div>
              <p className="font-medium text-ink">Couldn&apos;t read Robinhood Chain testnet just now.</p>
              <p className="mt-1 text-[14px] text-ink-2">Nothing is shown rather than a guess. This page retries every 30 seconds.</p>
              <p className="num mt-3 break-words text-[12px] text-ink-3">{read.error.slice(0, 240)}</p>
            </div>
          </Card>
        )}
      </Container>

      <Section spacing="sm" aria-labelledby="covers">
        <SectionHeader
          eyebrow="Onchain"
          title={<span id="covers">Every cover on the Live market</span>}
          size="m"
          lead="Health is the cover's own view: how far the loss has come toward its limit, whether its prices are fresh, and whether it is past the limit. Anyone can settle a cover that is past its limit once its prices are fresh."
        />
        <div className="mt-8">
          {read.ok ? (
            <CoverList rows={read.view.rows} empty="No covers on the Live market yet." />
          ) : null}
        </div>
      </Section>

      <Section spacing="sm" aria-labelledby="runs" className="pb-24 sm:pb-32">
        <SectionHeader eyebrow="How a cover runs" title={<span id="runs">What you are buying</span>} size="m" />
        <HowACoverRuns className="mt-8" />
      </Section>
      <AutoRefresh every={30_000} />
    </>
  );
}
