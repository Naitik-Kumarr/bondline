import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";

const code = (s: string) => <span className="num text-[12.5px] text-ink">{s}</span>;

const ROWS: { cant: string; how: ReactNode; tests: string[] }[] = [
  {
    cant: "The agent can't withdraw",
    how: (
      <>
        Its only function is {code("trade")}. Money leaves an account only to its owner: through the cover&apos;s{" "}
        {code("withdraw")}, or by {code("sweep")} after a settle or close.
      </>
    ),
    tests: ["testFuzz_agentCanNeverMoveMoneyOut", "invariant_agentHoldsNothing"],
  },
  {
    cant: "The agent can't change its rules",
    how: (
      <>
        The rules are set once, in {code("initialize")}, when the cover opens the account. There is no setter.
      </>
    ),
    tests: ["test_initialize_onlyOnce"],
  },
  {
    cant: "Underwriters can't veto payouts",
    how: (
      <>
        {code("settle(account)")} is open to anyone. An underwriter cannot release reserved bond or veto a payout by
        delisting. Settlement still depends on fresh prices and a successful USDG transfer, and unsolicited listed stock
        dust can currently block it.
      </>
    ),
    tests: ["test_settle_paysTheGap", "invariant_noPayoutExceedsReservation"],
  },
  {
    cant: "Underwriters can't take reserved money",
    how: <>{code("release")} reverts {code("InsufficientFreeBond")} beyond the free bond.</>,
    tests: ["test_release_onlyUnderwriter_onlyFree", "invariant_coverHoldsItsBond"],
  },
  {
    cant: "No deposit beyond capacity",
    how: (
      <>
        Every deposit reserves its worst case, rounded up, and reverts {code("InsufficientCapacity")} if the free bond
        can&apos;t cover it.
      </>
    ),
    tests: ["test_deposit_refusedBeyondCapacity", "invariant_reservedNeverExceedsBond", "invariant_reservationCoversWorstCase"],
  },
  {
    cant: "The market has no owner",
    how: (
      <>
        {code("BondlineMarket")} has no owner; its configuration is fixed at deploy. Bondline&apos;s own contracts are not
        upgradeable: covers and accounts are EIP-1167 clones, initialized once. The fixed keeper controls testnet prices,
        which affect trades and payouts; USDG and Stock Tokens retain issuer controls and upgrade paths.
      </>
    ),
    tests: [],
  },
  {
    cant: "The market keeps no money",
    how: (
      <>
        {code("createOfferWithAuthorization")} pulls the bond and funds the new cover in the same transaction.
      </>
    ),
    tests: ["invariant_marketHoldsNoUsdg"],
  },
];

/** What nobody can do, how the contracts enforce it, and the tests that check it (only names found in contracts/test). */
export function CantTable({ testNames }: { testNames: Set<string> | null }) {
  return (
    <Reveal>
      <Card padding="none" className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,4fr)_minmax(0,6fr)_minmax(0,4fr)] gap-6 border-b border-line px-7 py-4 text-[12.5px] text-ink-3 md:grid">
          <span>Can&apos;t</span>
          <span>Enforced by</span>
          <span>Checked by</span>
        </div>
        <ul>
          {ROWS.map((r) => {
            const tests = testNames ? r.tests.filter((t) => testNames.has(t)) : [];
            return (
              <li
                key={r.cant}
                className="grid grid-cols-1 gap-2.5 border-t border-line px-5 py-5 first:border-t-0 sm:px-7 md:grid-cols-[minmax(0,4fr)_minmax(0,6fr)_minmax(0,4fr)] md:gap-6"
              >
                <p className="text-[15px] font-medium text-ink">{r.cant}</p>
                <p className="text-[14px] leading-relaxed text-ink-2">{r.how}</p>
                <div className="flex flex-col gap-1">
                  {tests.length ? (
                    tests.map((t) => (
                      <span key={t} className="num break-all text-[12px] leading-relaxed text-ink-3">
                        {t}
                      </span>
                    ))
                  ) : (
                    <span className="text-[12.5px] text-ink-3">The contract source</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </Reveal>
  );
}
