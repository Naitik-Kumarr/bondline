import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import type { AccountView } from "@/lib/bondline/book";
import { cn } from "@/lib/cn";
import { shortAddress } from "@/lib/format";
import { bpsPct, duration, usdOf } from "@/components/market/fmt";

export interface CoverRow {
  account: AccountView;
  /** The agent's name, when known. */
  agent: string;
  offerName: string;
}

/** The oldest of this market's feed prices, in seconds old at `now`; null when no price has been read. */
export function priceAge(updatedAts: (number | null)[], now: number): number | null {
  const known = updatedAts.filter((u): u is number => u != null);
  return known.length ? Math.max(0, now - Math.min(...known)) : null;
}

/** One cover's health against its limit: how far the loss has come toward the limit, and whether settle would work. */
function Health({ a }: { a: AccountView }) {
  const h = a.health;
  const ratio = h.limit > 0n ? Math.min(1, Number((h.loss * 10_000n) / h.limit) / 10_000) : 0;
  const past = h.status === "Active" && h.loss > h.limit;
  const tone = past ? "bg-negative" : ratio >= 0.5 ? "bg-caution" : "bg-positive";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px] text-ink-3">
        <span>Loss against limit</span>
        <span className="num text-ink-2">
          {usdOf(h.loss, { cents: true })} <span className="text-ink-3">of {usdOf(h.limit, { cents: true })}</span>
        </span>
      </div>
      <div
        className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-sunken-2"
        role="img"
        aria-label={`Loss is ${Math.round(ratio * 100)}% of the way to the limit`}
      >
        <div className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}

/** A cover's state in words: settled and paid, closed, past the limit (and whether it can settle now), or healthy. */
function StatusPills({ a }: { a: AccountView }) {
  const h = a.health;
  if (h.status === "Settled") return <Pill size="sm" tone="bond" dot>Settled, paid</Pill>;
  if (h.status === "Closed") return <Pill size="sm" tone="neutral" dot>Closed by the user</Pill>;
  const past = h.loss > h.limit;
  return (
    <>
      <Pill size="sm" tone={past ? "negative" : "positive"} dot>
        {past ? "Past its limit" : "Within its limit"}
      </Pill>
      <Pill
        size="sm"
        tone={h.fresh ? "positive" : "caution"}
        dot
        title="Settle and withdraw only work when every price the cover holds is within the market's maximum age."
      >
        {h.fresh ? "Prices fresh" : "Prices stale"}
      </Pill>
      {past && !h.fresh ? <Pill size="sm" tone="caution">Settles at the next fresh price</Pill> : null}
      {h.settleable ? <Pill size="sm" tone="negative">Settleable now</Pill> : null}
    </>
  );
}

/** The covers in a market: health against the limit, fresh or stale, past the limit. Read from the chain. */
export function CoverList({ rows, empty }: { rows: CoverRow[]; empty: string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card-lg border border-dashed border-line-strong px-6 py-12 text-center text-[15px] text-ink-2">
        {empty}
      </div>
    );
  }
  return (
    <Card padding="none" className="overflow-hidden">
      <ul className="divide-y divide-line">
        {rows.map(({ account: a, agent, offerName }) => (
          <li key={a.address} className="grid gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] lg:items-center lg:gap-8">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <Link
                  href={`/account/${a.address}`}
                  prefetch={false}
                  className="num text-[14px] text-ink underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60"
                >
                  {shortAddress(a.address)}
                </Link>
                {a.team ? <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">team-operated</span> : null}
              </div>
              <p className="mt-1 text-[13px] text-ink-3">
                {agent} · {offerName} · limit <span className="num text-ink-2">{bpsPct(a.limitBps)}</span>
              </p>
            </div>
            {a.health.status === "Active" ? <Health a={a} /> : <p className="text-[13px] text-ink-3">No longer in force.</p>}
            <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
              <StatusPills a={a} />
            </div>
            <dl className="col-span-full -mt-1 flex flex-wrap gap-x-7 gap-y-1 text-[12.5px] text-ink-3">
              <div className="flex gap-1.5">
                <dt>Covered</dt>
                <dd className="num text-ink-2">{usdOf(a.health.principal, { cents: true })}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt>Worth now</dt>
                <dd className="num text-ink-2">{usdOf(a.health.value, { cents: true })}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt>Reserve locked</dt>
                <dd className="num text-ink-2">{usdOf(a.health.reserve, { cents: true })}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "Prices fresh · 3h old" style line for a market's feeds (used on /live and /party). */
export const ageText = (seconds: number | null) => (seconds == null ? "no price yet" : `${duration(seconds)} old`);
