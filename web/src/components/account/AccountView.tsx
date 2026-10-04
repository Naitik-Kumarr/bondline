"use client";

import { LABELS, STOCK_SYMBOLS } from "@bondline/shared/constants";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { formatUnits, type Address } from "viem";
import { AddressPill } from "@/components/ui/AddressPill";
import { AgentMark } from "@/components/ui/AgentMark";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { AlertIcon, ReplayIcon } from "@/components/ui/icons";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { Accent } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { formatBps } from "@/lib/format";
import { usdg as fmtUsdg } from "@/lib/bondline/format";
import { OwnerCard, SettleCard } from "./AccountActions";
import { BadgeEmbed } from "./BadgeEmbed";
import { HealthGauge } from "./HealthGauge";
import { agentName, formatAge } from "./kit/bondline";
import { Pct, Usd } from "./kit/Money";
import { useAccountData, type AccountData } from "./useAccountData";

const STATUS_TONE = { Active: "positive", Settled: "bond", Closed: "neutral", None: "neutral" } as const;

/** Ticks once a second so price ages read true between polls. */
function useNow() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function Freshness({ data }: { data: AccountData }) {
  const now = useNow();
  if (data.stockValue === 0n) return <Pill size="sm" tone="neutral">All cash</Pill>;
  const age = Math.max(0, Math.round(now - data.oldestUpdate));
  return (
    <Pill
      size="sm"
      dot
      tone={data.fresh ? "positive" : "caution"}
      title={`The market accepts prices up to ${formatAge(data.market.maxPriceAge)} old for settle and withdraw.`}
    >
      {data.fresh ? "Prices fresh" : "Prices stale"} · <span className="num">{formatAge(age)}</span> old
    </Pill>
  );
}

function Holdings({ data }: { data: AccountData }) {
  const share = data.value > 0n ? Number((data.stockValue * 10_000n) / data.value) : 0;
  return (
    <Card>
      <h2 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Holdings</h2>
      <p className="mt-1 text-[13px] text-ink-3">At the oracle prices the cover uses.</p>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        <li className="flex items-center justify-between gap-4 py-3">
          <span className="text-[14.5px] text-ink">Cash</span>
          <span className="num text-[15px] text-ink">
            <Usd amount={data.cash} />
          </span>
        </li>
        {data.holdings.map((h) => (
          <li key={h.token} className="flex items-center justify-between gap-4 py-3">
            <span className="min-w-0 text-[14.5px] text-ink">
              {h.symbol}{" "}
              <span className="num text-[12.5px] text-ink-3">
                {Number(formatUnits(h.balance, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })} sh
                {h.price !== undefined ? ` @ $${Number(formatUnits(h.price, 8)).toFixed(2)}` : ""}
              </span>
            </span>
            <span className="num text-[15px] text-ink">{h.value !== undefined ? <Usd amount={h.value} /> : "No price"}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-ink-3">In stocks</span>
          <span className="num text-ink-2">
            {formatBps(share)} <span className="text-ink-3">of a {formatBps(data.rules.maxStockBps)} cap</span>
          </span>
        </div>
        <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-sunken-2" aria-hidden="true">
          <div
            className="absolute inset-0 origin-left rounded-full bg-accent transition-transform duration-[var(--duration-spring)] ease-spring motion-reduce:transition-none"
            style={{ transform: `scaleX(${Math.min(1, share / 10_000)})` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-ink/40"
            style={{ left: `${Math.min(100, data.rules.maxStockBps / 100)}%` }}
          />
        </div>
      </div>
    </Card>
  );
}

function RulesCard({ data }: { data: AccountData }) {
  const stocks = STOCK_SYMBOLS.filter((_, i) => (data.rules.assetMask & (1 << i)) !== 0).join(", ") || "None";
  const rows: [string, string][] = [
    ["Stocks", stocks],
    ["Most in stocks", formatBps(data.rules.maxStockBps)],
    ["Largest trade", `${formatBps(data.rules.maxTradeBps)} of value`],
    ["Traded per day", `${formatBps(data.rules.maxDailyBps)} of value`],
    ["Worst fill", `${formatBps(data.rules.maxSlippageBps)} below the oracle`],
    ["Oldest price", formatAge(data.rules.maxPriceAge)],
  ];
  return (
    <Card>
      <h2 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Rules every trade must pass</h2>
      <p className="mt-1 text-[13px] text-ink-3">
        Fixed on-chain when the cover opened. A trade outside them is refused and recorded.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3.5">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[12.5px] text-ink-3">{k}</dt>
            <dd className="num mt-0.5 text-[14.5px] text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function RefreshReceipts() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink"
      aria-busy={pending || undefined}
    >
      <ReplayIcon size={14} className={cn(pending && "animate-spin motion-reduce:animate-none")} />
      {pending ? "Refreshing" : "Refresh"}
    </button>
  );
}

function Loading() {
  return (
    <Container className="pt-12 sm:pt-16" aria-busy="true" aria-label="Loading the account">
      <Skeleton className="h-3 w-32" rounded="sm" />
      <div className="mt-5 flex items-center gap-4">
        <Skeleton className="size-[52px]" rounded="lg" />
        <div>
          <Skeleton className="h-9 w-72 max-w-[60vw]" rounded="sm" />
          <Skeleton className="mt-3 h-6 w-56" rounded="full" />
        </div>
      </div>
      <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <Skeleton className="h-4 w-16" rounded="sm" />
          <Skeleton className="mt-3 h-11 w-52" rounded="sm" />
          <Skeleton className="mt-8 h-11" rounded="lg" />
          <Skeleton className="mt-6 h-12" rounded="md" />
        </Card>
        <Card>
          <Skeleton className="h-3 w-28" rounded="sm" />
          <Skeleton className="mt-4 h-8 w-32" rounded="sm" />
          <Skeleton className="mt-6 h-12" rounded="full" />
        </Card>
      </div>
    </Container>
  );
}

export function AccountView({
  account,
  receipts,
  history,
  settledPayout,
  letter,
}: {
  account: Address;
  receipts: ReactNode;
  history: ReactNode;
  /** Server-rendered amount the bond paid, shown in the gauge once the account is settled. */
  settledPayout?: ReactNode;
  /** The claim letter, when this account has a verified one. */
  letter?: ReactNode;
}) {
  const { data, invalid, error } = useAccountData(account);

  if (invalid) {
    return (
      <Container size="narrow" className="py-20 text-center sm:py-28">
        <p className="eyebrow">Covered account</p>
        <h1 className="mt-4 font-display text-display-m text-ink">Not a Bondline account.</h1>
        <p className="mx-auto mt-4 max-w-[30rem] text-[16px] leading-relaxed text-ink-2">
          This address isn&apos;t an account covered by an offer on either Bondline market. Check the link, or open a
          cover of your own.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/cover">Get cover</ButtonLink>
          <ButtonLink href="/market" variant="secondary">
            The market
          </ButtonLink>
        </div>
      </Container>
    );
  }
  if (!data) {
    if (error) {
      return (
        <Container className="pt-12 sm:pt-16">
          <Card tone="sunken" className="flex items-start gap-3" role="alert">
            <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
            <p className="text-[15px] text-ink-2">Couldn&apos;t read this account from the chain. It retries every few seconds.</p>
          </Card>
        </Container>
      );
    }
    return <Loading />;
  }

  const change = data.value - data.principal;
  const changeFrac = data.principal > 0n ? Number(change) / Number(data.principal) : 0;
  const statusLabel =
    data.status === "Active" && data.settleable ? "Past its limit" : data.status === "Active" && data.paused ? "Active · agent paused" : data.status;

  return (
    <>
      <Container className="pt-12 sm:pt-16">
        <p className="eyebrow">Covered account</p>
        <div className="mt-4 flex items-start gap-4">
          <AgentMark address={data.agent} size={52} className="mt-1 hidden sm:block" />
          <div className="min-w-0">
            <h1 className="font-display text-display-m text-ink">
              Traded by <Accent>{agentName(data.agent)}</Accent>
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill size="sm" dot tone={data.settleable && data.status === "Active" ? "bond" : STATUS_TONE[data.status]}>
                {statusLabel}
              </Pill>
              <AddressPill address={account} copy />
              {data.market.key === "replay" ? (
                <DemoLabel kind="replay" title={data.market.note} />
              ) : (
                <Pill size="sm" tone="neutral">
                  Live market
                </Pill>
              )}
            </div>
          </div>
        </div>
        <p className="mt-4 max-w-[46rem] text-[13px] leading-relaxed text-ink-3">
          Covered by the offer &ldquo;{data.terms.name}&rdquo;
          {data.offerId !== undefined ? ` (#${data.offerId})` : ""} on the {data.market.label} market. {data.market.note}{" "}
          {LABELS.notInsurance}
        </p>
      </Container>

      <Container className="mt-8 sm:mt-10">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
          <div className="flex min-w-0 flex-col gap-5">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[13px] text-ink-3">Value</div>
                  <div className="num mt-1.5 text-[40px] leading-none tracking-[-0.03em] text-ink sm:text-[48px]">
                    <Usd amount={data.value} />
                  </div>
                  <div className="mt-2.5 text-[13.5px] text-ink-3">
                    Principal <span className="num text-ink-2">${fmtUsdg(data.principal)}</span> ·{" "}
                    <span className={cn("num", change < 0n ? "text-negative" : change > 0n ? "text-positive" : "text-ink-2")}>
                      <Usd amount={change} signed /> (<Pct value={changeFrac} digits={2} signed />)
                    </span>
                  </div>
                </div>
                <Freshness data={data} />
              </div>
              {data.status === "Settled" ? (
                <p className="mt-6 rounded-card bg-bond-tint px-4 py-3 text-[13.5px] leading-relaxed text-bond-ink">
                  Settled: the AI is stopped, and the bond paid the owner the loss beyond the limit, once (see History
                  below). The stocks stay in the account until the owner sweeps.
                </p>
              ) : data.status === "Closed" ? (
                <p className="mt-6 rounded-card bg-sunken px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
                  Closed by the owner: the cover has ended and the AI is stopped. Nothing more is paid on it.
                </p>
              ) : null}
              <div className="mt-8">
                <HealthGauge
                  principal={data.principal}
                  loss={data.loss}
                  limit={data.limit}
                  limitBps={data.limitBps}
                  payoutNow={data.payoutNow}
                  paid={data.status === "Settled" ? settledPayout : undefined}
                />
              </div>
            </Card>
            <div className="grid gap-5 md:grid-cols-2">
              <Holdings data={data} />
              <RulesCard data={data} />
            </div>

            <section aria-labelledby="receipts" className="mt-6">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 id="receipts" className="font-display text-display-s text-ink">
                    Receipts
                  </h2>
                  <p className="mt-1.5 text-[14px] text-ink-3">
                    Completed trades and rule-check refusals, with the submitted decision from the transaction input.
                    Off-chain holds are not shown.
                  </p>
                </div>
                <RefreshReceipts />
              </div>
              {receipts}
            </section>
            <section aria-labelledby="history" className="mt-4">
              <h2 id="history" className="mb-4 font-display text-display-s text-ink">
                History
              </h2>
              {history}
            </section>
            {letter}
          </div>

          <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-24">
            <SettleCard account={account} data={data} />
            <OwnerCard account={account} data={data} />
            <BadgeEmbed account={account} />
            <p className="px-1 text-[12px] leading-relaxed text-ink-3">
              Underwritten by <AddressPill address={data.underwriter} flagTeam className="align-middle" />. Their bond
              reserves <span className="num">${fmtUsdg(data.reserve)}</span> for this account&apos;s worst case.
            </p>
          </div>
        </div>
      </Container>
    </>
  );
}
