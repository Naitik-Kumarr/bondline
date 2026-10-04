import { Card } from "@/components/ui/Card";
import { AFTER_SETTLEMENT, HOW_A_COVER_RUNS } from "./copy";

/** How a cover runs, and what a settle does. The same words on /market, /cover and /live (see copy.ts). */
export function HowACoverRuns({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card compact>
          <p className="eyebrow mb-3">How a cover runs</p>
          <ul className="space-y-2.5 text-[14.5px] leading-relaxed text-ink-2">
            {HOW_A_COVER_RUNS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>
        <Card compact tone="bond">
          <p className="eyebrow mb-3">When it pays</p>
          <p className="text-[14.5px] leading-relaxed text-ink-2">{AFTER_SETTLEMENT}</p>
        </Card>
      </div>
    </div>
  );
}
