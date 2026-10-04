"use client";

import { CAP_BPS } from "@bondline/shared/constants";
import { cn } from "@/lib/cn";
import { formatBps } from "@/lib/format";
import { usdg as fmtUsdg } from "@/lib/bondline/format";

const motion = "transition-transform duration-[var(--duration-spring)] ease-spring motion-reduce:transition-none";

/** Where a label sits at fraction `t` of the track: centred, or held inside the ends. */
const edge = (t: number) => (t < 0.1 ? "translate-x-0" : t > 0.9 ? "-translate-x-full" : "-translate-x-1/2");

/**
 * Loss against the limit against the 30% cap, on one 0–30% scale. You carry the loss up to the limit (ink); the bond
 * pays from the limit to the cap (peach). Everything that moves, moves with transform only.
 */
export function HealthGauge({
  principal,
  loss,
  limit,
  limitBps,
  payoutNow,
  paid,
}: {
  principal: bigint;
  loss: bigint;
  limit: bigint;
  limitBps: number;
  payoutNow: bigint;
  /** Once settled: what the bond actually paid (from the Settled event), shown instead of "pays now". */
  paid?: React.ReactNode;
}) {
  const lossBps = principal > 0n ? Number((loss * 10_000n) / principal) : 0;
  const scale = (bps: number) => Math.min(1, Math.max(0, bps / CAP_BPS));
  const at = scale(limitBps);
  const carried = scale(Math.min(lossBps, limitBps));
  const beyond = Math.max(0, scale(lossBps) - at);
  const marker = scale(lossBps);
  const past = loss > limit;

  return (
    <div>
      <div className="relative h-6 text-[12px]" aria-hidden="true">
        <span className={cn("absolute bottom-1.5 whitespace-nowrap font-medium text-accent-ink", edge(at))} style={{ left: `${at * 100}%` }}>
          Your limit · <span className="num">{formatBps(limitBps)}</span>
        </span>
      </div>
      <div
        className="relative h-11 overflow-hidden rounded-[12px] bg-sunken"
        role="img"
        aria-label={`Loss ${formatBps(lossBps)} of principal; limit ${formatBps(limitBps)}; the cover pays up to a 30% drop.`}
      >
        <div
          className="absolute inset-y-0 right-0 bg-bond-tint"
          style={{
            left: `${at * 100}%`,
            backgroundImage: "repeating-linear-gradient(135deg, rgb(242 163 122 / 0.32) 0 1px, transparent 1px 7px)",
          }}
        />
        <div className={cn("absolute inset-0 origin-left bg-ink/80", motion)} style={{ transform: `scaleX(${carried})` }} />
        <div className="absolute inset-0" style={{ transform: `translateX(${at * 100}%)` }}>
          <div className={cn("absolute inset-0 origin-left bg-bond-strong", motion)} style={{ transform: `scaleX(${beyond})` }} />
        </div>
        <div className="absolute inset-y-0 border-l-2 border-dashed border-accent" style={{ left: `${at * 100}%` }} />
        <span className="absolute inset-y-0 right-3 flex items-center text-[12px] font-medium text-bond-ink">
          Bond pays
        </span>
      </div>
      <div className="relative h-7" aria-hidden="true">
        <span
          className={cn(
            "absolute top-1.5 size-0 -translate-x-1/2 border-x-[5px] border-b-[6px] border-x-transparent",
            past ? "border-b-negative" : "border-b-ink",
          )}
          style={{ left: `${marker * 100}%` }}
        />
      </div>
      <div className="num -mt-1 flex justify-between text-[11.5px] text-ink-3" aria-hidden="true">
        <span>0%</span>
        <span>30% drop: cover ends</span>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-line pt-4 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="text-ink-3">Loss now</dt>
          <dd className={cn("num mt-1 text-[16px]", past ? "text-negative" : "text-ink")}>
            {loss > 0n ? (
              <>
                {formatBps(lossBps)} · ${fmtUsdg(loss)}
              </>
            ) : (
              "None"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-accent-ink">You carry, up to</dt>
          <dd className="num mt-1 text-[16px] text-ink">${fmtUsdg(limit)}</dd>
        </div>
        <div>
          <dt className="text-bond-ink">{paid ? "The bond paid" : "The bond pays now"}</dt>
          <dd className="num mt-1 text-[16px] text-bond-ink">{paid ?? `$${fmtUsdg(payoutNow)}`}</dd>
        </div>
      </dl>
      {lossBps > CAP_BPS ? (
        <p className="mt-3 text-[13px] text-caution">
          The loss is past the 30% cap: the bond pays the band from your limit to a 30% drop, not more.
        </p>
      ) : null}
    </div>
  );
}
