// The one visual of each tour step. Server components: every number is read by data.ts from the chain or the existing
// records, and every on-chain fact links to the explorer.
import { addressUrl, txUrl } from "@bondline/shared/chain";
import { CAP_BPS, LABELS, USDG } from "@bondline/shared/constants";
import { deployment } from "@bondline/shared/deployment";
import type { MarketKey } from "@bondline/shared/deployment";
import Link from "next/link";
import type { ReactNode } from "react";
import { VerifyButton } from "@/components/agent/VerifyButton";
import { GapReplayPlayer } from "@/components/hero/GapReplayPlayer";
import { SOURCES } from "@/components/judge/Links";
import type { DecisionMoment } from "@/components/judge/moments";
import { Countdown } from "@/components/live/Countdown";
import { CapacityBar } from "@/components/market/CapacityBar";
import { bpsPct, duration, int, modelName, reasonLabel, usd, utcTime } from "@/components/market/fmt";
import { NumText } from "@/components/market/NumText";
import { AddressPill } from "@/components/ui/AddressPill";
import { AgentMark } from "@/components/ui/AgentMark";
import { ButtonLink, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ArrowRightIcon, ArrowUpRightIcon, CheckIcon } from "@/components/ui/icons";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { formatUsdg } from "@/lib/format";
import type { TourAgent, TourAgentRef, TourClaim, TourCover, TourOffer, TourReal } from "./data";
import { REPO_URL, repoFile, VIDEO_URL } from "./links";

// ------------------------------------------------------------------ small parts

const linkClass = "underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60";

/** A transaction on the explorer: `tx 0xbace67df…087c`, with its time. */
function Tx({ hash, timestamp, className }: { hash: string; timestamp?: number | null; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-3", className)}>
      {timestamp != null ? <span>{utcTime(timestamp)}</span> : null}
      <a
        href={txUrl(hash)}
        target="_blank"
        rel="noopener noreferrer"
        title={`Transaction ${hash} on the explorer`}
        className={cn("num inline-flex items-center gap-1 text-ink-2", linkClass)}
      >
        tx {hash.slice(0, 10)}…{hash.slice(-4)}
        <ArrowUpRightIcon size={11} />
      </a>
    </span>
  );
}

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

function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink", linkClass)}
    >
      {children}
      <ArrowUpRightIcon size={11} />
    </a>
  );
}

function Fact({ label, value, hint, tone = "ink" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ink" | "bond" }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] leading-tight text-ink-3">{label}</dt>
      <dd
        className={cn(
          "num mt-1.5 text-[20px] leading-none tracking-[-0.02em] sm:text-[24px]",
          tone === "bond" ? "text-bond-ink" : "text-ink",
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{hint}</dd> : null}
    </div>
  );
}

/** Two decimals, no unit: `25.50`. */
const amount = (units: bigint) => formatUsdg(units).replace(/ USDG$/, "");

/** Shown in place of a visual when the chain couldn't be read: nothing is guessed. */
export function Unavailable({ what }: { what: string }) {
  return (
    <Card tone="sunken" className="border-dashed">
      <p className="text-[15px] leading-relaxed text-ink-2">
        Couldn&apos;t read {what} from Robinhood Chain testnet just now, so it isn&apos;t shown rather than guessed. This
        page reads the chain again every 30 seconds.
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------ 1. The problem

/** Robinhood's own words, each with its source. */
export function ProblemVisual() {
  return (
    <div className="grid gap-3 sm:gap-4">
      <Card as="figure" padding="none" className="m-0 p-5 sm:p-7">
        <p className="eyebrow">Robinhood · 29 Sep 2026</p>
        <blockquote className="mt-4 text-[17px] leading-snug text-ink-2 sm:text-[19px]">
          &ldquo;over{" "}
          <span className="num my-1 block text-[52px] leading-none tracking-[-0.04em] text-ink sm:text-[68px]">150,000</span>
          customers have opened agentic trading accounts&rdquo;
        </blockquote>
        <figcaption className="mt-5">
          <Source href={SOURCES.hood}>Robinhood newsroom, HOOD Summit 2026</Source>
        </figcaption>
      </Card>
      <Card as="figure" padding="none" tone="accent" className="m-0 p-5 sm:p-7">
        <p className="eyebrow">Robinhood · the disclosure</p>
        <blockquote className="mt-4 font-display text-[28px] leading-[1.12] tracking-[-0.02em] text-ink sm:text-[36px]">
          &ldquo;You assume all risk for trades executed by AI agents.&rdquo;
        </blockquote>
        <figcaption className="mt-5">
          <Source href={SOURCES.hood}>Robinhood newsroom, HOOD Summit 2026</Source>
        </figcaption>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ 2. The rules

/** A price age in its largest whole unit: `5 min`, `4 h`; otherwise as /agent shows it. */
const age = (s: number) => (s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : duration(s));

const RULES: [string, (a: TourAgent) => string | null][] = [
  ["Stocks after a buy", (a) => (a.rules ? bpsPct(a.rules.maxStockBps) : a.maxStockBps != null ? bpsPct(a.maxStockBps) : null)],
  ["Largest trade", (a) => (a.rules ? bpsPct(a.rules.maxTradeBps) : null)],
  ["Oldest price", (a) => (a.rules ? age(a.rules.maxPriceAge) : null)],
];

function Reasoning({ m }: { m: DecisionMoment }) {
  const reason = typeof m.parsed?.reason === "string" ? m.parsed.reason : null;
  const mock = m.parsed?.model === "mock";
  return (
    <figure className="m-0 mt-3 border-l-2 border-accent/50 pl-3.5">
      {reason ? (
        <blockquote className="text-[14.5px] leading-relaxed text-ink">&ldquo;{reason}&rdquo;</blockquote>
      ) : (
        <p className="text-[14px] text-ink-3">No decision found in this transaction&apos;s input.</p>
      )}
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        {mock ? (
          <>
            The decision&apos;s reason, from the transaction input
            <DemoLabel kind="demo" className="h-5 px-2 text-[9.5px]">
              Mock, not an AI
            </DemoLabel>
          </>
        ) : (
          <>{modelName(m.parsed?.model) ?? "The AI"}&apos;s reasoning, decoded from the transaction input</>
        )}
      </figcaption>
    </figure>
  );
}

export function RulesVisual({
  agents,
  trade,
  tradeAgent,
  refusal,
  refusalAgent,
}: {
  agents: TourAgent[];
  trade: DecisionMoment | null;
  tradeAgent: TourAgentRef | null;
  refusal: DecisionMoment | null;
  refusalAgent: TourAgentRef | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Card padding="none" className="overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-line">
          {agents.map((a) => (
            <div key={a.role} className="min-w-0 p-4 sm:p-6">
              <Link href={`/agent/${a.address}`} className="group flex min-w-0 items-center gap-2.5">
                <AgentMark address={a.address} size={32} />
                <span className="truncate font-display text-[26px] leading-none tracking-[-0.02em] text-ink group-hover:text-accent-ink sm:text-[30px]">
                  {a.name}
                </span>
              </Link>
              <dl className="mt-4 flex flex-col gap-2.5">
                {RULES.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <dt className="text-[12.5px] leading-tight text-ink-3">{label}</dt>
                    <dd className="num text-[15px] text-ink sm:text-[17px]">{value(a) ?? "n/a"}</dd>
                  </div>
                ))}
              </dl>
              {a.rules ? (
                <div className="mt-3.5">
                  <AddressPill address={a.rules.account} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-page/70 px-4 py-3 sm:px-6">
          <p className="text-[12px] leading-snug text-ink-3">
            Shares of the account&apos;s value, read from each covered account&apos;s contract. The stock share is checked
            after every buy, so price moves can carry it past the cap.
          </p>
          <MarketTag market={agents.find((a) => a.rules)?.rules?.market ?? null} />
          <DemoLabel kind="team" title="Careful and Bold are Claude agents run by the Bondline team." />
        </div>
      </Card>

      {trade ? (
        <Card compact padding="none" className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Pill size="sm" tone="positive" dot>
                Trade
              </Pill>
              <span className="text-[14px] font-medium text-ink">
                {tradeAgent ? `${tradeAgent.name} ` : ""}
                {trade.isBuy ? "bought" : "sold"} {trade.asset}{" "}
                <span className="num font-normal text-ink-2">
                  {trade.usd != null ? usd(trade.usd, { cents: true }) : "everything held"}
                </span>
              </span>
              <MarketTag market={trade.market} />
            </div>
            <Tx hash={trade.txHash} timestamp={trade.timestamp} />
          </div>
          <Reasoning m={trade} />
          {/* Keyed by the transaction: when a newer trade arrives on refresh, Verify starts fresh for it. */}
          <VerifyButton key={trade.txHash} txHash={trade.txHash} account={trade.account} size="md" className="mt-3.5" />
        </Card>
      ) : (
        <Card compact tone="sunken" className="border-dashed">
          <p className="text-[14px] text-ink-2">No AI trade on this deployment yet.</p>
        </Card>
      )}

      {refusal ? (
        <Card compact padding="none" className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Pill size="sm" tone="caution" dot>
                Refusal
              </Pill>
              <span className="text-[14px] font-medium text-ink">
                {refusalAgent ? `${refusalAgent.name} ` : "The agent "}asked to {refusal.isBuy ? "buy" : "sell"} {refusal.asset}
                {refusal.usd != null ? (
                  <>
                    {" "}
                    <span className="num font-normal text-ink-2">{usd(refusal.usd, { cents: true })}</span>
                  </>
                ) : null}
              </span>
              <MarketTag market={refusal.market} />
            </div>
            <Tx hash={refusal.txHash} timestamp={refusal.timestamp} />
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            <span className="font-medium text-ink">
              Refused: {refusal.reasonKey ? reasonLabel(refusal.reasonKey).toLowerCase() : "a rule"}
            </span>
            {refusal.detail ? (
              <>
                {" "}
                (<NumText text={refusal.detail} />)
              </>
            ) : null}
            . The <span className="num text-[12.5px]">Blocked</span> event is the receipt; nothing moved.
          </p>
          <Reasoning m={refusal} />
          <VerifyButton key={refusal.txHash} txHash={refusal.txHash} account={refusal.account} size="md" className="mt-3.5" />
        </Card>
      ) : (
        <Card compact tone="sunken" className="border-dashed">
          <div className="flex flex-wrap items-center gap-2">
            <Pill size="sm" tone="neutral">
              Refusal: not yet
            </Pill>
          </div>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-2">
            No agent has asked for a trade outside its rules on this deployment yet. When one does, the account refuses it
            onchain, and this card shows the <span className="num text-[12.5px]">Blocked</span> event with the AI&apos;s
            reasoning.
          </p>
          <Link href="/judge#cant" className={cn("mt-2.5 inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink", linkClass)}>
            Until then: what the contracts refuse, and the tests that check it
            <ArrowRightIcon size={12} />
          </Link>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 3. The offer

export function OfferVisual({ data }: { data: TourOffer }) {
  const o = data.offer;
  const active = o.accounts.filter((a) => a.health.status === "Active").length;
  const share = o.bond > 0n ? Number((o.free * 10_000n) / o.bond) / 10_000 : 0;
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <AgentMark address={o.agent} size={40} />
            <div className="min-w-0">
              <p className="truncate text-[16px] font-medium text-ink">{o.terms.name?.trim() || `Offer ${o.id}`}</p>
              <p className="num mt-0.5 text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
                Backs {data.agentName} · offer #{o.id}
              </p>
            </div>
          </div>
          <MarketTag market={o.market} />
        </div>

        <dl className="mt-6 grid grid-cols-3 gap-3 sm:gap-5">
          <Fact
            label="Bond"
            value={amount(o.bond)}
            hint={
              data.fundedBond != null && o.premiums > 0n && data.fundedBond + o.premiums === o.bond
                ? `USDG: ${amount(data.fundedBond)} at creation + ${amount(o.premiums)} premiums`
                : `USDG behind ${data.agentName}`
            }
            tone="bond"
          />
          <Fact label="Premium" value={bpsPct(o.terms.feeBps)} hint="of each deposit" />
          <Fact
            label="Loss limits"
            value={
              <>
                {bpsPct(o.terms.minLimitBps)} to {bpsPct(o.terms.maxLimitBps)}
              </>
            }
            hint={`buyers pick; cover to −${bpsPct(CAP_BPS)}`}
          />
        </dl>

        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[12.5px] text-ink-3">Capacity · free bond</span>
            <span className="num text-[13px] text-ink">
              {amount(o.free)} <span className="text-ink-3">of {formatUsdg(o.bond)}</span>
            </span>
          </div>
          <CapacityBar share={share} label={`${formatUsdg(o.free)} of a ${formatUsdg(o.bond)} bond is free to back new cover`} />
          <p className="mt-2 text-[12px] leading-snug text-ink-3">
            <span className="num">{formatUsdg(o.reserved)}</span> reserved for <span className="num">{int(active)}</span>{" "}
            active cover{active === 1 ? "" : "s"}. Every deposit reserves its worst case first.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            <span>Read from the cover contract</span>
            <AddressPill address={o.cover} />
          </div>
        </div>
      </div>

      <div className="border-t border-line bg-page/70 px-5 py-4 sm:px-7">
        {data.txHash ? (
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            {data.withSignature ? (
              <>
                <span className="num text-[12.5px] text-ink">createOfferWithAuthorization</span>: one USDG signature
                {data.fundedBond != null ? (
                  <>
                    {" "}
                    pulled the initial <span className="num text-ink">{formatUsdg(data.fundedBond)}</span> bond,
                  </>
                ) : null}{" "}
                created the offer and funded it, in one transaction.
              </>
            ) : (
              <>
                Created and funded in one transaction
                {data.fundedBond != null ? (
                  <>
                    , with a <span className="num text-ink">{formatUsdg(data.fundedBond)}</span> bond
                  </>
                ) : null}
                .
              </>
            )}
          </p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-ink-3">
          <span>Underwriter</span>
          <AddressPill address={o.underwriter} flagTeam />
          {data.txHash ? <Tx hash={data.txHash} timestamp={data.timestamp} /> : null}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ 4. The cover

export function CoverVisual({ data }: { data: TourCover }) {
  const premiumShare = data.amount > 0n ? Number((data.fee * 10_000n) / data.amount) / 10_000 : 0;
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-3">
              {data.agentName ? `${data.agentName}'s covered account` : "Covered account"}
            </span>
            <AddressPill address={data.account} />
          </div>
          <MarketTag market={data.market} />
        </div>
        {data.offerName ? (
          <p className="mt-3 text-[13px] leading-snug text-ink-2">
            Bought from the <span className="text-ink">{data.offerName}</span> offer
            {data.claimed ? ", a different bond from step 3: the account the gap claims in step 5." : "."}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className="text-[12.5px] text-ink-3">Loss limit</p>
            <p className="num mt-1 text-[56px] leading-none tracking-[-0.04em] text-accent-ink sm:text-[64px]">
              {bpsPct(data.limitBps)}
            </p>
          </div>
          <p className="max-w-[20rem] pb-1 text-[13.5px] leading-snug text-ink-2">
            The buyer&apos;s pick. Once the loss passes it and prices are fresh, anyone can call settle: the agent stops
            and the bond pays the loss beyond it, up to a {bpsPct(CAP_BPS)} drop.
          </p>
        </div>

        {/* The deposit: what's covered, and the premium that went to the bond. Widths are static; fills scale in. */}
        <div className="mt-7">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px] text-ink-3">
            <span>Deposited</span>
            <span className="num text-[14px] text-ink">{formatUsdg(data.amount)}</span>
          </div>
          <div className="tour-split mt-2 flex h-3 gap-[3px]" role="img" aria-label={`${formatUsdg(data.net)} covered and ${formatUsdg(data.fee)} premium to the bond`}>
            <span className="tour-fill h-full rounded-l-full bg-accent" style={{ width: `${(100 - premiumShare * 100).toFixed(2)}%` }} />
            <span className="tour-fill h-full min-w-[6px] rounded-r-full bg-bond" style={{ width: `${(premiumShare * 100).toFixed(2)}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:gap-5">
            <Fact label="Covered" value={amount(data.net)} hint="USDG in the account" />
            <Fact
              label="Premium paid"
              value={amount(data.fee)}
              hint={
                <>
                  USDG to the bond{data.feeBps != null ? <> ({bpsPct(data.feeBps)})</> : null}
                </>
              }
              tone="bond"
            />
          </dl>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
            Before accepting it, the bond reserved <span className="num text-bond-ink">{formatUsdg(data.reserveAdded)}</span>,
            this cover&apos;s worst case.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line bg-page/70 px-5 py-4 text-[12px] text-ink-3 sm:px-7">
        <span>Buyer</span>
        <AddressPill address={data.user} flagTeam />
        <Tx hash={data.txHash} timestamp={data.timestamp} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ 5. The claim

const IST = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const istTime = (unixSeconds: number) => `${IST.format(new Date(unixSeconds * 1000))} IST`;

export function ClaimVisual({ data, stopped }: { data: TourClaim; stopped: boolean | null }) {
  if (data.state === "pending") {
    const p = data.party;
    return (
      <Card padding="none" tone="bond" className="p-5 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <DemoLabel kind="scripted" title="Our keeper pushes the gap's prices from a control file. The settle and the payout are real testnet transactions.">
            {LABELS.scriptedGap}
          </DemoLabel>
          <DemoLabel kind="replay" title={LABELS.replayMarket} />
        </div>
        {p ? (
          <>
            <p className="mt-6 font-display text-display-s text-ink">Scheduled for {istTime(p.gapAt)}</p>
            <div className="mt-5">
              <Countdown target={p.gapAt} doneLabel="Due now. This step switches to the claim when it lands." />
            </div>
            <p className="mt-6 text-[14px] leading-relaxed text-ink-2">
              Our keeper pushes a scripted Monday open through the covered accounts&apos; limits, then settles every
              account past its limit. This step reads the chain every 30 seconds and shows the real claim, with its
              transaction, as soon as it lands.
            </p>
          </>
        ) : (
          <>
            <p className="mt-6 font-display text-display-s text-ink">No claim yet, and none scheduled.</p>
            <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
              This step shows the real claim, with its transaction, as soon as a cover settles on this deployment.
            </p>
          </>
        )}
      </Card>
    );
  }

  const c = data.claim;
  const principal = c.principal;
  return (
    <Card padding="none" className="p-4 sm:p-6 lg:p-7">
      <div className="mb-4 flex flex-wrap items-center gap-2 sm:mb-5">
        {data.scripted ? (
          <DemoLabel kind="scripted" title="Prices on the replay feeds moved by our keeper's script. The settle and the payout are real testnet transactions.">
            {LABELS.scriptedGap}
          </DemoLabel>
        ) : null}
        <MarketTag market={c.market} />
        <DemoLabel kind="team" title="A team operated test cover, settled by our keeper. Anyone can call settle." />
      </div>
      <p className="num mb-4 text-[12px] text-ink-3 sm:mb-5 sm:text-[12.5px]">
        {data.agentName ? `${data.agentName}'s covered account · ` : ""}
        {formatUsdg(principal)} · {bpsPct(Math.round(Number((c.limit * 10_000n) / (principal || 1n)) / 10) * 10)} limit ·
        cover to −{bpsPct(CAP_BPS)}
      </p>
      {data.gap ? (
        <GapReplayPlayer data={data.gap} units="usdg" />
      ) : (
        <div className="grid max-w-md grid-cols-2 gap-3">
          <div className="rounded-field bg-sunken p-4">
            <p className="text-[12.5px] text-ink-3">You lose</p>
            <p className="num mt-1 text-[24px] leading-none text-ink">{formatUsdg(c.loss - c.payout)}</p>
          </div>
          <div className="rounded-field bg-bond-soft p-4">
            <p className="text-[12.5px] text-bond-ink">The bond pays</p>
            <p className="num mt-1 text-[24px] leading-none text-bond-ink">{formatUsdg(c.payout)}</p>
          </div>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line pt-4 text-[12px] text-ink-3">
        <span>Settled by {c.callerRole === "keeper" ? "our keeper" : null}</span>
        <AddressPill address={c.caller} flagTeam />
        <span>· anyone can call settle</span>
        {stopped ? (
          <Pill size="sm" tone="bond" dot>
            Agent stopped by the cover
          </Pill>
        ) : null}
        <Tx hash={c.txHash} timestamp={c.timestamp} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ 6. What's real

function Check({ children, href, external = true }: { children: ReactNode; href?: string | null; external?: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive">
        <CheckIcon size={13} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 text-[15px] leading-snug text-ink sm:text-[16px]">
        {href && external ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {children}
            <ArrowUpRightIcon size={12} className="ml-1 inline-block align-[-1px] text-ink-3" />
          </a>
        ) : href ? (
          <Link href={href} className={linkClass}>
            {children}
          </Link>
        ) : (
          children
        )}
      </span>
    </li>
  );
}

export function RealVisual({ real, decisionTx }: { real: TourReal; decisionTx: string | null }) {
  const live = deployment.markets.live.address ?? deployment.markets.replay.address;
  const { total, verified, known } = real.contracts;
  // "X of Y" only when the explorer says a contract is unverified; a lookup that timed out proves nothing either way.
  const contracts =
    verified < known
      ? `${int(verified)} of ${int(total)} contracts verified on the explorer`
      : known === total
        ? `${int(total)} contracts verified on the explorer`
        : `${int(total)} contracts on the explorer`;
  const t = real.tests;
  const tests =
    t == null
      ? null
      : t.passed != null && t.failed === 0
        ? `${int(t.passed)} Foundry tests, all passing`
        : `${int(t.total)} Foundry tests`;
  // The independent review (audit/AUDIT.md) proved no Critical finding; its known issues go in docs/SECURITY.md.
  const review = repoFile("docs/SECURITY.md");
  const codeHref = REPO_URL ?? (live ? `${addressUrl(live)}?tab=contract` : null);
  return (
    <div className="flex flex-col gap-4">
      <Card padding="none" className="p-5 sm:p-7">
        <ul className="flex flex-col divide-y divide-line">
          <Check href={live ? addressUrl(live) : null}>Live on Robinhood Chain testnet</Check>
          <Check href={addressUrl(USDG)}>Paxos USDG, in every bond, premium and claim</Check>
          <Check href="/judge#quality" external={false}>
            {contracts}
          </Check>
          {tests ? (
            <Check href={repoFile("contracts/reports/tests.txt") ?? "/judge#quality"} external={Boolean(REPO_URL)}>
              {tests}
            </Check>
          ) : null}
          <Check href={review}>Independently reviewed: 0 critical, known issues in SECURITY.md</Check>
          <Check href={decisionTx ? txUrl(decisionTx) : null}>Claude agents: trades and refusals with onchain receipts</Check>
        </ul>
      </Card>
      <div className="grid grid-cols-1 gap-2.5 sm:flex sm:flex-wrap">
        {VIDEO_URL ? (
          <ButtonLink href={VIDEO_URL} external size="lg">
            Watch the video
          </ButtonLink>
        ) : (
          // Until VIDEO_URL is set (links.ts): visibly not a link yet, and it says so.
          <span className={buttonClasses({ variant: "secondary", size: "lg", className: "cursor-default text-ink-3 before:hidden hover:translate-y-0 active:scale-100" })}>
            Watch the video <span className="text-[13px] font-normal">· coming soon</span>
          </span>
        )}
        <ButtonLink href="/market" size="lg" variant="secondary" iconRight={<ArrowRightIcon size={16} />}>
          Open the app
        </ButtonLink>
        {codeHref ? (
          <ButtonLink href={codeHref} external size="lg" variant="secondary">
            Read the code
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
