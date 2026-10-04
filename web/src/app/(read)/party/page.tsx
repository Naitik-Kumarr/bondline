import { txUrl } from "@bondline/shared/chain";
import { LABELS } from "@bondline/shared/constants";
import type { Metadata } from "next";
import { AutoRefresh } from "@/components/market/AutoRefresh";
import { Countdown } from "@/components/live/Countdown";
import { CoverList } from "@/components/live/CoverList";
import { AFTER_SETTLEMENT } from "@/components/live/copy";
import { readMarket, readPayouts } from "@/components/live/data";
import { FeedPanel, MarketFigures } from "@/components/live/Panels";
import { readParty } from "@/components/live/party";
import { duration, usdOf, utcTime } from "@/components/market/fmt";
import { AddressPill } from "@/components/ui/AddressPill";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { AlertIcon, ArrowUpRightIcon } from "@/components/ui/icons";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { Accent, Section, SectionHeader } from "@/components/ui/Section";

// Server-rendered from the chain and deployments/party.json, regenerated at most every 30 seconds.
export const revalidate = 30;

export const metadata: Metadata = {
  title: "Gap party",
  description:
    "A scripted gap on the Replay market at 15:00 IST: a countdown, every covered account's health against its limit, and the payouts as they settle on Robinhood Chain testnet.",
};

const IST = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const ist = (t: number) => `${IST.format(new Date(t * 1000))} IST`;

export default async function PartyPage() {
  const party = readParty();
  if (!party) {
    return (
      <Container size="narrow" className="py-20 text-center sm:py-28">
        <p className="eyebrow">Gap party</p>
        <h1 className="mt-4 font-display text-display-m text-ink">No gap party is scheduled.</h1>
        <p className="mx-auto mt-4 max-w-[30rem] text-[16px] leading-relaxed text-ink-2">
          When one is, this page counts down to it and shows the payouts as they happen.
        </p>
      </Container>
    );
  }
  const read = await readMarket(party.market);
  const payouts = read.ok ? await readPayouts(party.market, read.view.block.number) : [];
  const inParty = payouts.filter((p) => p.timestamp != null && p.timestamp >= party.sessionStartsAt);
  const earlier = payouts.length - inParty.length;
  const paid = inParty.reduce((s, p) => s + p.payout, 0n);
  const nowS = Math.floor(Date.now() / 1000);
  const phase = nowS < party.sessionStartsAt ? "before" : nowS < party.gapAt ? "session" : "after";

  return (
    <>
      <Container className="pb-8 pt-14 sm:pb-10 sm:pt-20">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="eyebrow">Gap party</p>
          <DemoLabel kind="scripted" title="Our keeper pushes prices from a control file. The settles and payouts are real testnet transactions; the gap is not a market event.">
            {LABELS.scriptedGap}
          </DemoLabel>
        </div>
        <h1 className="max-w-[18ch] font-display text-display-l text-ink">
          The 15:00 <Accent>gap</Accent>, on the clock.
        </h1>
        <p className="mt-5 max-w-[44rem] text-[17px] leading-relaxed text-ink-2 sm:text-lg">
          At <span className="num text-ink">{ist(party.gapAt)}</span> our keeper runs a scripted gap on the Replay
          market: prices jump past the limit of the covered accounts, the keeper settles every account past its limit,
          and the bond pays each user. The prices are scripted. The payouts below are real transactions on Robinhood
          Chain testnet.
        </p>
      </Container>

      <Container className="pb-10 sm:pb-14">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card padding="lg">
            <p className="eyebrow">Replay session starts</p>
            <div className="mt-6">
              <Countdown target={party.sessionStartsAt} doneLabel="The second replay session is running." />
            </div>
            <p className="mt-6 text-[14px] text-ink-2">
              <span className="num text-ink">{ist(party.sessionStartsAt)}</span> · {utcTime(party.sessionStartsAt)}. The
              agents invest covered accounts on real prices from 28 Sep to 2 Oct, sped up.
            </p>
          </Card>
          <Card padding="lg" tone="bond">
            <p className="eyebrow">Scripted gap</p>
            <div className="mt-6">
              <Countdown target={party.gapAt} doneLabel="The gap has been scripted. Payouts appear below." />
            </div>
            <p className="mt-6 text-[14px] text-ink-2">
              <span className="num text-ink">{ist(party.gapAt)}</span> · {utcTime(party.gapAt)}. Status in the plan:{" "}
              <span className="num text-ink">{party.status}</span>.
            </p>
          </Card>
        </div>
        {party.note ? (
          <p className="mt-4 max-w-[52rem] text-[13px] leading-relaxed text-ink-3">
            The plan, from deployments/party.json: {party.note}
          </p>
        ) : null}
      </Container>

      <Container className="pb-12 sm:pb-16">
        {read.ok ? (
          <div className="flex flex-col gap-4">
            <MarketFigures view={read.view} />
            <FeedPanel view={read.view} note="The Replay market's prices are real Chainlink rounds replayed by our keeper (team-operated)." />
          </div>
        ) : (
          <Card tone="sunken" className="flex items-start gap-3" role="alert">
            <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
            <div>
              <p className="font-medium text-ink">Couldn&apos;t read Robinhood Chain testnet just now.</p>
              <p className="mt-1 text-[14px] text-ink-2">Nothing is shown rather than a guess. This page retries every 30 seconds.</p>
              <p className="num mt-3 break-words text-[12px] text-ink-3">{read.error.slice(0, 240)}</p>
            </div>
          </Card>
        )}
      </Container>

      <Section spacing="sm" aria-labelledby="covers">
        <SectionHeader
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-3">
              Live from the chain <DemoLabel kind="replay" />
            </span>
          }
          title={<span id="covers">The covered accounts on the Replay market</span>}
          size="m"
          lead="Each cover's loss against its limit, as the contract sees it right now. When the gap lands, accounts cross their limits and these rows turn to Settled."
        />
        <div className="mt-8">{read.ok ? <CoverList rows={read.view.rows} empty="No covered accounts on the Replay market yet." /> : null}</div>
      </Section>

      <Section spacing="sm" aria-labelledby="payouts">
        <SectionHeader
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-3">
              Settled events <DemoLabel kind="scripted">{LABELS.scriptedGap}</DemoLabel>
            </span>
          }
          title={<span id="payouts">Payouts</span>}
          size="m"
          lead={
            phase === "after" || inParty.length > 0
              ? "Each row is a Settled event from the Replay market's covers, read from the chain."
              : "Empty until the keeper settles the first account. Each row will be a Settled event from the Replay market's covers."
          }
        />
        <div className="mt-8">
          {inParty.length === 0 ? (
            <div className="rounded-card-lg border border-dashed border-line-strong px-6 py-12 text-center text-[15px] text-ink-2">
              No payouts since the session started at {ist(party.sessionStartsAt)}.
            </div>
          ) : (
            <Card padding="none" className="overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
                <p className="text-[14px] text-ink-2">
                  <span className="num text-[22px] text-bond-ink">{usdOf(paid, { cents: true })}</span> paid across{" "}
                  <span className="num text-ink">{inParty.length}</span> settled {inParty.length === 1 ? "account" : "accounts"}
                </p>
              </div>
              <ul className="divide-y divide-line">
                {inParty.map((p) => (
                  <li key={p.txHash + p.account} className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-center lg:gap-8">
                    <div className="min-w-0">
                      <AddressPill address={p.account} />
                      <p className="mt-1.5 text-[12.5px] text-ink-3">
                        {p.timestamp != null ? utcTime(p.timestamp, { seconds: true }) : null} · settled by{" "}
                        <AddressPill address={p.caller} flagTeam />
                      </p>
                    </div>
                    <dl className="grid grid-cols-3 gap-3 text-[12px] text-ink-3">
                      <div>
                        <dt>Loss</dt>
                        <dd className="num mt-1 text-[14px] text-ink">{usdOf(p.loss, { cents: true })}</dd>
                      </div>
                      <div>
                        <dt>Limit</dt>
                        <dd className="num mt-1 text-[14px] text-ink">{usdOf(p.limit, { cents: true })}</dd>
                      </div>
                      <div>
                        <dt>Paid by the bond</dt>
                        <dd className="num mt-1 text-[14px] text-bond-ink">{usdOf(p.payout, { cents: true })}</dd>
                      </div>
                    </dl>
                    <a
                      href={txUrl(p.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="num inline-flex items-center gap-1 text-[12.5px] text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60"
                      title={p.txHash}
                    >
                      tx {p.txHash.slice(0, 10)}…{p.txHash.slice(-6)}
                      <ArrowUpRightIcon size={12} />
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {earlier > 0 ? (
            <p className="mt-4 text-[13px] text-ink-3">
              <span className="num">{earlier}</span> earlier {earlier === 1 ? "settle" : "settles"} on this market (before
              this session, so not counted here).
            </p>
          ) : null}
        </div>
      </Section>

      <Section spacing="sm" aria-labelledby="after" className="pb-24 sm:pb-32">
        <SectionHeader eyebrow="What a payout means" title={<span id="after">After the settle</span>} size="m" />
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <Card tone="bond">
            <p className="text-[15px] leading-relaxed text-ink-2">{AFTER_SETTLEMENT}</p>
          </Card>
          <Card>
            <p className="text-[15px] leading-relaxed text-ink-2">
              The gap is scripted and the accounts are team-operated test accounts, so this shows the mechanism, not how
              often real gaps happen. Max price age on this market:{" "}
              <span className="num text-ink">{duration(read.ok ? read.view.maxPriceAge : 300)}</span>.
            </p>
            <div className="mt-3">
              <Pill size="sm" tone="neutral">Testnet, unaudited</Pill>
            </div>
          </Card>
        </div>
      </Section>
      <AutoRefresh every={30_000} />
    </>
  );
}
