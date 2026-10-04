import { isLocalFork } from "@bondline/shared/deployment";
import { Card } from "@/components/ui/Card";
import { DemoLabel } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import type { Totals as BookTotals } from "@/lib/bondline/book";
import { int, usdgToUsd, utcTime } from "./fmt";

/**
 * Real totals from the chain, summed over every offer and cover in both markets. Underwriters and buyers are
 * counted by distinct wallet; team-operated wallets are counted apart and never as "outside".
 */
export function Totals({ totals, block }: { totals: BookTotals; block: { number: bigint; timestamp: number } }) {
  const people = (n: { team: number; outside: number }) => ({
    value: n.outside,
    hint:
      n.team > 0 ? (
        <>
          {n.outside === 0 ? "None yet · " : null}
          <span className="num">{int(n.team)}</span> team operated, not counted
        </>
      ) : n.outside === 0 ? (
        "None yet"
      ) : null,
  });
  const uw = people(totals.underwriters);
  const buyers = people(totals.buyers);

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Cells draw their own right and bottom hairlines; -mr-px tucks the last column's under the card edge. */}
      <dl className="-mr-px grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          {
            key: "bonded",
            el: (
              <Stat
                label="USDG bonded"
                value={usdgToUsd(totals.usdgBonded)}
                usd
                tone="bond"
                hint={`${int(totals.offers)} offer${totals.offers === 1 ? "" : "s"}`}
              />
            ),
          },
          {
            key: "sold",
            el: (
              <Stat
                label="Cover sold"
                value={usdgToUsd(totals.coverSold)}
                usd
                hint={`${int(totals.covers)} cover${totals.covers === 1 ? "" : "s"}, ${int(totals.activeCovers)} active`}
              />
            ),
          },
          { key: "premiums", el: <Stat label="Premiums paid" value={usdgToUsd(totals.premiums)} usd hint="to underwriters" /> },
          {
            key: "claims",
            el: <Stat label="Claims paid" value={usdgToUsd(totals.claimsPaid)} usd tone="bond" hint="from bonds to users" />,
          },
          { key: "uw", el: <Stat label="Outside underwriters" value={uw.value} hint={uw.hint} /> },
          { key: "buyers", el: <Stat label="Outside buyers" value={buyers.value} hint={buyers.hint} /> },
        ].map((t) => (
          <div key={t.key} className="border-b border-r border-line p-5 sm:p-6 [&>div]:h-full">
            {t.el}
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4 text-[12.5px] text-ink-3 sm:px-6">
        <span>
          Read from Robinhood Chain testnet at block <span className="num text-ink-2">{int(block.number)}</span> (
          {utcTime(block.timestamp)}). Refreshes every 30 seconds.
        </span>
        {isLocalFork ? <DemoLabel kind="demo">Local fork</DemoLabel> : null}
      </div>
    </Card>
  );
}
