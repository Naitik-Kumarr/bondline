import type { AgentPrices } from "@/components/market/data";
import { OfferRow } from "@/components/market/OfferRow";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeader } from "@/components/ui/Section";
import type { OfferView } from "@/lib/bondline/book";

/** Every offer behind this agent, in both markets, live from the chain. */
export function BackingOffers({
  offers,
  prices,
  name,
  error,
}: {
  offers: OfferView[];
  prices: AgentPrices;
  name: string;
  error?: string | null;
}) {
  return (
    <Section spacing="sm" aria-labelledby="offers" className="pb-24 sm:pb-32">
      <SectionHeader
        eyebrow="The offers"
        title={<span id="offers">Who backs {name}</span>}
        size="m"
        lead="Each offer is one underwriter's USDG bond behind this agent: a premium, a limit range and the free bond left to sell."
      />
      {error ? (
        <p className="mt-8 text-[15px] text-ink-2">Couldn&apos;t read the offers from the chain just now. This page retries every 30 seconds.</p>
      ) : offers.length === 0 ? (
        <div className="mt-8 flex flex-col items-start gap-4 rounded-card-lg border border-dashed border-line-strong p-6 sm:p-8">
          <p className="text-[15px] text-ink-2">No offers behind {name} yet.</p>
          <ButtonLink href="/underwrite" variant="secondary" size="sm">
            Underwrite an agent
          </ButtonLink>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {offers.map((o, i) => (
            <Reveal key={o.cover} delay={i * 0.05} className="h-full">
              <OfferRow offer={o} prices={prices} showMarket className="h-full rounded-card-lg shadow-soft" />
            </Reveal>
          ))}
        </div>
      )}
    </Section>
  );
}
