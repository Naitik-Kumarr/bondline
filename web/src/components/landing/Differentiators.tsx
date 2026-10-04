import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";

const LINES = [
  {
    lead: "A market, not a self-bond:",
    rest: "independent underwriters choose agents, set prices and earn premiums.",
  },
  {
    lead: "It pays market losses,",
    rest: "not only agent failures or rule breaches.",
  },
  {
    lead: "Every cover is fully backed:",
    rest: "the contract refuses a deposit unless the free bond already covers its worst case, and payouts are capped at a 30% drop.",
  },
  {
    lead: "It's real:",
    rest: "Paxos USDG, Robinhood's official testnet Stock Tokens, Chainlink prices, and an on-chain receipt for every completed trade and rule refusal.",
  },
] as const;

export function Differentiators() {
  return (
    <Section spacing="md" aria-labelledby="apart" className="pt-0 sm:pt-0">
      <div className="grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
        <Reveal>
          <p className="eyebrow mb-4">Why it&apos;s different</p>
          <h2 id="apart" className="font-display text-display-m text-ink">
            What sets it apart
          </h2>
        </Reveal>
        <ol className="border-t border-line">
          {LINES.map((line, i) => (
            <Reveal as="li" key={line.lead} delay={i * 0.05} className="flex gap-5 border-b border-line py-6 sm:gap-8 sm:py-7">
              <span className="num pt-1 text-[12px] text-ink-3">0{i + 1}</span>
              <p className="text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">
                <strong className="font-medium text-ink">{line.lead}</strong> {line.rest}
              </p>
            </Reveal>
          ))}
        </ol>
      </div>
    </Section>
  );
}
