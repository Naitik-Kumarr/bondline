import { LABELS } from "@bondline/shared/constants";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import type { AgentPrices } from "./data";
import { bpsPct, modelPct, pct } from "./fmt";

/** The agent's reference prices as pills: at the maximum stock share allowed after a buy, and its record. */
export function PricePills({ prices, className }: { prices: AgentPrices; className?: string }) {
  if (prices.worstCaseBps == null) {
    return <p className={cn("text-[13px] text-ink-3", className)}>No reference price yet: no rules seen onchain.</p>;
  }
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Pill
        tone="neutral"
        title={`Reference price at the maximum stock share allowed after a buy: the model at ${pct(prices.worstCaseShare ?? 0, 0)} in stocks`}
      >
        Max stock share after a buy
        <span className="num text-ink">{modelPct(prices.worstCaseBps)}</span>
      </Pill>
      {prices.recordBps != null ? (
        <Pill
          tone="accent"
          title={`Its record: the model at ${pct(prices.recordShare ?? 0)} in stocks, the 95th percentile it kept`}
        >
          Its record
          <span className="num">{modelPct(prices.recordBps)}</span>
        </Pill>
      ) : (
        <Pill tone="neutral" className="text-ink-3" title="No trades yet, so no record price: only the rule based reference price applies">
          No record yet
        </Pill>
      )}
    </div>
  );
}

/** "Reference price · 10% limit, 30 days" with the model label. */
export function PriceCaption({ prices, className }: { prices: AgentPrices; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5", className)}>
      <span className="text-[12.5px] text-ink-3">
        Reference price · <span className="num">{bpsPct(prices.limitBps)}</span> limit,{" "}
        <span className="num">{prices.termDays}</span> days
      </span>
      <DemoLabel kind="model" title={LABELS.modelPrice} />
    </div>
  );
}
