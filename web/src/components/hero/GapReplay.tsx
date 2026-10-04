import { txUrl } from "@bondline/shared/chain";
import { DemoLabel } from "@/components/ui/Pill";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import demoJson from "@/data/gap-demo.json";
import { cn } from "@/lib/cn";
import { formatBps, formatUsd } from "@/lib/format";
import { CAP_BPS, type GapDemo } from "./gap-geometry";
import { GapReplayPlayer } from "./GapReplayPlayer";

/**
 * The gap replay: a price line ticks across a closed weekend, then gaps down through the dashed limit.
 * The space between the limit and the price fills with the bond's peach, and two numbers count up:
 * "You lose $X · Bond pays $Y".
 *
 * Data: src/data/gap-demo.json. Change the JSON and rebuild; nothing else.
 * - status "illustration": a small "Illustration" label, no transaction link.
 * - status "real": "Replay of our scripted gap claim on Robinhood Chain testnet", linking settleTx on the explorer.
 *
 * This card is a server component; only the chart and the numbers (GapReplayPlayer) ship JavaScript.
 */
const DEFAULT_DATA = demoJson as GapDemo;

export function GapReplay({ data = DEFAULT_DATA, className }: { data?: GapDemo; className?: string }) {
  const d = data;
  const real = d.status === "real";
  return (
    <div className={cn("relative rounded-card-lg border border-line bg-surface p-4 shadow-soft sm:p-6 lg:p-8", className)}>
      {/* Status and terms */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:mb-6">
        {real ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <DemoLabel kind="scripted">Scripted gap</DemoLabel>
            <span className="text-[13px] text-ink-2">Replay of our scripted gap claim on Robinhood Chain testnet</span>
            {d.settleTx ? (
              <a
                href={txUrl(d.settleTx)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
              >
                Settle transaction <ArrowUpRightIcon size={12} />
              </a>
            ) : null}
          </div>
        ) : (
          <DemoLabel kind="illustration" title="Illustrative numbers from the worked example" />
        )}
        <p className="num text-[12px] text-ink-3 sm:text-[12.5px]">
          {formatUsd(d.accountUsd)} account · {formatBps(d.limitBps)} limit · cover to{" "}
          {formatBps(CAP_BPS, { negative: true })}
        </p>
      </div>

      <GapReplayPlayer data={d} />

      {d.note ? <p className="mt-4 max-w-[52rem] text-[12.5px] leading-relaxed text-ink-3">{d.note}</p> : null}
    </div>
  );
}

export default GapReplay;
