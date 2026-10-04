"use client";

import { agentAccountAbi, bondlineCoverAbi } from "@bondline/shared/abis";
import { USDG } from "@bondline/shared/constants";
import { useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount } from "wagmi";
import { AddressPill } from "@/components/ui/AddressPill";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AlertIcon } from "@/components/ui/icons";
import { NetworkGuard } from "@/components/ui/NetworkGuard";
import { Pill } from "@/components/ui/Pill";
import { TxStatus } from "@/components/ui/TxStatus";
import { cn } from "@/lib/cn";
import { formatBps } from "@/lib/format";
import { usdg as fmtUsdg } from "@/lib/bondline/format";
import { TOKEN_ERRORS } from "./kit/bondline";
import { ConnectButton } from "./kit/ConnectPrompt";
import { Field, NumberInput } from "./kit/Fields";
import { Usd } from "./kit/Money";
import { useTx } from "./kit/useTx";
import type { AccountData } from "./useAccountData";
import { limitOf, parseUsdg, payoutCapOf, principalAfterWithdraw } from "@/components/cover/math";

const coverAbi = [...bondlineCoverAbi, ...TOKEN_ERRORS] as const;
const accountAbi = [...agentAccountAbi, ...TOKEN_ERRORS] as const;

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[15.5px] font-medium text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

const note = "text-[13px] leading-relaxed text-ink-3";

/** Settle: open to anyone the moment the loss passes the limit, at fresh prices. */
export function SettleCard({ account, data }: { account: Address; data: AccountData }) {
  const { isConnected } = useAccount();
  const tx = useTx();
  const reason =
    data.status !== "Active"
      ? `This cover is ${data.status.toLowerCase()}: it can be settled only once, while active.`
      : !data.fresh
        ? "Prices are too old right now: settle needs fresh prices for every stock the account holds."
        : !data.settleable
          ? "The loss is within the limit, so there is nothing to settle."
          : null;
  return (
    <Card tone={data.settleable ? "bond" : "surface"}>
      <p className="eyebrow">Anyone can settle</p>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-[13px] text-ink-3">The bond would pay now</div>
          <div className="num mt-1 text-[30px] leading-none tracking-[-0.02em] text-bond-ink">
            <Usd amount={data.payoutNow} />
          </div>
        </div>
        {data.settleable ? (
          <Pill tone="bond" dot size="sm">
            Past its limit
          </Pill>
        ) : null}
      </div>
      <p className={cn(note, "mt-4")}>
        Once the loss passes the limit, anyone can call settle. It stops the agent and pays once only if the required
        prices are fresh and the USDG transfer succeeds: the owner gets the loss beyond the limit from the bond, up to a
        30% drop. USDG pause/freeze controls and unsolicited listed stock dust can block settlement in the current code.
        The keeper attempts settlement while it is running; transaction latency, stale prices and failed transfers can
        delay it. The owner can still stop the agent with pause or end cover with close. The stocks stay in the account.
      </p>
      <div className="mt-5">
        {!isConnected ? (
          <ConnectButton variant="secondary" className="w-full">
            Connect to settle
          </ConnectButton>
        ) : (
          <NetworkGuard>
            <Button
              variant="bond"
              size="lg"
              className="w-full"
              disabled={!data.settleable}
              loading={tx.busy}
              loadingLabel="Settling"
              onClick={() => tx.send({ address: data.cover, abi: coverAbi, functionName: "settle", args: [account] })}
            >
              {data.settleable ? `Settle and pay $${fmtUsdg(data.payoutNow)}` : "Settle"}
            </Button>
          </NetworkGuard>
        )}
        {reason && tx.state === "idle" ? <p className="mt-2.5 text-[12.5px] text-ink-3">{reason}</p> : null}
        <TxStatus state={tx.state} hash={tx.hash} error={tx.error} label="Settle" successLabel="Settled: the bond paid out" className="mt-3" />
      </div>
    </Card>
  );
}

function PauseResume({ account, data }: { account: Address; data: AccountData }) {
  const tx = useTx();
  const [action, setAction] = useState<"pause" | "resume">("pause");
  const state = data.stopped ? "Stopped" : data.paused ? "Paused" : "Trading";
  return (
    <Section
      title="The agent"
      aside={
        <Pill size="sm" dot tone={data.stopped ? "neutral" : data.paused ? "caution" : "positive"}>
          {state}
        </Pill>
      }
    >
      <p className={note}>
        {data.stopped
          ? "Stopped for good by the settle or close. It can't trade this account again."
          : "Pause stops the agent from trading until you resume. The cover stays active."}
      </p>
      {!data.stopped ? (
        <Button
          variant="secondary"
          className="mt-3"
          loading={tx.busy}
          loadingLabel={data.paused ? "Resuming" : "Pausing"}
          onClick={() => {
            const next = data.paused ? "resume" : "pause";
            setAction(next);
            void tx.send({ address: account, abi: accountAbi, functionName: next });
          }}
        >
          {data.paused ? "Resume the agent" : "Pause the agent"}
        </Button>
      ) : null}
      <TxStatus
        state={tx.state}
        hash={tx.hash}
        error={tx.error}
        label={action === "pause" ? "Pause" : "Resume"}
        successLabel={action === "pause" ? "Agent paused" : "Agent resumed"}
        className="mt-3"
      />
    </Section>
  );
}

function Withdraw({ account, data }: { account: Address; data: AccountData }) {
  const tx = useTx();
  const [text, setText] = useState("");
  const amount = parseUsdg(text);
  const over = amount !== null && amount > data.cash;
  const okAmount = amount !== null && amount > 0n && !over;
  const nextPrincipal = okAmount ? principalAfterWithdraw(data.principal, data.value, amount!) : undefined;
  const active = data.status === "Active";
  return (
    <Section title="Withdraw cash">
      <p className={note}>
        Needs fresh prices: the contract values the account first. Your covered principal shrinks by the share of value
        you take out, so your limit and what the bond can pay shrink in proportion; a withdrawal can never raise a
        payout. Only cash comes out; the stocks stay with the agent.
      </p>
      <Field
        className="mt-3"
        label={<span className="sr-only">Amount to withdraw</span>}
        htmlFor="withdraw"
        aside={
          <button
            type="button"
            className="num text-ink-2 underline decoration-ink/20 underline-offset-4 hover:text-ink"
            onClick={() => setText(formatUnits(data.cash, 6))}
          >
            Cash {fmtUsdg(data.cash)} USDG
          </button>
        }
        error={over ? "More than the account's cash." : undefined}
      >
        <NumberInput id="withdraw" value={text} onChange={setText} unit="USDG" placeholder="0.00" invalid={over} />
      </Field>
      {nextPrincipal !== undefined ? (
        <p className="num mt-2 text-[12.5px] leading-relaxed text-ink-3">
          After: principal ${fmtUsdg(nextPrincipal)} · limit ${fmtUsdg(limitOf(nextPrincipal, data.limitBps))} · the bond
          pays up to ${fmtUsdg(payoutCapOf(nextPrincipal, data.limitBps))}
        </p>
      ) : null}
      <Button
        variant="secondary"
        className="mt-3"
        disabled={!active || !data.fresh || !okAmount}
        loading={tx.busy}
        loadingLabel="Withdrawing"
        onClick={async () => {
          if (!amount) return;
          const r = await tx.send({ address: data.cover, abi: coverAbi, functionName: "withdraw", args: [account, amount] });
          if (r) setText("");
        }}
      >
        Withdraw
      </Button>
      {active && !data.fresh ? (
        <p className="mt-2 text-[12.5px] text-caution">Prices are too old right now; withdraw needs fresh ones.</p>
      ) : null}
      <TxStatus state={tx.state} hash={tx.hash} error={tx.error} label="Withdraw" successLabel="Withdrawn to your wallet" className="mt-3" />
    </Section>
  );
}

/** `tx` lives in OwnerCard so the "Cover closed" confirmation survives the switch to the closed view. */
function Close({ account, data, tx }: { account: Address; data: AccountData; tx: ReturnType<typeof useTx> }) {
  const [confirming, setConfirming] = useState(false);
  if (data.status !== "Active") return null;
  return (
    <Section title="Close the cover">
      <p className={note}>
        Ends the cover now: the agent stops for good, the bond&apos;s reservation for this account is freed, and you give
        up any payout not yet settled. It moves no tokens and works at any price, even if USDG is paused. Then sweep to
        take everything out.
      </p>
      {confirming ? (
        <div className="mt-3 rounded-card bg-negative-soft/60 p-4">
          {data.settleable ? (
            <p className="mb-3 flex items-start gap-2 text-[13.5px] text-negative">
              <AlertIcon size={15} className="mt-0.5 shrink-0" />
              <span>
                The loss is past your limit right now: settling would pay you ${fmtUsdg(data.payoutNow)}. Closing gives
                that up.
              </span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              loading={tx.busy}
              loadingLabel="Closing"
              onClick={async () => {
                const r = await tx.send({ address: data.cover, abi: coverAbi, functionName: "close", args: [account] });
                if (r) setConfirming(false);
              }}
            >
              Yes, close the cover
            </Button>
            <Button variant="ghost" disabled={tx.busy} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" className="mt-3" onClick={() => setConfirming(true)}>
          Close the cover
        </Button>
      )}
      <TxStatus state={tx.state} hash={tx.hash} error={tx.error} label="Close" successLabel="Cover closed" className="mt-3" />
    </Section>
  );
}

function Sweep({ account, data }: { account: Address; data: AccountData }) {
  const all = useTx();
  const one = useTx();
  const [which, setWhich] = useState<string | null>(null);
  const tokens = [
    { token: USDG, symbol: "USDG", amount: `${fmtUsdg(data.usdgBalance)}`, has: data.usdgBalance > 0n },
    ...data.holdings.map((h) => ({
      token: h.token,
      symbol: h.symbol,
      amount: Number(formatUnits(h.balance, 18)).toLocaleString("en-US", { maximumFractionDigits: 6 }),
      has: h.balance > 0n,
    })),
  ];
  const anything = tokens.some((t) => t.has);
  if (!data.released) {
    return (
      <Section title="Sweep">
        <p className={note}>After a settle or close, you take everything out: the USDG and every stock.</p>
      </Section>
    );
  }
  return (
    <Section title="Sweep">
      <p className={note}>
        The cover has {data.status === "Settled" ? "settled" : "closed"}, so the account is yours to empty: the USDG and
        every stock go to your wallet.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {tokens.map((t) => (
          <li key={t.token} className="flex items-center justify-between gap-3 text-[13.5px]">
            <span className="text-ink-2">{t.symbol}</span>
            <span className="flex items-center gap-3">
              <span className="num text-ink">{t.amount}</span>
              <button
                type="button"
                disabled={!t.has || one.busy || all.busy}
                onClick={async () => {
                  setWhich(t.symbol);
                  await one.send({ address: account, abi: accountAbi, functionName: "sweepToken", args: [t.token] });
                }}
                className="text-[12.5px] text-ink-3 underline decoration-ink/20 underline-offset-4 hover:text-ink disabled:no-underline disabled:opacity-40"
              >
                Only this
              </button>
            </span>
          </li>
        ))}
      </ul>
      <Button
        className="mt-4 w-full"
        disabled={!anything || one.busy}
        loading={all.busy}
        loadingLabel="Sweeping"
        onClick={() => all.send({ address: account, abi: accountAbi, functionName: "sweep" })}
      >
        {anything ? "Take everything out" : "Nothing left to sweep"}
      </Button>
      <p className="mt-2 text-[12px] text-ink-3">&ldquo;Only this&rdquo; takes one token, useful if another is paused.</p>
      <TxStatus state={all.state} hash={all.hash} error={all.error} label="Sweep" successLabel="Swept to your wallet" className="mt-3" />
      <TxStatus state={one.state} hash={one.hash} error={one.error} label={`Sweep ${which ?? ""}`} successLabel={`Swept ${which ?? ""}`} className="mt-3" />
    </Section>
  );
}

/** The owner's controls; anyone else sees who the owner is. */
export function OwnerCard({ account, data }: { account: Address; data: AccountData }) {
  const { address, isConnected } = useAccount();
  const closeTx = useTx();
  const isOwner = Boolean(address && address.toLowerCase() === data.owner.toLowerCase());
  return (
    <Card>
      <p className="eyebrow">Your controls</p>
      {!isOwner ? (
        <div className="mt-3">
          <p className="text-[14px] leading-relaxed text-ink-2">
            Only the account&apos;s owner can pause the agent, withdraw, close the cover or sweep.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
            Owner <AddressPill address={data.owner} flagTeam />
          </div>
          {!isConnected ? <ConnectButton variant="secondary" className="mt-4">Connect as the owner</ConnectButton> : null}
        </div>
      ) : (
        <NetworkGuard className="mt-4">
          <div className="mt-4 flex flex-col gap-5">
            {data.status === "Active" ? (
              <>
                <PauseResume account={account} data={data} />
                <Withdraw account={account} data={data} />
                <Close account={account} data={data} tx={closeTx} />
                <Sweep account={account} data={data} />
              </>
            ) : (
              <>
                {closeTx.state !== "idle" ? (
                  <TxStatus
                    state={closeTx.state}
                    hash={closeTx.hash}
                    error={closeTx.error}
                    label="Close"
                    successLabel="Cover closed"
                  />
                ) : null}
                <Sweep account={account} data={data} />
                <PauseResume account={account} data={data} />
              </>
            )}
          </div>
        </NetworkGuard>
      )}
      <p className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-3">
        Limit {formatBps(data.limitBps)} of principal. The agent can only trade, inside its rules; it can never
        withdraw.
      </p>
    </Card>
  );
}
