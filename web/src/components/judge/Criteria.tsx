import { txUrl } from "@bondline/shared/chain";
import { deployment, isLocalFork } from "@bondline/shared/deployment";
import type { ReactNode } from "react";
import gapDemo from "@/data/gap-demo.json";
import { int } from "@/components/market/fmt";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";
import { Ext, Int, SOURCES } from "./Links";
import type { Reports } from "./reports";

/** The scripted gap claim has settled on the real chain (scripts/sync-gap-demo.mjs marks the data "real"). */
const claimPaid = gapDemo.status === "real" && Boolean(gapDemo.settleTx);

export interface CriteriaData {
  reports: Reports;
  verified: { total: number; verified: number; known: number };
  /** Distinct wallets from the chain; null if the chain couldn't be read. */
  people: { underwriters: { team: number; outside: number }; buyers: { team: number; outside: number } } | null;
}

function Row({ criterion, children }: { criterion: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-line px-5 py-6 first:border-t-0 sm:px-7 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8">
      <dt className="text-[15.5px] font-medium text-ink">{criterion}</dt>
      <dd className="text-[15px] leading-relaxed text-ink-2">{children}</dd>
    </div>
  );
}

/** The criteria table from the brief, each with its proof: reports read at build time, counts read from the chain. */
export function Criteria({ data }: { data: CriteriaData }) {
  const { tests, coverage, slither } = data.reports;
  const v = data.verified;
  const careful = deployment.wallets.careful;
  const bold = deployment.wallets.bold;
  return (
    <Reveal>
      <Card padding="none" className="overflow-hidden">
        <dl>
          <Row criterion="Smart contract quality">
            Bondline&apos;s own contracts are not upgradeable and its markets have no owner. The fixed keeper controls
            testnet prices, which affect trades and payouts; USDG and Stock Tokens retain issuer controls and upgrade
            paths.{" "}
            {tests ? (
              <>
                <span className="num text-ink">{int(tests.suite)}</span> Foundry tests, including{" "}
                <span className="num text-ink">{int(tests.fuzz)}</span> fuzz tests and{" "}
                <span className="num text-ink">{int(tests.invariant)}</span> invariants, plus{" "}
                <span className="num text-ink">{int(tests.fork)}</span> fork tests against the real USDG and
                Chainlink&apos;s live feeds.{" "}
              </>
            ) : null}
            {coverage ? (
              <>
                <span className="num text-ink">{coverage.lines.pct}%</span> line coverage (
                <span className="num">
                  {int(coverage.lines.hit)}/{int(coverage.lines.total)}
                </span>
                ).{" "}
              </>
            ) : null}
            {slither ? (
              <>
                Slither: <span className="num text-ink">{slither.high}</span> High,{" "}
                <span className="num text-ink">{slither.medium}</span> Medium.{" "}
              </>
            ) : null}
            {isLocalFork ? (
              <>Contract addresses are below; their explorer verification shows once this build reads the public testnet.</>
            ) : v.known === 0 ? (
              <>Contract addresses and source links are below.</>
            ) : v.verified === v.total ? (
              <>
                Every contract&apos;s source is verified on the explorer (
                <span className="num">
                  {v.verified}/{v.total}
                </span>
                , checked live).
              </>
            ) : (
              <>
                <span className="num">
                  {v.verified}/{v.total}
                </span>{" "}
                contracts show verified source on the explorer (checked live).
              </>
            )}{" "}
            <Int href="#quality">The numbers</Int>
          </Row>

          <Row criterion="Product-market fit">
            Robinhood: &ldquo;over 150,000 customers have opened agentic trading accounts&rdquo; and &ldquo;You assume
            all risk for trades executed by AI agents&rdquo; (<Ext href={SOURCES.hood}>HOOD Summit 2026</Ext>). AIUC
            raised $55M to insure agents off-chain (<Ext href={SOURCES.fortune}>$15M seed</Ext>,{" "}
            <Ext href={SOURCES.dealroom}>$40M Series A</Ext>).{" "}
            {data.people ? (
              <>
                On-chain right now: <span className="num text-ink">{int(data.people.underwriters.outside)}</span>{" "}
                outside underwriter{data.people.underwriters.outside === 1 ? "" : "s"} and{" "}
                <span className="num text-ink">{int(data.people.buyers.outside)}</span> outside buyer
                {data.people.buyers.outside === 1 ? "" : "s"}
                {data.people.underwriters.outside + data.people.buyers.outside === 0 ? " yet" : ""}; team-operated test
                wallets are labelled and not counted (<Int href="/market">market</Int>).
              </>
            ) : (
              <>
                Outside underwriters and buyers are counted on-chain on the <Int href="/market">market</Int>.
              </>
            )}
          </Row>

          <Row criterion="Innovation">
            A third-party underwriting market for AI traders. Underwriters set premiums. The site compares those
            premiums with reference prices from each agent&apos;s rules and stored record snapshot. A lower modeled risk
            does not automatically change an offer&apos;s premium. See{" "}
            <Int href={`/agent/${careful}`}>Careful&apos;s record</Int> and <Int href={`/agent/${bold}`}>Bold&apos;s</Int>:
            both now have a record price from executed trades, next to the rule-based reference price.
          </Row>

          <Row criterion="Real problem">
            The risk Robinhood&apos;s disclosure assigns to users: a price that gaps through your limit, where no
            stop-loss can sell. Bondline aims to cover a capped part of losses when prices move beyond a selected limit.{" "}
            <Int href="#example">An illustration</Int> of what the cover pays, and{" "}
            {claimPaid ? (
              <>
                <Int href="#moments">the real claim</Int>, on-chain: a scripted gap took a team test account from 92 to
                75 USDG, a 25% loss against a 10% limit, and the bond paid 15.000001 USDG seconds after the Monday-open
                price (<Ext href={txUrl(gapDemo.settleTx)}>settle transaction</Ext>).
              </>
            ) : (
              <>
                the real claim, which will be <Int href="#moments">on-chain</Int> once the scripted gap settles.
              </>
            )}
          </Row>

          <Row criterion="USDG">
            Every flow is USDG: bonds, premiums, cover and claims. Underwriting is one USDG signature and one
            transaction (EIP-3009 <span className="num text-[13.5px]">receiveWithAuthorization</span>):{" "}
            <Int href="#moments">see it on-chain</Int>. The issuer&apos;s pause and freeze controls are checked before
            anyone signs, and a frozen user can still stop the agent. USDG is &ldquo;issued by Paxos Digital Singapore
            Pte. Ltd. (PDS)&rdquo;, which &ldquo;is a Major Payments Institution supervised by the Monetary Authority of
            Singapore&rdquo; (<Ext href={SOURCES.paxos}>Paxos</Ext>); that describes USDG, not Bondline.
          </Row>
        </dl>
      </Card>
    </Reveal>
  );
}
