import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";

export function ClosingCta() {
  return (
    <Section spacing="md" aria-labelledby="cta" className="pb-24 sm:pb-32">
      <Reveal>
        <Card padding="lg" className="overflow-hidden text-center">
          <div aria-hidden="true" className="glow-hero pointer-events-none absolute inset-0 opacity-80" />
          <div
            aria-hidden="true"
            className="texture-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(60%_70%_at_50%_0%,#000,transparent)]"
          />
          <div className="relative py-6 sm:py-10">
            <h2 id="cta" className="mx-auto max-w-[18ch] font-display text-display-l text-ink">
              See it onchain.
            </h2>
            <p className="mx-auto mt-5 max-w-[34rem] text-[17px] leading-relaxed text-ink-2">
              Every bond, cover and claim is a transaction on Robinhood Chain testnet. Submitted trades that complete
              emit a trade or rule check refusal receipt; offchain holds and decisions never submitted are absent.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/market" size="lg" iconRight={<ArrowRightIcon size={16} />}>
                Open the market
              </ButtonLink>
              <ButtonLink href="/underwrite" size="lg" variant="secondary">
                Underwrite
              </ButtonLink>
              <ButtonLink href="/cover" size="lg" variant="secondary">
                Get cover
              </ButtonLink>
              <ButtonLink href="/judge" size="lg" variant="secondary">
                Judge kit
              </ButtonLink>
            </div>
          </div>
        </Card>
      </Reveal>
    </Section>
  );
}
