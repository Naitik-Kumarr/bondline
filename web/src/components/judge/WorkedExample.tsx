import { CAP_BPS } from "@bondline/shared/constants";
import { Card } from "@/components/ui/Card";
import { DemoLabel } from "@/components/ui/Pill";
import { Reveal } from "@/components/ui/Reveal";
import gapDemo from "@/data/gap-demo.json";

// The worked example from the brief. Every number on the right is computed here with the contract's own formulas
// (BondlineCover: settle and deposit), in USDG units, with the same rounding.
const UNIT = 1_000_000n; // 1 USDG
const P = 1_000n * UNIT; // principal: net USDG in the account
const L = 1_000n; // limit, bps
const MONDAY_DROP = 2_500n; // the Monday open, bps below principal
const FEE = 100n; // a 1% premium
const CAP = BigInt(CAP_BPS);

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const value = P - (P * MONDAY_DROP) / 10_000n;
const loss = P > value ? P - value : 0n;
const limit = ceilDiv(P * L, 10_000n);
const capPay = (P * (CAP - L)) / 10_000n;
const payout = loss > limit ? (loss - limit < capPay ? loss - limit : capPay) : 0n;
const reserve = ceilDiv(P * (CAP - L), 10_000n);
// The deposit whose net is P: amount − ⌊amount × fee / 10000⌋ = P.
const amount = ceilDiv(P * 10_000n, 10_000n - FEE);
const fee = (amount * FEE) / 10_000n;

const $ = (units: bigint) => {
  const cents = Number((units + 5_000n) / 10_000n) / 100;
  return `$${cents.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(cents) ? 0 : 2, maximumFractionDigits: 2 })}`;
};

const FORMULA: ([string, string, string] | null)[] = [
  ["P", "net USDG deposited", $(P)],
  ["l", "the limit, in bps", `${L} (10%)`],
  ["value", "cash + Σ stocks × price", `${$(value)} at the open`],
  null,
  ["loss", "max(0, P − value)", $(loss)],
  ["limit", "⌈P × l / 10000⌉", $(limit)],
  ["payout", "min(loss − limit, ⌊P × (3000 − l) / 10000⌋)", `min(${$(loss - limit)}, ${$(capPay)}) = ${$(payout)}`],
];

const claimPaid = gapDemo.status === "real" && Boolean(gapDemo.settleTx);

/** The worked example from the brief, with the contract formula next to it. */
export function WorkedExample() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Reveal className="h-full">
        <Card className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">The gap</p>
            <DemoLabel
              kind="illustration"
              title={`Round numbers to show the formula. Not a transaction: the real claim ${claimPaid ? "is" : "will be"} in the on-chain moments.`}
            >
              Illustration
            </DemoLabel>
          </div>
          <p className="mt-5 font-display text-[26px] leading-[1.22] tracking-[-0.015em] text-ink sm:text-[30px]">
            Friday close: your <span className="num text-[0.82em]">$1,000</span> account is down{" "}
            <span className="num text-[0.82em]">8%</span>. Monday it opens down{" "}
            <span className="num text-[0.82em]">25%</span>. A stop-loss can&apos;t sell inside a gap.
          </p>
          <p className="mt-5 text-[16px] leading-relaxed text-ink-2">
            With Bondline the AI is stopped, you lose <span className="num text-ink">$100</span> (your{" "}
            <span className="num">10%</span> limit), and the underwriter&apos;s bond pays the other{" "}
            <span className="num text-bond-ink">$150</span>. You paid the <span className="num">1%</span> premium on your
            deposit, about <span className="num">$10</span>.
          </p>
          <div className="mt-auto grid grid-cols-2 gap-3 pt-7">
            <div className="rounded-field bg-sunken p-4">
              <p className="text-[12.5px] text-ink-3">You would lose</p>
              <p className="num mt-1 text-[26px] leading-none text-ink">{$(loss - payout)}</p>
            </div>
            <div className="rounded-field bg-bond-soft p-4">
              <p className="text-[12.5px] text-bond-ink/80">The bond would pay</p>
              <p className="num mt-1 text-[26px] leading-none text-bond-ink">{$(payout)}</p>
            </div>
          </div>
        </Card>
      </Reveal>

      <Reveal className="h-full" delay={0.06}>
        <Card tone="sunken" className="flex h-full flex-col">
          <p className="eyebrow">The contract formula, on the illustration · BondlineCover.settle</p>
          <dl className="num mt-5 grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px] leading-relaxed sm:grid-cols-[3.75rem_minmax(0,1fr)_auto] sm:text-[12.5px]">
            {FORMULA.map((row, i) =>
              row === null ? (
                <div key={i} aria-hidden="true" className="col-span-full h-1.5" />
              ) : (
                <div key={i} className="contents">
                  <dt className="text-ink">{row[0]}</dt>
                  <dd className="text-ink-2">
                    <span className="text-ink-3">= </span>
                    {row[1]}
                  </dd>
                  <dd className="col-start-2 text-ink sm:col-start-auto sm:text-right">{row[2]}</dd>
                </div>
              ),
            )}
          </dl>
          <ul className="mt-6 flex flex-col gap-2.5 border-t border-line pt-5 text-[13.5px] leading-relaxed text-ink-2">
            <li>
              Anyone can call <span className="num text-[12.5px] text-ink">settle</span> once the loss passes the limit.
              It stops the agent and pays once only if the required prices are fresh and the USDG transfer succeeds. The
              keeper attempts settlement while it is running; transaction latency, stale prices and failed transfers can
              delay it. You end at{" "}
              <span className="num text-ink">{$(value + payout)}</span>, made whole down to your limit, and the stocks
              stay in the account.
            </li>
            <li>
              Fully backed before it&apos;s sold: the deposit reserved{" "}
              <span className="num text-[12.5px] text-ink">⌈net × (3000 − l) / 10000⌉ = {$(reserve)}</span> of the bond,
              and would have been refused if the free bond couldn&apos;t cover it.
            </li>
            <li>
              The premium: <span className="num text-[12.5px] text-ink">fee = ⌊amount × feeBps / 10000⌋</span>. A{" "}
              <span className="num">{$(amount)}</span> deposit at <span className="num">1%</span> pays{" "}
              <span className="num text-ink">{$(fee)}</span> and leaves <span className="num">{$(P)}</span> covered.
            </li>
          </ul>
        </Card>
      </Reveal>
    </div>
  );
}
