import { deployment, RECORDS_INDEX } from "@bondline/shared";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getAddress, isAddress } from "viem";
import { AgentHeader } from "@/components/agent/AgentHeader";
import { AgentPricesSection } from "@/components/agent/AgentPrices";
import { ReceiptsSkeleton } from "@/components/agent/AgentSkeleton";
import { BackingOffers } from "@/components/agent/BackingOffers";
import { ExposureLoader } from "@/components/agent/ExposureLoader";
import { NoRecord, NotAnAddress } from "@/components/agent/NoRecord";
import { PricingModel } from "@/components/agent/PricingModel";
import { Receipts } from "@/components/agent/Receipts";
import { RecordSection } from "@/components/agent/RecordSection";
import { StylusPriceSection } from "@/components/agent/StylusPrice";
import { RulesList } from "@/components/agent/RulesList";
import { ScoreBreakdown } from "@/components/agent/ScoreBreakdown";
import { AutoRefresh } from "@/components/market/AutoRefresh";
import { agentName, agentPrices, getBook, loadRecord } from "@/components/market/data";
import { Section, SectionHeader } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";

// Server-rendered from the chain and the agent's record, regenerated at most every 30 seconds.
export const revalidate = 30;
export const dynamicParams = true;

type Params = Promise<{ address: string }>;

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Prebuild the agents with a record and the two team agents; any other address renders on demand. */
export function generateStaticParams() {
  const set = new Set<string>(RECORDS_INDEX.agents.map((a) => getAddress(a.agent)));
  for (const role of ["careful", "bold"] as const) {
    const a = deployment.wallets[role];
    if (a) set.add(getAddress(a));
  }
  return [...set].map((address) => ({ address }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) return { title: "Agent" };
  const name = agentName(address);
  return {
    title: `${name}'s record`,
    description: `${name} on Bondline: completed trade and refusal receipts with the submitted decision bytes, its score, and reference prices for cover from its rules and, where a record exists, from its record.`,
  };
}

export default async function AgentPage({ params }: { params: Params }) {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) return <NotAnAddress value={safeDecode(address)} />;
  const agent = getAddress(address);

  const [record, read] = await Promise.all([loadRecord(agent), getBook()]);
  const offers = read.ok ? read.book.offers.filter((o) => o.agent.toLowerCase() === agent.toLowerCase()) : [];
  const accounts = read.ok
    ? offers.flatMap((o) => o.accounts.map((a) => ({ address: a.address, market: a.market })))
    : (record?.accounts ?? []).map((a) => ({ address: a.account, market: a.market }));
  const name = agentName(agent, offers);
  const prices = agentPrices(agent, offers);
  const hasRecord = Boolean(record?.hasRecord);
  const known = hasRecord || offers.length > 0 || Boolean(record);

  return (
    <>
      <AgentHeader
        agent={agent}
        name={name}
        record={record}
        rulesMax={prices.worstCaseShare}
        known={known}
      />

      {prices.worstCaseBps != null ? <AgentPricesSection prices={prices} name={name} /> : null}

      {hasRecord && record ? (
        <>
          <RecordSection
            record={record}
            chart={
              <Suspense fallback={<Skeleton className="h-[180px] w-full" rounded="md" />}>
                <ExposureLoader accounts={accounts} cap={prices.worstCaseShare} p95={record.exposure.p95} />
              </Suspense>
            }
            rules={
              <Suspense fallback={<Skeleton className="h-60 w-full" rounded="md" />}>
                <RulesList accounts={accounts} />
              </Suspense>
            }
          />
          <ScoreBreakdown record={record} />
        </>
      ) : (
        <NoRecord name={name} prices={prices} hasOffers={offers.length > 0} />
      )}

      <PricingModel prices={prices} />

      <Suspense fallback={null}>
        <StylusPriceSection prices={prices} />
      </Suspense>

      {accounts.length > 0 ? (
        <Section spacing="sm" aria-labelledby="receipts">
          <SectionHeader
            eyebrow="Receipts"
            title={<span id="receipts">Latest trades and refusals</span>}
            size="m"
            lead="With the AI's reasoning, decoded from each transaction's input. Verify rehashes it in your browser and checks it against the hash in the onchain event."
          />
          <div className="mt-8">
            <Suspense fallback={<ReceiptsSkeleton />}>
              <Receipts accounts={accounts} record={record} name={name} />
            </Suspense>
          </div>
        </Section>
      ) : null}

      {known || !read.ok ? (
        <BackingOffers offers={offers} prices={prices} name={name} error={read.ok ? null : read.error} />
      ) : (
        <div className="pb-16 sm:pb-24" />
      )}
      <AutoRefresh every={30_000} />
    </>
  );
}
