import { LABELS } from "@bondline/shared/constants";
import { Suspense } from "react";
import { MarketProof } from "@/components/landing/MarketProof";
import { GapReplay } from "@/components/hero/GapReplay";
import { TourButton } from "@/components/tour/TourButton";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Pill } from "@/components/ui/Pill";
import { Accent } from "@/components/ui/Section";

/** The scripted gap claim's settle transaction on the testnet explorer. */
const CLAIM_TX = "https://explorer.testnet.chain.robinhood.com/tx/0xbace67dfa4f25b92eca2f0b2806dc5cf6c9d802608aeee6622fff59cc296087c";

export function Hero() {
  return (
    <section className="relative pb-20 sm:pb-28">
      {/* Soft periwinkle glow and our dot grid, both static */}
      <div aria-hidden="true" className="glow-hero pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[56rem]" />
      <div
        aria-hidden="true"
        className="texture-dots pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[46rem] [mask-image:radial-gradient(56%_62%_at_50%_34%,#000_20%,transparent_100%)]"
      />

      <Container className="pt-10 text-center sm:pt-14">
        <div>
          <Pill dot tone="neutral" className="bg-surface/80">
            USDG protection for AI traders
          </Pill>
        </div>
        <h1 className="mx-auto mt-6 max-w-[15ch] font-display text-display-xl text-ink sm:mt-7">
          The protection <Accent>market</Accent> for AI traders.
        </h1>
        <p className="mx-auto mt-6 max-w-[44rem] text-[17px] leading-relaxed text-ink-2 sm:mt-7 sm:text-[19px]">
          Underwriters put USDG behind AI trading agents and set the premium. You pick a loss limit. If the market
          gaps through it, the agent stops and the bond pays the loss beyond it, up to a 30% drop. Anyone can call
          settle; there&apos;s no claim form. Robinhood Chain testnet, Paxos USDG.
        </p>
        <div className="mx-auto mt-8 flex max-w-[24rem] flex-col items-stretch gap-3 sm:mt-9 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
          <TourButton className="w-full sm:w-auto" />
          <ButtonLink href={CLAIM_TX} external size="lg" variant="secondary" className="w-full sm:w-auto">
            See the claim onchain
          </ButtonLink>
        </div>
        <p className="mt-5 text-[13px] text-ink-3">
          {LABELS.testnet} {LABELS.notInsurance}
        </p>
      </Container>

      <Container>
        <Suspense fallback={<div aria-hidden="true" className="mx-auto mt-10 h-[150px] max-w-[56rem] sm:mt-12" />}>
          <MarketProof />
        </Suspense>
      </Container>

      <Container className="mt-12 sm:mt-14">
        <GapReplay />
      </Container>
    </section>
  );
}
