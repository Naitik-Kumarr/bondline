import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";

const ROBINHOOD_URL = "https://robinhood.com/us/en/newsroom/hood-summit-2026/";
const FORTUNE_URL =
  "https://fortune.com/2025/07/23/ai-agent-insurance-startup-aiuc-stealth-15-million-seed-nat-friedman";
const DEALROOM_URL = "https://dealroom.co/news/150943-aiuc-lands-40m-series-a-to-insure-ai-agents/";

function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[13px] text-ink-2 underline decoration-ink/15 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink/50"
    >
      {children}
      <ArrowUpRightIcon size={12} />
    </a>
  );
}

/** The facts behind the problem, quoted exactly, each with its source. */
export function NewsStrip() {
  return (
    <Section spacing="md" aria-labelledby="news">
      <Reveal className="mb-10 sm:mb-12">
        <p className="eyebrow mb-4">In the news</p>
        <h2 id="news" className="max-w-[30ch] font-display text-display-m text-ink">
          AI agents already trade for people. The risk lands on the people.
        </h2>
      </Reveal>

      <div className="grid gap-4 md:grid-cols-12">
        <Reveal className="md:col-span-5">
          <Card as="figure" className="flex h-full flex-col">
            <p className="eyebrow">Robinhood · 29 Sep 2026</p>
            <blockquote className="mt-5 flex-1 font-display text-[30px] leading-[1.12] tracking-[-0.02em] text-ink sm:text-[36px]">
              &ldquo;over 150,000 customers have opened agentic trading accounts&rdquo;
            </blockquote>
            <figcaption className="mt-6">
              <Source href={ROBINHOOD_URL}>Robinhood newsroom, HOOD Summit 2026</Source>
            </figcaption>
          </Card>
        </Reveal>

        <Reveal className="md:col-span-7" delay={0.06}>
          <Card as="figure" className="flex h-full flex-col">
            <p className="eyebrow">Robinhood · the disclosure</p>
            <blockquote className="mt-5 flex-1 text-[18px] leading-relaxed text-ink sm:text-[20px]">
              &ldquo;You assume all risk for trades executed by AI agents and for any use of your data by third-party LLM
              providers. Robinhood does not control, supervise, monitor, recommend, or audit agents.&rdquo;
            </blockquote>
            <figcaption className="mt-6">
              <Source href={ROBINHOOD_URL}>Robinhood newsroom, HOOD Summit 2026</Source>
            </figcaption>
          </Card>
        </Reveal>

        <Reveal className="md:col-span-12" delay={0.1}>
          <Card tone="sunken" className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] md:items-center md:gap-10">
            <div>
              <p className="eyebrow">AIUC insures AI agents offchain</p>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                Offchain insurers evaluate agents through tests and monitoring. Bondline exposes submitted decision
                bytes and completed trade/refusal receipts publicly.
              </p>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-card bg-surface p-5 shadow-hairline">
                <dt className="text-[13px] text-ink-3">Seed · July 2025</dt>
                <dd className="num mt-1.5 text-[28px] leading-none tracking-[-0.03em] text-ink">$15M</dd>
                <dd className="mt-3">
                  <Source href={FORTUNE_URL}>Fortune</Source>
                </dd>
              </div>
              <div className="rounded-card bg-surface p-5 shadow-hairline">
                <dt className="text-[13px] text-ink-3">Series A · 15 Sep 2026 · led by Ribbit Capital</dt>
                <dd className="num mt-1.5 text-[28px] leading-none tracking-[-0.03em] text-ink">$40M</dd>
                <dd className="mt-3">
                  <Source href={DEALROOM_URL}>Dealroom</Source>
                </dd>
              </div>
            </dl>
          </Card>
        </Reveal>
      </div>

      <Reveal className="mt-12 sm:mt-14">
        <p className="mx-auto max-w-[30ch] text-center font-display text-display-s text-ink">
          Bondline is where that risk gets priced and taken.
        </p>
      </Reveal>
    </Section>
  );
}
