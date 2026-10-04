import { LABELS } from "@bondline/shared/constants";
import { isLocalFork } from "@bondline/shared/deployment";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { CheckIcon } from "@/components/ui/icons";
import { DemoLabel } from "@/components/ui/Pill";
import { Reveal } from "@/components/ui/Reveal";

const REAL: ReactNode[] = [
  <>Paxos USDG on Robinhood Chain testnet: every bond, premium, cover and claim.</>,
  <>Robinhood&apos;s official testnet Stock Tokens, TSLA and AMZN.</>,
  <>Chainlink&apos;s TSLA and AMZN prices on the live market, mirrored from Robinhood Chain mainnet with their real timestamps.</>,
  <>The AI&apos;s submitted decisions: each completed trade or rule check refusal carries its decision JSON, with its reasoning and the model it names, in the transaction, and a hash of those bytes in its receipt. Offchain holds are absent, and the hash verifies the bytes, not that a model produced them.</>,
  <>Every transaction on this site is on the public explorer, and every market number (bonds, cover, premiums, claims, trades, prices) is read from the chain. Test counts, coverage, gas, model prices and the backtest come from the reports and formulas named on this page.</>,
];

const DEMO: { label: ReactNode; text: ReactNode }[] = [
  { label: <DemoLabel kind="replay" />, text: LABELS.replayMarket },
  {
    label: <DemoLabel kind="scripted">{LABELS.scriptedGap}</DemoLabel>,
    text: "A scripted “Monday open” on the replay feeds that takes a covered account through its limit, so the keeper settles and the bond pays the gap.",
  },
  { label: <DemoLabel kind="demo">Demo exchange</DemoLabel>, text: LABELS.demoExchange },
  {
    label: <DemoLabel kind="team" />,
    text: "The test underwriter and test buyer, our keeper, and the two agents, Careful and Bold. All are labelled wherever they appear, and never counted as outside users.",
  },
];

/** What's real and what's demo, side by side. */
export function RealVsDemo() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Reveal className="h-full">
        <Card className="h-full">
          <p className="eyebrow">Real</p>
          <ul className="mt-5 flex flex-col gap-3.5">
            {REAL.map((r, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
                <CheckIcon size={16} className="mt-1 shrink-0 text-positive" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Reveal>
      <Reveal className="h-full" delay={0.06}>
        <Card tone="sunken" className="h-full">
          <p className="eyebrow">Demo, and labelled everywhere</p>
          <ul className="mt-5 flex flex-col gap-4">
            {DEMO.map((d, i) => (
              <li key={i} className="flex flex-col items-start gap-1.5 text-[14.5px] leading-relaxed text-ink-2">
                {d.label}
                <span>{d.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Reveal>
      <p className="text-[13.5px] leading-relaxed text-ink-3 lg:col-span-2">
        {LABELS.testnet} {LABELS.notInsurance} {LABELS.independent}
        {isLocalFork ? (
          <>
            {" "}
            This build reads a local fork of the testnet: its decisions are labelled mock, and its transactions don&apos;t
            exist on the public explorer.
          </>
        ) : null}
      </p>
    </div>
  );
}
