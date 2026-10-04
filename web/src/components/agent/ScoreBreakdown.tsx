import { HISTORY_FULL_CREDIT, SCORE_POINTS, type AgentRecord } from "@bondline/shared/record";
import { int } from "@/components/market/fmt";
import { FormulaRows } from "./PricingModel";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeader } from "@/components/ui/Section";

const P = SCORE_POINTS;
const FORMULA: [string, string][] = [
  ["score", "exposure + drawdown + claims + history, rounded"],
  ["exposure", `${P.exposure} × (1 − p95 share ÷ rules' max share)`],
  ["drawdown", `${P.drawdown} × (1 − worst drawdown ÷ its limit)`],
  ["claims", `${P.claims} × (1 − accounts with a claim ÷ accounts)`],
  ["history", `${P.history} × min(1, on-chain decisions ÷ ${HISTORY_FULL_CREDIT})`],
];

/** The 0–100 display score, part by part, with the published formula. */
export function ScoreBreakdown({ record }: { record: AgentRecord }) {
  const { score } = record;
  return (
    <Section spacing="sm" aria-labelledby="score">
      <SectionHeader
        eyebrow="The score"
        title={<span id="score">Part by part</span>}
        size="m"
        lead="Exposure is judged against the agent's own rules, so a careful agent and a bold one are each scored on how much of their allowance they use. The absolute risk is in the prices, not the score."
      />
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
        <Reveal className="h-full">
          <Card className="h-full">
            <ul className="flex flex-col gap-6">
              {score.parts.map((p) => (
                <li key={p.key}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[15px] font-medium text-ink">{p.label}</span>
                    <span className="num shrink-0 text-[15px] text-ink">
                      {p.points.toFixed(1)} <span className="text-ink-3">/ {p.max}</span>
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={`${p.label}: ${p.points.toFixed(1)} of ${p.max} points`}
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent-soft"
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(Math.max(0, Math.min(1, p.points / p.max)) * 100).toFixed(2)}%` }} />
                  </div>
                  <p className="mt-2 text-[13px] text-ink-3">{p.detail}</p>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex items-baseline justify-between border-t border-line pt-5">
              <span className="text-[15px] font-medium text-ink">Score</span>
              <span className="num text-[22px] text-ink">
                {score.value != null ? int(score.value) : "–"} <span className="text-[15px] text-ink-3">/ 100</span>
              </span>
            </div>
          </Card>
        </Reveal>
        <Reveal className="h-full" delay={0.06}>
          <Card tone="sunken" className="flex h-full flex-col">
            <p className="eyebrow">The formula</p>
            <FormulaRows rows={FORMULA} nameWidth="4.75rem" className="mt-4" />
            <p className="mt-auto pt-6 text-[13px] leading-relaxed text-ink-3">
              Each part is clamped between 0 and its maximum. Decisions are trades plus refusals. An agent with no
              trades has no record: no score and no record price. The score is for display only and doesn&apos;t set
              any price.
            </p>
          </Card>
        </Reveal>
      </div>
    </Section>
  );
}
