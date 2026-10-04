"use client";

import { bondlineCoverAbi, usdgAbi } from "@bondline/shared/abis";
import { robinhoodTestnet } from "@bondline/shared/chain";
import { CAP_BPS, MIN_DEPOSIT, USDG } from "@bondline/shared/constants";
import { keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { parseEventLogs, type Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/icons";
import { NetworkGuard } from "@/components/ui/NetworkGuard";
import { AddressPill } from "@/components/ui/AddressPill";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { TxStatus } from "@/components/ui/TxStatus";
import { cn } from "@/lib/cn";
import { formatBps } from "@/lib/format";
import type { Rules } from "@/lib/bondline/actions";
import { usdg as fmtUsdg } from "@/lib/bondline/format";
import { agentName, marketByKey, TOKEN_ERRORS } from "@/components/account/kit/bondline";
import { CheckList, CheckRow } from "@/components/account/kit/Checks";
import { FundsChecks } from "@/components/account/kit/FundsChecks";
import { ConnectButton } from "@/components/account/kit/ConnectPrompt";
import { Usd } from "@/components/account/kit/Money";
import type { LiveOffer } from "@/components/account/kit/useOffers";
import { useTx } from "@/components/account/kit/useTx";
import { useWalletFunds } from "@/components/account/kit/useWalletFunds";
import { fits, maxDeposit, quoteDeposit } from "./math";

const coverWithTokenErrors = [...bondlineCoverAbi, ...TOKEN_ERRORS] as const;
const usdgWithErrors = [...usdgAbi, ...TOKEN_ERRORS] as const;

function StepDot({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="num inline-flex size-5 items-center justify-center rounded-full bg-white/15 text-[11px] text-white"
    >
      {n}
    </span>
  );
}

function Line({
  label,
  detail,
  value,
  strong,
  tone,
}: {
  label: React.ReactNode;
  detail?: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  tone?: "bond";
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className={cn("text-[14px]", strong ? "font-medium text-ink" : "text-ink-2")}>{label}</div>
        {detail ? <div className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{detail}</div> : null}
      </div>
      <div
        className={cn(
          "num shrink-0 text-right text-[15px]",
          strong ? "text-[17px] text-ink" : "text-ink",
          tone === "bond" && "text-bond-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The cover before anyone signs: the exact premium (quoted by the contract), the limit in dollars, what the bond
 * pays, every check (USDG's issuer controls, funds, the offer's capacity), then approve exactly the deposit and open.
 */
export function CoverSummary({
  offer,
  limitBps,
  rules,
  rulesError,
  amount,
  amountText,
  onOpened,
}: {
  offer: LiveOffer;
  limitBps: number;
  rules: Rules;
  rulesError: string | null;
  amount: bigint | null;
  amountText: string;
  onOpened: (account: Address) => void;
}) {
  const { address, isConnected } = useAccount();
  const funds = useWalletFunds(address);
  const approveTx = useTx();
  const openTx = useTx();
  const [opened, setOpened] = useState<{ account: Address; hash: string } | null>(null);
  const market = marketByKey(offer.market);

  // The live state of this offer, fresher than the board.
  const live = useReadContracts({
    contracts: [
      { address: offer.cover, abi: bondlineCoverAbi, functionName: "free", chainId: robinhoodTestnet.id },
      { address: offer.cover, abi: bondlineCoverAbi, functionName: "listed", chainId: robinhoodTestnet.id },
    ],
    allowFailure: false,
    query: { refetchInterval: 10_000 },
  });
  const free = live.data?.[0] ?? offer.free;
  const listed = live.data?.[1] ?? offer.listed;

  const amountOk = amount !== null && amount >= MIN_DEPOSIT;
  const quoteQ = useReadContract({
    address: offer.cover,
    abi: bondlineCoverAbi,
    functionName: "quoteDeposit",
    args: [amount ?? 0n, limitBps],
    chainId: robinhoodTestnet.id,
    query: { enabled: amountOk, placeholderData: keepPreviousData },
  });
  const local = quoteDeposit(amount ?? 0n, offer.terms.feeBps, limitBps);
  const exact =
    quoteQ.data && amountOk && quoteQ.data[1] === local.net
      ? { ...local, fee: quoteQ.data[0], net: quoteQ.data[1], reserveNeeded: quoteQ.data[2] }
      : local;
  const q = amountOk ? exact : undefined;

  const allowanceQ = useReadContract({
    address: USDG,
    abi: usdgAbi,
    functionName: "allowance",
    args: [address ?? "0x0000000000000000000000000000000000000000", offer.cover],
    chainId: robinhoodTestnet.id,
    query: { enabled: Boolean(address) },
  });
  const allowance = allowanceQ.data;
  // Exactly the deposit, never more: a bigger leftover approval is reset to the exact amount first.
  const approved = amountOk && allowance !== undefined && allowance === amount!;

  const capacityOk = q ? fits(q, free) : true;
  const room = maxDeposit(free, offer.terms.feeBps, limitBps);
  const balanceOk = amountOk && funds.usdg !== undefined && funds.usdg >= amount!;
  const gasOk = funds.eth === undefined || funds.eth > 0n;
  const blocked = Boolean(funds.problem);
  const ready =
    isConnected && amountOk && !rulesError && listed && capacityOk && balanceOk && gasOk && !blocked && !funds.checking;

  const approve = async () => {
    if (!amount) return;
    openTx.reset();
    await approveTx.send({ address: USDG, abi: usdgWithErrors, functionName: "approve", args: [offer.cover, amount] });
    void allowanceQ.refetch();
  };

  const open = async () => {
    if (!amount) return;
    const receipt = await openTx.send({
      address: offer.cover,
      abi: coverWithTokenErrors,
      functionName: "open",
      args: [limitBps, rules, amount],
    });
    if (!receipt) return;
    const [ev] = parseEventLogs({ abi: bondlineCoverAbi, logs: receipt.logs, eventName: "Opened" });
    if (ev) {
      setOpened({ account: ev.args.account, hash: receipt.transactionHash });
      onOpened(ev.args.account);
    }
  };

  if (opened) {
    return (
      <Card className="overflow-hidden">
        <div aria-hidden="true" className="glow-hero pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-positive-soft text-positive">
            <CheckIcon size={20} strokeWidth={2} />
          </span>
          <h2 className="mt-5 font-display text-display-s text-ink">Your cover is open.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            {agentName(offer.agent)} now trades your covered account inside your rules. Past your {formatBps(limitBps)}{" "}
            limit, anyone can call settle. It stops the agent and pays once only if the required prices are fresh and the
            USDG transfer succeeds: the loss beyond your limit, up to a 30% drop, in USDG.
          </p>
          <div className="mt-5">
            <AddressPill address={opened.account} label="Covered account" copy />
          </div>
          <TxStatus state="success" hash={opened.hash} successLabel="Cover opened" className="mt-5" />
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href={`/account/${opened.account}`} iconRight={<ArrowRightIcon size={15} />}>
              Go to your account
            </ButtonLink>
            <Button
              variant="secondary"
              onClick={() => {
                setOpened(null);
                approveTx.reset();
                openTx.reset();
              }}
            >
              Buy another cover
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Your cover</p>
          <h2 className="mt-2 truncate text-[19px] font-medium tracking-[-0.01em] text-ink">{offer.terms.name}</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            Behind {agentName(offer.agent)} · {market?.label} market
          </p>
        </div>
        {offer.market === "replay" ? <DemoLabel kind="replay" title={market?.note} /> : null}
      </div>

      <div className="mt-4 divide-y divide-line border-y border-line">
        <Line label="Deposit" value={amountOk ? <Usd amount={amount!} /> : "—"} />
        <Line
          label={`Premium · ${formatBps(offer.terms.feeBps)}`}
          detail="Paid once, from the deposit, to the underwriter's bond"
          value={q ? <Usd amount={-q.fee} /> : "—"}
        />
        <Line label="Into your covered account" strong value={q ? <Usd amount={q.net} /> : "—"} />
        <Line
          label={`Your loss limit · ${formatBps(limitBps)}`}
          detail="You carry the loss up to this"
          value={q ? <Usd amount={q.limitUsd} /> : "—"}
        />
        <Line
          label="The bond pays, past your limit"
          detail={`The loss beyond your limit, up to a ${CAP_BPS / 100}% drop`}
          tone="bond"
          value={q ? <>up to <Usd amount={q.maxPayout} /></> : "—"}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Pill tone="bond" size="sm">
          Cover up to a 30% drop
        </Pill>
        <Pill tone="accent" size="sm">
          Paid in USDG
        </Pill>
      </div>

      <div className="mt-6">
        <p className="eyebrow mb-3">Before you sign</p>
        <CheckList>
          {!isConnected ? (
            <CheckRow state="info" title="Connect a wallet to run the checks." />
          ) : (
            <FundsChecks funds={funds} need={amountOk ? amount : null} needWhat="this deposit" />
          )}
          {!amountOk ? (
            <CheckRow
              state="problem"
              title={amountText === "" ? "Enter a deposit" : "The smallest deposit is 1 USDG"}
            />
          ) : null}
          {!listed ? <CheckRow state="problem" title="This offer is delisted: it takes no new cover." /> : null}
          {q ? (
            <CheckRow
              state={capacityOk ? "ok" : "problem"}
              title={
                capacityOk ? (
                  "The bond can back this deposit's worst case"
                ) : (
                  <>This offer is full for this deposit</>
                )
              }
              detail={
                <>
                  Needs <span className="num">${fmtUsdg(q.reserveNeeded)}</span> of free bond; it has{" "}
                  <span className="num">${fmtUsdg(free)}</span>, plus your premium.
                  {!capacityOk && room !== null && room >= MIN_DEPOSIT ? (
                    <>
                      {" "}
                      At this limit it can take up to <span className="num">${fmtUsdg(room)}</span>.
                    </>
                  ) : null}
                </>
              }
            />
          ) : null}
          {rulesError ? <CheckRow state="problem" title={rulesError} /> : null}
        </CheckList>
      </div>

      <div className="mt-6">
        {!isConnected ? (
          <ConnectButton size="lg" className="w-full" />
        ) : (
          <NetworkGuard>
            <ol className="flex flex-col gap-3">
              <li>
                <Button
                  size="lg"
                  variant={approved ? "secondary" : "primary"}
                  className="w-full"
                  disabled={!ready || approved || approveTx.busy || openTx.busy}
                  loading={approveTx.busy}
                  loadingLabel="Approving"
                  icon={approved ? <CheckIcon size={16} className="text-positive" /> : <StepDot n={1} />}
                  onClick={approve}
                >
                  {approved && amountOk
                    ? `Approved ${fmtUsdg(amount!)} USDG`
                    : `Approve exactly ${amountOk ? fmtUsdg(amount!) : "0.00"} USDG`}
                </Button>
              </li>
              <li>
                <Button
                  size="lg"
                  className="w-full"
                  disabled={!ready || !approved || openTx.busy}
                  loading={openTx.busy}
                  loadingLabel="Opening the cover"
                  icon={<StepDot n={2} />}
                  onClick={open}
                >
                  Open cover
                </Button>
              </li>
            </ol>
            <p className="mt-3 text-[12.5px] leading-snug text-ink-3">
              The approval is for this deposit only, never unlimited. Opening moves it into a new account that only
              the agent can trade and only you can take money out of.
            </p>
            <TxStatus
              state={approveTx.state}
              hash={approveTx.hash}
              error={approveTx.error}
              label={amountOk ? `exactly ${fmtUsdg(amount!)} USDG, for this deposit` : "Approve"}
              successLabel="Approved"
              className="mt-4"
            />
            <TxStatus state={openTx.state} hash={openTx.hash} error={openTx.error} label="Open cover" className="mt-3" />
          </NetworkGuard>
        )}
      </div>
    </Card>
  );

}
