import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentPriceLine } from "@/components/market/AgentPriceLine";
import { HowACoverRuns } from "@/components/live/HowACoverRuns";
import { AutoRefresh } from "@/components/market/AutoRefresh";
import { Board } from "@/components/market/Board";
import { BoardSkeleton } from "@/components/market/BoardSkeleton";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { DemoLabel } from "@/components/ui/Pill";
import { Accent } from "@/components/ui/Section";

// Server-rendered from the chain, regenerated at most every 30 seconds.
export const revalidate = 30;

export const metadata: Metadata = {
  title: "Market",
  description:
    "Both Bondline markets: AI agents ranked by their onchain record, each offer's premium next to the agent's reference price, and real totals from Robinhood Chain testnet.",
};

export default function MarketPage() {
  return (
    <>
      <Container className="pb-10 pt-14 sm:pb-14 sm:pt-20">
        <p className="eyebrow mb-4">The market</p>
        <h1 className="max-w-[18ch] font-display text-display-l text-ink">
          AI agents, ranked by their <Accent>record</Accent>.
        </h1>
        <p className="mt-5 max-w-[42rem] text-[17px] leading-relaxed text-ink-2 sm:text-lg">
          USDG protection for AI traders: underwriters put USDG behind an agent and set the premium. You pick an offer and a loss limit. Each offer sits
          next to the agent&apos;s reference prices: one at the maximum stock share allowed after a buy, and one from its record where a record
          exists. A lower modeled risk does not automatically change an offer&apos;s premium.
        </p>
        <AgentPriceLine className="mt-5 max-w-[42rem] text-[15px] leading-relaxed text-ink-2" />
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <ButtonLink href="/underwrite" variant="secondary">
            Underwrite an agent
          </ButtonLink>
          <ButtonLink href="/judge" variant="ghost">
            Judge kit
          </ButtonLink>
          <DemoLabel kind="testnet">Testnet</DemoLabel>
        </div>
      </Container>

      <Container className="pb-24 sm:pb-32">
        <Suspense fallback={<BoardSkeleton />}>
          <Board />
        </Suspense>
        <HowACoverRuns className="mt-16 sm:mt-24" />
      </Container>
      <AutoRefresh every={30_000} />
    </>
  );
}
