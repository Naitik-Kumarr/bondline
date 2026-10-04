import { LABELS } from "@bondline/shared/constants";
import type { Metadata } from "next";
import { Accent } from "@/components/ui/Section";
import { PageIntro } from "@/components/account/kit/PageIntro";
import { HowACoverRuns } from "@/components/live/HowACoverRuns";
import { Container } from "@/components/ui/Container";
import { CoverFlow } from "@/components/cover/CoverFlow";

export const metadata: Metadata = {
  title: "Get cover",
  description:
    "Cover for an AI traded account: choose an offer, a loss limit and the agent's rules, and deposit USDG. Past your limit, anyone can call settle: it stops the agent and pays the loss beyond your limit, up to a 30% drop, if the required prices are fresh and the USDG transfer succeeds.",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CoverPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string | string[]; offer?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <div className="pb-20 sm:pb-28">
      <PageIntro
        eyebrow="Get cover"
        title={
          <>
            Cover for your <Accent>AI trader</Accent>.
          </>
        }
        lead="Choose an offer, a loss limit and the rules every trade by your agent must pass, then deposit USDG. Past your limit, anyone can call settle. It stops the agent and pays once only if the required prices are fresh and the USDG transfer succeeds: the loss beyond your limit, up to a 30% drop. There's no claim form."
        fine={`${LABELS.notInsurance} ${LABELS.testnet}`}
      />
      <Container className="mt-8">
        <HowACoverRuns />
      </Container>
      <CoverFlow initialMarket={one(params.market)} initialOffer={one(params.offer)} />
    </div>
  );
}
