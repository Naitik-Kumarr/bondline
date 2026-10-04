import { LABELS } from "@bondline/shared/constants";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ReceiptsSkeleton } from "@/components/agent/AgentSkeleton";
import { BacktestSection } from "@/components/judge/Backtest";
import { CantTable } from "@/components/judge/CantTable";
import { deployedContracts, verifiedOnExplorer } from "@/components/judge/contracts";
import { Criteria } from "@/components/judge/Criteria";
import { MomentsSection } from "@/components/judge/MomentsSection";
import { Quality } from "@/components/judge/Quality";
import { ProofsSection } from "@/components/judge/Proofs";
import { QuickLinks } from "@/components/judge/QuickLinks";
import { RealVsDemo } from "@/components/judge/RealVsDemo";
import { readReports } from "@/components/judge/reports";
import { TourButton } from "@/components/tour/TourButton";
import { WorkedExample } from "@/components/judge/WorkedExample";
import { getBook } from "@/components/market/data";
import { Container } from "@/components/ui/Container";
import { DemoLabel } from "@/components/ui/Pill";
import { Accent, Section, SectionHeader } from "@/components/ui/Section";
import gapDemo from "@/data/gap-demo.json";

// The reports are read when the page is built; the chain parts regenerate at most every minute.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Judge kit",
  description:
    "Bondline's judge kit: every criterion with its proof, the worked example with the contract formula, each on-chain moment with its transaction, what nobody can do, and what's real versus demo.",
};

export default async function JudgePage() {
  const reports = readReports();
  const contracts = deployedContracts();
  const [verified, read] = await Promise.all([verifiedOnExplorer(contracts.map((c) => c.address)), getBook()]);
  const known = [...verified.values()].filter((v) => v !== null);
  const people = read.ok ? { underwriters: read.book.totals.underwriters, buyers: read.book.totals.buyers } : null;

  return (
    <>
      <Container className="pb-6 pt-10 sm:pt-14">
        <TourButton className="mb-10 sm:mb-12" />
        <p className="eyebrow mb-4">Judge kit</p>
        <h1 className="max-w-[17ch] font-display text-display-l text-ink">
          Every claim, with its <Accent>proof</Accent>.
        </h1>
        <p className="mt-6 max-w-[44rem] font-display text-[24px] leading-[1.25] tracking-[-0.015em] text-ink-2 sm:text-[28px]">
          The agent bonds we&apos;ve seen pay when an agent breaks a rule. Ours can&apos;t place a trade that breaks its
          rules; Bondline pays when the market breaks through your limit.
        </p>
        <p className="mt-6 max-w-[44rem] text-[14px] leading-relaxed text-ink-3">
          {LABELS.testnet} {LABELS.notInsurance} {LABELS.independent}
        </p>
        <div className="mt-8">
          <QuickLinks />
        </div>
      </Container>

      <Section spacing="sm" aria-labelledby="criteria">
        <SectionHeader eyebrow="The criteria" title={<span id="criteria">Each criterion, and where to check it</span>} size="m" />
        <div className="mt-8">
          <Criteria
            data={{
              reports,
              verified: { total: contracts.length, verified: known.filter(Boolean).length, known: known.length },
              people,
            }}
          />
        </div>
      </Section>

      <Section spacing="sm" aria-labelledby="example" id="example" className="scroll-mt-24">
        <SectionHeader
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-3">
              The worked example <DemoLabel kind="illustration" />
            </span>
          }
          title={<span id="example-title">What the cover pays, in round numbers</span>}
          size="m"
          lead={
            gapDemo.status === "real" && gapDemo.settleTx
              ? "An illustration of the contract's formula, not a transaction. The real claim on-chain is smaller, because testnet USDG comes from Paxos's faucet at 100 per wallet per day: it's the last of the on-chain moments below."
              : "An illustration of the contract's formula, not a transaction. The real claim will be smaller, because testnet USDG comes from Paxos's faucet at 100 per wallet per day. It will be the last of the on-chain moments below once the scripted gap settles."
          }
        />
        <div className="mt-8">
          <WorkedExample />
        </div>
      </Section>

      <Section spacing="sm" aria-labelledby="moments-title" id="moments" className="scroll-mt-24">
        <SectionHeader
          eyebrow="On-chain"
          title={<span id="moments-title">The moments, each with its transaction</span>}
          size="m"
          lead="Found in the chain's events when this page was rendered, not typed in, with the real numbers. Verify re-hashes an AI decision in your browser."
        />
        <div className="mt-8">
          <Suspense fallback={<ReceiptsSkeleton rows={5} />}>
            <MomentsSection />
          </Suspense>
        </div>
      </Section>

      <Section spacing="sm" aria-labelledby="cant">
        <SectionHeader
          eyebrow="By construction"
          title={<span id="cant">What nobody can do</span>}
          size="m"
          lead="Enforced by the contracts, and checked by named tests in contracts/test."
        />
        <div className="mt-8">
          <CantTable testNames={reports.tests?.names ?? null} />
        </div>
      </Section>

      <BacktestSection />

      <ProofsSection />

      <Section spacing="sm" aria-labelledby="real">
        <SectionHeader eyebrow="Honesty" title={<span id="real">What&apos;s real, and what&apos;s demo</span>} size="m" />
        <div className="mt-8">
          <RealVsDemo />
        </div>
      </Section>

      <Section spacing="sm" aria-labelledby="quality-title" id="quality" className="scroll-mt-24 pb-24 sm:pb-32">
        <SectionHeader
          eyebrow="Contract quality"
          title={<span id="quality-title">Tests, coverage, Slither, gas</span>}
          size="m"
          lead="Read from contracts/reports and contracts/test when this page was built."
        />
        <div className="mt-8">
          <Quality reports={reports} contracts={contracts} verified={verified} />
        </div>
      </Section>
    </>
  );
}
