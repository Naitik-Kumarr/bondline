import { txUrl } from "@bondline/shared/chain";
import { LABELS } from "@bondline/shared/constants";
import type { MarketKey } from "@bondline/shared/deployment";
import type { ReactNode } from "react";
import { VerifyButton } from "@/components/agent/VerifyButton";
import { bpsPct, duration, modelName, reasonLabel, usd, usdOf, utcTime } from "@/components/market/fmt";
import { NumText } from "@/components/market/NumText";
import { AddressPill } from "@/components/ui/AddressPill";
import { Card } from "@/components/ui/Card";
import { AlertIcon, ArrowUpRightIcon } from "@/components/ui/icons";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { Reveal } from "@/components/ui/Reveal";
import { readMoments, type ClaimMoment, type DecisionMoment } from "./moments";

function MarketTag({ market }: { market: MarketKey | null }) {
  if (market === "replay") return <DemoLabel kind="replay" title={LABELS.replayMarket} />;
  if (market === "live")
    return (
      <Pill size="sm" tone="accent" title={LABELS.liveMarket}>
        Live market
      </Pill>
    );
  return null;
}

function TxLine({ hash, timestamp }: { hash: string; timestamp: number | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
      {timestamp != null ? <span>{utcTime(timestamp, { seconds: true })}</span> : null}
      <a
        href={txUrl(hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="num inline-flex items-center gap-1 text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60"
        title={hash}
      >
        tx {hash.slice(0, 10)}…{hash.slice(-6)}
        <ArrowUpRightIcon size={12} />
      </a>
    </div>
  );
}

function Moment({
  n,
  title,
  market,
  hash,
  timestamp,
  children,
  pending = false,
}: {
  n: number;
  title: string;
  market?: MarketKey | null;
  hash?: string | null;
  timestamp?: number | null;
  children: ReactNode;
  /** Nothing on-chain yet for this moment. */
  pending?: boolean;
}) {
  return (
    <Reveal as="li" className="grid grid-cols-1 gap-3 md:grid-cols-[3rem_minmax(0,1fr)] md:gap-5">
      <span className="num pt-1 text-[13px] text-ink-3 md:pt-6 md:text-right">{String(n).padStart(2, "0")}</span>
      <Card compact tone={pending ? "sunken" : "surface"} className={pending ? "min-w-0 border-dashed" : "min-w-0"}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-medium tracking-[-0.01em] text-ink">{title}</h3>
            {market !== undefined ? <MarketTag market={market} /> : null}
            {pending ? (
              <Pill size="sm" tone="neutral">
                Not yet
              </Pill>
            ) : null}
          </div>
          {hash ? <TxLine hash={hash} timestamp={timestamp ?? null} /> : null}
        </div>
        <div className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{children}</div>
      </Card>
    </Reveal>
  );
}

function Reasoning({ m }: { m: DecisionMoment }) {
  const reason = typeof m.parsed?.reason === "string" ? m.parsed.reason : null;
  const mock = m.parsed?.model === "mock";
  return (
    <div className="mt-4 flex flex-col gap-4">
      <figure className="border-l-2 border-accent/50 pl-4">
        <figcaption className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
          {mock ? (
            <>
              The decision&apos;s reason, decoded from the transaction input
              <DemoLabel kind="demo" className="h-5 px-2 text-[9.5px]">
                Mock, not an AI
              </DemoLabel>
            </>
          ) : (
            <>
              The AI&apos;s reasoning, decoded from the transaction input
              {modelName(m.parsed?.model) ? <> · {modelName(m.parsed?.model)}</> : null}
            </>
          )}
        </figcaption>
        {reason ? (
          <blockquote className="mt-1.5 text-[15px] leading-relaxed text-ink">&ldquo;{reason}&rdquo;</blockquote>
        ) : (
          <p className="mt-1.5 text-[14px] text-ink-3">No decision found in this transaction&apos;s input.</p>
        )}
      </figure>
      <VerifyButton txHash={m.txHash} account={m.account} />
    </div>
  );
}

const pctOf = (part: bigint, whole: bigint) => (whole > 0n ? Number((part * 10_000n) / whole) : 0);

/** The claim: the chain's Settled event, and the scripted gap's steps when deployments/gap-demo.json names this settle. */
function ClaimBody({ c }: { c: ClaimMoment }) {
  const limitBps = Math.round(pctOf(c.limit, c.principal) / 10) * 10;
  const story = c.story;
  return (
    <>
      {c.scripted ? (
        <div className="mb-3">
          <DemoLabel kind="scripted" title="The scripted gap demo: prices on the replay feeds moved by script">
            {LABELS.scriptedGap}
          </DemoLabel>
        </div>
      ) : null}
      {story ? (
        <p className="mb-3">
          A covered account with <span className="num text-ink">{usdOf(c.principal, { cents: true })}</span> in it
          and a <span className="num text-ink">{bpsPct(limitBps)}</span> limit.
          {story.fridayDrawdownBps != null ? (
            <>
              {" "}
              Scripted &ldquo;Friday close&rdquo;: down <span className="num text-ink">{bpsPct(story.fridayDrawdownBps)}</span>,
              inside its limit.
            </>
          ) : null}
          {story.weekendSeconds != null ? (
            <>
              {" "}
              Then no prices for <span className="num text-ink">{duration(story.weekendSeconds)}</span>, so the prices
              went stale: agents waited and nothing could settle.
            </>
          ) : null}
          {story.mondayDrawdownBps != null ? (
            <>
              {" "}
              Scripted &ldquo;Monday open&rdquo;: down <span className="num text-ink">{bpsPct(story.mondayDrawdownBps)}</span>,
              straight through the limit.
            </>
          ) : null}
        </p>
      ) : null}
      <p>
        The account&apos;s loss, <span className="num text-ink">{usdOf(c.loss, { cents: true })}</span>, had passed its{" "}
        <span className="num text-ink">{usdOf(c.limit, { cents: true })}</span> limit.{" "}
        <span className="num text-[13px]">settle</span> stopped the AI and the bond paid the loss beyond the limit, at
        fresh prices, once. The stocks stayed in the account.
      </p>
      <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
        <div className="rounded-field bg-sunken p-4">
          <p className="text-[12.5px] text-ink-3">The user lost</p>
          <p className="num mt-1 text-[24px] leading-none text-ink">{usdOf(c.loss - c.payout, { cents: true })}</p>
        </div>
        <div className="rounded-field bg-bond-soft p-4">
          <p className="text-[12.5px] text-bond-ink/80">The bond paid</p>
          <p className="num mt-1 text-[24px] leading-none text-bond-ink">{usdOf(c.payout, { cents: true })}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        Settled by{" "}
        {c.callerRole === "keeper" ? <span className="text-ink-2">our keeper</span> : null}
        <AddressPill address={c.caller} flagTeam />
        <span>· anyone can call settle</span>
      </div>
    </>
  );
}

/** Each on-chain moment with its transaction, derived from the chain's events. */
export async function MomentsSection() {
  const m = await readMoments();
  if (!m.ok) {
    return (
      <Card tone="sunken" className="flex items-start gap-3" role="alert">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
        <p className="text-[14px] text-ink-2">
          Couldn&apos;t read the chain just now, so the moments aren&apos;t shown rather than guessed. This page retries
          every minute.
        </p>
      </Card>
    );
  }
  const pending = (text: string) => <p className="text-[14.5px] text-ink-3">{text}</p>;
  return (
    <ol className="flex flex-col gap-3">
      <Moment n={1} title="An offer created and funded in one transaction" market={m.offer?.market ?? null} hash={m.offer?.txHash} timestamp={m.offer?.timestamp} pending={!m.offer}>
        {m.offer ? (
          <>
            <p>
              <span className="text-ink">{m.offer.name || `Offer ${m.offer.id}`}</span>:{" "}
              {m.offer.withSignature ? (
                <>
                  <span className="num text-[13px] text-ink">createOfferWithAuthorization</span> pulled the{" "}
                  <span className="num text-ink">{usdOf(m.offer.bond)}</span> bond with one USDG signature, created the
                  offer and funded it: <span className="num text-[13px]">OfferCreated</span> and{" "}
                  <span className="num text-[13px]">OfferFunded</span> in one transaction. The market kept no USDG.
                </>
              ) : (
                <>
                  <span className="num text-[13px]">OfferCreated</span> and{" "}
                  <span className="num text-[13px]">OfferFunded</span> in one transaction, with a{" "}
                  <span className="num text-ink">{usdOf(m.offer.bond)}</span> bond.
                </>
              )}{" "}
              Premium <span className="num">{bpsPct(m.offer.feeBps)}</span>.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
              Underwriter <AddressPill address={m.offer.underwriter} flagTeam />
            </div>
          </>
        ) : (
          pending("No offer yet on this deployment.")
        )}
      </Moment>

      <Moment n={2} title="A cover bought" market={m.cover?.market ?? null} hash={m.cover?.txHash} timestamp={m.cover?.timestamp} pending={!m.cover}>
        {m.cover ? (
          <>
            <p>
              A covered account opened with a <span className="num text-ink">{bpsPct(m.cover.limitBps)}</span> loss
              limit: <span className="num text-ink">{usdOf(m.cover.amount, { cents: true })}</span> deposited,{" "}
              <span className="num text-ink">{usdOf(m.cover.fee, { cents: true })}</span> premium to the bond,{" "}
              <span className="num text-ink">{usdOf(m.cover.net, { cents: true })}</span> covered. The cover reserved{" "}
              <span className="num text-bond-ink">{usdOf(m.cover.reserveAdded, { cents: true })}</span> of the bond for
              its worst case before accepting it.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
              Buyer <AddressPill address={m.cover.user} flagTeam />
            </div>
          </>
        ) : (
          pending("No cover bought yet on this deployment.")
        )}
      </Moment>

      <Moment n={3} title="An AI trade, with its reasoning" market={m.trade?.market ?? null} hash={m.trade?.txHash} timestamp={m.trade?.timestamp} pending={!m.trade}>
        {m.trade ? (
          <>
            <p>
              {m.trade.isBuy ? "Bought" : "Sold"} <span className="text-ink">{m.trade.asset}</span> for{" "}
              <span className="num text-ink">{m.trade.usd != null ? usd(m.trade.usd, { cents: true }) : "everything held"}</span>{" "}
              inside the account&apos;s rules. The <span className="num text-[13px]">Traded</span> event carries the
              keccak256 of the decision JSON in the transaction input.
            </p>
            <Reasoning m={m.trade} />
          </>
        ) : (
          pending("No trade yet on this deployment.")
        )}
      </Moment>

      <Moment n={4} title="A refusal" market={m.refusal?.market ?? null} hash={m.refusal?.txHash} timestamp={m.refusal?.timestamp} pending={!m.refusal}>
        {m.refusal ? (
          <>
            <p>
              The agent asked to {m.refusal.isBuy ? "buy" : "sell"} <span className="text-ink">{m.refusal.asset}</span>{" "}
              {m.refusal.usd != null ? (
                <>
                  for <span className="num text-ink">{usd(m.refusal.usd, { cents: true })}</span>
                </>
              ) : null}
              . Refused:{" "}
              <span className="text-ink">{m.refusal.reasonKey ? reasonLabel(m.refusal.reasonKey).toLowerCase() : "a rule"}</span>
              {m.refusal.detail ? (
                <>
                  {" "}
                  (<NumText text={m.refusal.detail} />)
                </>
              ) : null}
              . The transaction didn&apos;t revert: the <span className="num text-[13px]">Blocked</span> event is the
              receipt, and nothing changed.
            </p>
            <Reasoning m={m.refusal} />
          </>
        ) : (
          pending("No refusal yet on this deployment.")
        )}
      </Moment>

      <Moment n={5} title="The claim paid" market={m.claim?.market ?? null} hash={m.claim?.txHash} timestamp={m.claim?.timestamp} pending={!m.claim}>
        {m.claim ? (
          <ClaimBody c={m.claim} />
        ) : (
          pending(
            "No claim paid on this deployment yet. The scripted gap demo settles one on the replay market; its transaction appears here when it does.",
          )
        )}
      </Moment>
    </ol>
  );
}
