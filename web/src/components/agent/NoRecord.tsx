import type { AgentPrices } from "@/components/market/data";
import { bpsPct, modelPct } from "@/components/market/fmt";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";

/** An agent (or any address) with no trades on Bondline: no record, so only the rule-based reference price applies. */
export function NoRecord({ name, prices, hasOffers }: { name: string; prices: AgentPrices; hasOffers: boolean }) {
  return (
    <Section spacing="sm" aria-labelledby="no-record">
      <Card tone="accent" padding="lg">
        <p className="eyebrow mb-4">No record yet</p>
        <h2 id="no-record" className="max-w-[24ch] font-display text-display-m text-ink">
          No record, so only the rule-based reference price.
        </h2>
        <p className="mt-5 max-w-[42rem] text-[16px] leading-relaxed text-ink-2">
          {hasOffers ? (
            <>
              {name} hasn&apos;t traded on Bondline yet. Until it does, the model prices cover on it at the most its
              rules allow in stocks
              {prices.worstCaseBps != null ? (
                <>
                  : <span className="num text-ink">{modelPct(prices.worstCaseBps)}</span> for{" "}
                  <span className="num">{prices.termDays}</span> days at a{" "}
                  <span className="num">{bpsPct(prices.limitBps)}</span> limit
                </>
              ) : null}
              . A record of trades kept well inside those rules is what makes cover cheaper.
            </>
          ) : (
            <>
              This address has no offers and no trades on Bondline. An agent with no record has only the reference price
              at the maximum stock share allowed after a buy; an agent with no rules on-chain has no price at all.
            </>
          )}
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <ButtonLink href="/market" variant="secondary">
            Back to the market
          </ButtonLink>
          <ButtonLink href="/underwrite" variant="ghost">
            Underwrite an agent
          </ButtonLink>
        </div>
      </Card>
    </Section>
  );
}

/** /agent/<something that isn't an address>: say so plainly, never a blank page. */
export function NotAnAddress({ value }: { value: string }) {
  return (
    <Container className="pb-24 pt-14 sm:pb-32 sm:pt-20">
      <p className="eyebrow mb-4">Agent</p>
      <h1 className="max-w-[20ch] font-display text-display-l text-ink">That isn&apos;t an agent address.</h1>
      <p className="mt-5 max-w-[40rem] text-[17px] leading-relaxed text-ink-2">
        Agent pages live at <span className="num text-[15px] text-ink">/agent/0x…</span>, with the agent&apos;s 40-hex
        address. <span className="num break-all text-[15px] text-ink-3">{value.slice(0, 80)}</span> isn&apos;t one.
      </p>
      <div className="mt-8">
        <ButtonLink href="/market" variant="secondary">
          See the agents on the market
        </ButtonLink>
      </div>
    </Container>
  );
}
