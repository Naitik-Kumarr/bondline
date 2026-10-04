import type { AgentRecord } from "@bondline/shared/record";
import Link from "next/link";
import type { ReactNode } from "react";
import { bpsPct, duration, int, pct, plural, usd, utcTime } from "@/components/market/fmt";
import { AddressPill } from "@/components/ui/AddressPill";
import { Card } from "@/components/ui/Card";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeader } from "@/components/ui/Section";

function Tile({ label, value, hint, tone = "ink" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ink" | "bond" }) {
  return (
    <div className="border-b border-r border-line p-5 sm:p-6">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className={`num mt-1.5 text-[26px] leading-none tracking-[-0.02em] sm:text-[28px] ${tone === "bond" ? "text-bond-ink" : "text-ink"}`}>
        {value}
      </dd>
      {hint ? <dd className="mt-2 text-[12.5px] leading-snug text-ink-3">{hint}</dd> : null}
    </div>
  );
}

/** A thin meter: a filled share of a lighter track of the same hue. */
function Meter({ share, tone, label }: { share: number; tone: "accent" | "bond" | "ink"; label: string }) {
  const w = Math.max(0, Math.min(1, share));
  const track = tone === "accent" ? "bg-accent-soft" : tone === "bond" ? "bg-bond-soft" : "bg-sunken-2";
  const fill = tone === "accent" ? "bg-accent" : tone === "bond" ? "bg-bond-strong" : "bg-ink-2";
  return (
    <div role="img" aria-label={label} className={`h-1.5 overflow-hidden rounded-full ${track}`}>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${(w * 100).toFixed(2)}%` }} />
    </div>
  );
}

const STATUS_TONE = { active: "positive", settled: "bond", closed: "neutral" } as const;

/** Trades and refusals by reason, time active, exposure, the worst drawdown against its limit, claims. */
export function RecordSection({ record, chart, rules }: { record: AgentRecord; chart: ReactNode; rules: ReactNode }) {
  const { activity: a, exposure: e, drawdown: d, claims: c } = record;
  const maxReason = Math.max(1, ...a.refusalsByReason.map((r) => r.count));
  return (
    <Section spacing="sm" aria-labelledby="record">
      <SectionHeader
        eyebrow="The record"
        title={<span id="record">What it did, onchain</span>}
        size="m"
        lead="Every number here is rebuilt from chain events on both markets: trades, refusals, deposits, price updates and claims."
      />

      <Reveal className="mt-8">
        <Card padding="none" className="overflow-hidden">
          <dl className="-mr-px grid grid-cols-2 lg:grid-cols-3">
            <Tile
              label="Trades"
              value={int(a.trades)}
              hint={
                <>
                  <span className="num">{int(a.buys)}</span> {plural(a.buys, "buy")},{" "}
                  <span className="num">{int(a.sells)}</span> {plural(a.sells, "sell")} ·{" "}
                  <span className="num">{usd(a.volumeUsd)}</span> traded
                </>
              }
            />
            <Tile
              label="Refusals"
              value={int(a.refusals)}
              hint={a.refusals ? "Trades its rules refused. Nothing changed." : "None: every trade was inside its rules"}
            />
            <Tile
              label="Time active"
              value={a.activeSeconds != null ? duration(a.activeSeconds) : "n/a"}
              hint={
                a.firstActionAt != null && a.lastActionAt != null ? (
                  <>
                    {utcTime(a.firstActionAt)} → {utcTime(a.lastActionAt, { date: false })}
                  </>
                ) : (
                  "No decisions yet"
                )
              }
            />
            <Tile
              label="Exposure, 95th percentile"
              value={e.p95 != null ? pct(e.p95) : "n/a"}
              hint={
                <>
                  of its <span className="num">{e.rulesMax != null ? pct(e.rulesMax, 0) : "n/a"}</span> cap ·{" "}
                  <span className="num">{int(e.observations)}</span> observations
                </>
              }
            />
            <Tile
              label="Worst drawdown"
              value={d.worst != null ? pct(d.worst) : "n/a"}
              hint={
                d.worstToLimit != null && d.limitBps != null ? (
                  d.worstToLimit >= 1 ? (
                    <>
                      past its <span className="num">{bpsPct(d.limitBps)}</span> limit:{" "}
                      <span className="num">{d.worstToLimit.toFixed(1)}×</span> the limit
                    </>
                  ) : (
                    <>
                      against a <span className="num">{bpsPct(d.limitBps)}</span> limit:{" "}
                      <span className="num">{pct(d.worstToLimit, 0)}</span> of the way there
                    </>
                  )
                ) : (
                  "No covered accounts yet"
                )
              }
            />
            <Tile
              label="Claims"
              value={int(c.count)}
              tone={c.count ? "bond" : "ink"}
              hint={
                <>
                  <span className="num">{usd(c.paidUsd, { cents: c.paidUsd % 1 !== 0 })}</span> paid from bonds
                </>
              }
            />
          </dl>
        </Card>
      </Reveal>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Reveal className="h-full">
          <Card className="h-full">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Stock share after each trade</h3>
              <span className="text-[12.5px] text-ink-3">both markets, live from the chain</span>
            </div>
            {chart}
            <p className="mt-9 text-[12.5px] leading-relaxed text-ink-3">{e.method}</p>
          </Card>
        </Reveal>
        <Reveal className="h-full" delay={0.06}>
          <Card className="h-full">
            <h3 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Refusals, by reason</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
              A trade outside the rules doesn&apos;t revert: the account emits a receipt and changes nothing.
            </p>
            {a.refusalsByReason.length === 0 ? (
              <p className="mt-6 text-[14px] text-ink-2">No refusals yet.</p>
            ) : (
              <ul className="mt-6 flex flex-col gap-4">
                {a.refusalsByReason.map((r) => (
                  <li key={r.key}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[14px]">
                      <span className="text-ink-2">{r.label}</span>
                      <span className="num text-ink">{int(r.count)}</span>
                    </div>
                    <Meter share={r.count / maxReason} tone="ink" label={`${r.count} refusals: ${r.label}`} />
                  </li>
                ))}
              </ul>
            )}
            {c.list.length > 0 ? (
              <div className="mt-8 border-t border-line pt-6">
                <h3 className="text-[15px] font-medium text-ink">Claims paid</h3>
                <ul className="mt-3 flex flex-col gap-3">
                  {c.list.map((cl) => (
                    <li key={cl.txHash} className="text-[13.5px] leading-relaxed text-ink-2">
                      <span className="num text-bond-ink">{usd(cl.payoutUsd, { cents: true })}</span> paid on a{" "}
                      <span className="num">{usd(cl.lossUsd, { cents: true })}</span> loss past a{" "}
                      <span className="num">{usd(cl.limitUsd, { cents: true })}</span> limit ({cl.market} market)
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </Reveal>
      </div>

      <Reveal className="mt-4">
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[17px] font-medium tracking-[-0.01em] text-ink">The rules it trades under</h3>
            <span className="text-[12.5px] text-ink-3">
              read from the account contracts; fixed when the cover opened, the agent can&apos;t change them
            </span>
          </div>
          <div className="mt-5">{rules}</div>
        </Card>
      </Reveal>

      {record.accounts.length > 0 ? (
        <Reveal className="mt-4">
          <Card padding="none" className="overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-7 sm:pt-7">
              <h3 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Covered accounts it trades</h3>
              <span className="text-[12.5px] text-ink-3">worst drawdown against each account&apos;s own limit</span>
            </div>
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {record.accounts.map((acc) => (
                <li key={`${acc.market}:${acc.account}`} className="grid grid-cols-1 gap-4 px-5 py-5 sm:px-7 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/account/${acc.account}`}
                        className="num text-[14px] text-ink underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60"
                      >
                        {acc.account.slice(0, 6)}…{acc.account.slice(-4)}
                      </Link>
                      {acc.market === "replay" ? <DemoLabel kind="replay" /> : <Pill size="sm" tone="accent">Live market</Pill>}
                      <Pill size="sm" dot tone={STATUS_TONE[acc.status]}>
                        {acc.status[0].toUpperCase() + acc.status.slice(1)}
                      </Pill>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                      Owner <AddressPill address={acc.user} flagTeam />
                    </div>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-[12.5px] md:grid-cols-3">
                    <div>
                      <dt className="text-ink-3">Covered</dt>
                      <dd className="num mt-1 text-[14px] text-ink">{usd(acc.principalUsd)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Limit</dt>
                      <dd className="num mt-1 text-[14px] text-ink">{bpsPct(acc.limitBps)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Decisions</dt>
                      <dd className="num mt-1 text-[14px] text-ink">{int(acc.trades + acc.refusals)}</dd>
                    </div>
                  </dl>
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12.5px]">
                      <span className="text-ink-3">
                        Worst drawdown <span className="num text-ink">{pct(acc.worstDrawdown)}</span>
                      </span>
                      <span className="num text-ink-3">limit {bpsPct(acc.limitBps)}</span>
                    </div>
                    <Meter
                      share={acc.worstDrawdownToLimit}
                      tone="bond"
                      label={`Worst drawdown ${pct(acc.worstDrawdown)}, ${pct(acc.worstDrawdownToLimit, 0)} of its ${bpsPct(acc.limitBps)} limit`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
      ) : null}
    </Section>
  );
}
