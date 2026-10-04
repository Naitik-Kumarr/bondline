import { deployment } from "@bondline/shared";
import { bpsPct } from "./fmt";
import { summaryOf } from "./data";

/**
 * "Careful 13 bps, Bold 175 bps": the reference price at the maximum stock share each team agent's rules allow after a buy, read from their records
 * (shared/src/records), never typed here. If the two agents' rules matched, the gap would have to come from behavior, so the
 * numbers would be the record prices instead; with rules that differ the line says so rather than call them the same.
 */
export function agentPriceLine() {
  const careful = summaryOf(deployment.wallets.careful);
  const bold = summaryOf(deployment.wallets.bold);
  if (!careful || !bold) return null;
  const sameRules = careful.rulesMax === bold.rulesMax;
  const [c, b] = sameRules ? [careful.recordBps, bold.recordBps] : [careful.worstCaseBps, bold.worstCaseBps];
  if (c == null || b == null) return null;
  return {
    headline: sameRules ? "Same rules, different behavior" : "Same market, different rules",
    careful: Math.round(c),
    bold: Math.round(b),
    basis: sameRules ? "each agent's record" : "the maximum stock share each agent's rules allow after a buy",
    limit: bpsPct(careful.limitBps),
    days: careful.termDays,
    carefulShare: careful.rulesMax,
    boldShare: bold.rulesMax,
  };
}

/** The line as a paragraph. */
export function AgentPriceLine({ className }: { className?: string }) {
  const l = agentPriceLine();
  if (!l) return null;
  return (
    <p className={className}>
      <strong className="font-medium text-ink">{l.headline}:</strong>{" "}
      <span className="num text-ink">Careful {l.careful} bps</span>, <span className="num text-ink">Bold {l.bold} bps</span>. The price of
      a cover, from {l.basis}, at a {l.limit} limit over {l.days} days.
    </p>
  );
}
