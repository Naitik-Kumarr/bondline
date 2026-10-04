import { FAUCET_URL, USDG_FAUCET_URL } from "@bondline/shared/chain";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { AlertIcon, ArrowUpRightIcon, CheckIcon, Spinner } from "@/components/ui/icons";

export type CheckState = "ok" | "problem" | "wait" | "info";

/** "Before you sign": one row per check, each with a plain explanation. */
export function CheckList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("flex flex-col gap-3", className)}>{children}</ul>;
}

export function CheckRow({ state, title, detail }: { state: CheckState; title: ReactNode; detail?: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full",
          state === "ok" && "bg-positive-soft text-positive",
          state === "problem" && "bg-caution-soft text-caution",
          state === "wait" && "text-ink-3",
          state === "info" && "bg-sunken text-ink-3",
        )}
      >
        {state === "ok" ? (
          <CheckIcon size={12} strokeWidth={2.2} />
        ) : state === "problem" ? (
          <AlertIcon size={12} strokeWidth={2} />
        ) : state === "wait" ? (
          <Spinner size={13} />
        ) : (
          <span className="size-1.5 rounded-full bg-ink-3" />
        )}
      </span>
      <div className="min-w-0 text-[14px] leading-snug">
        <span className="text-ink">{title}</span>
        {detail ? <div className="mt-0.5 text-[13px] leading-snug text-ink-3">{detail}</div> : null}
      </div>
      <span className="sr-only">{state === "ok" ? "(passed)" : state === "problem" ? "(needs attention)" : ""}</span>
    </li>
  );
}

const faucetLink =
  "inline-flex items-center gap-1 font-medium text-ink underline decoration-ink/25 underline-offset-4 transition-colors hover:decoration-ink";

/** Where test funds come from. Robinhood's faucet gives gas ETH; Paxos's gives test USDG. */
export function FaucetLinks({ need, className }: { need: "usdg" | "eth" | "both"; className?: string }) {
  const usdg = (
    <a href={USDG_FAUCET_URL} target="_blank" rel="noopener noreferrer" className={faucetLink}>
      Paxos&apos;s faucet <ArrowUpRightIcon size={12} />
    </a>
  );
  const eth = (
    <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className={faucetLink}>
      Robinhood&apos;s faucet <ArrowUpRightIcon size={12} />
    </a>
  );
  return (
    <span className={cn("text-[13px] leading-relaxed text-ink-2", className)}>
      {need === "eth" ? <>Get gas ETH from {eth}.</> : <>Get test USDG from {usdg}, and gas ETH from {eth}.</>}
    </span>
  );
}
