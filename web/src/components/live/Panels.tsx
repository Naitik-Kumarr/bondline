import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { duration, int, usd, usdgToUsd, utcTime } from "@/components/market/fmt";
import type { MarketView } from "./data";
import { priceAge } from "./CoverList";

/** The market's mirrored prices and how old they are against the age settle and withdraw accept. */
export function FeedPanel({ view, note }: { view: MarketView; note: React.ReactNode }) {
  const now = view.block.timestamp;
  const known = view.prices.filter((p) => p.price != null && p.updatedAt != null);
  const age = priceAge(known.map((p) => p.updatedAt), now);
  const fresh = age != null && age <= view.maxPriceAge;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Prices the market uses</h2>
        {age == null ? (
          <Pill size="sm" tone="neutral">No price read</Pill>
        ) : (
          <Pill size="sm" dot tone={fresh ? "positive" : "caution"}>
            {fresh ? "Prices fresh" : "Prices stale"} · <span className="num">{duration(age)}</span> old
          </Pill>
        )}
      </div>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {known.length === 0 ? (
          <li className="py-3 text-[14px] text-ink-3">The feeds hold no price yet.</li>
        ) : (
          known.map((p) => (
            <li key={p.symbol} className="flex items-baseline justify-between gap-4 py-3">
              <span className="font-mono text-[12px] tracking-[0.06em] text-ink-3">{p.symbol}</span>
              <span className="text-right">
                <span className="num text-[16px] text-ink">
                  ${p.price!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="block text-[12px] text-ink-3">{utcTime(p.updatedAt!, { seconds: true })}</span>
              </span>
            </li>
          ))
        )}
      </ul>
      <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
        This market accepts prices up to <span className="num text-ink-2">{duration(view.maxPriceAge)}</span> old for
        settles and withdrawals. {note}
      </p>
    </Card>
  );
}

/** Bond, reserve and cover counts for one market, read from the chain. */
export function MarketFigures({ view }: { view: MarketView }) {
  const cells: [string, string, string?][] = [
    ["Bonded", usd(usdgToUsd(view.bond))],
    ["Reserve locked", usd(usdgToUsd(view.reserved)), "until each cover closes or pays out"],
    ["Covers in force", int(view.active), `${int(view.rows.length)} opened in all`],
    ["Past their limit", int(view.pastLimit), view.settled ? `${int(view.settled)} already settled` : undefined],
  ];
  return (
    <Card padding="none" className="overflow-hidden">
      <dl className="-mr-px grid grid-cols-2 lg:grid-cols-4">
        {cells.map(([label, value, hint]) => (
          <div key={label} className="border-b border-r border-line p-5 sm:p-6">
            <dt className="text-[13px] text-ink-3">{label}</dt>
            <dd className="num mt-1.5 text-[26px] leading-none tracking-[-0.02em] text-ink sm:text-[28px]">{value}</dd>
            {hint ? <dd className="mt-2 text-[12.5px] leading-snug text-ink-3">{hint}</dd> : null}
          </div>
        ))}
      </dl>
    </Card>
  );
}
