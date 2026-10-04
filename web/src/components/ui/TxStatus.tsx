import { txUrl } from "@bondline/shared/chain";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { shortHash } from "@/lib/format";
import { AlertIcon, ArrowUpRightIcon, CheckIcon, Spinner } from "./icons";

/**
 * idle: nothing to show. signing: waiting for the wallet. pending: sent, waiting for a block.
 * success: confirmed. error: rejected or reverted.
 */
export type TxState = "idle" | "signing" | "pending" | "success" | "error";

/** Map wagmi's useWriteContract + useWaitForTransactionReceipt flags onto a TxState. */
export function txStateOf({
  isSigning,
  hash,
  isConfirming,
  isConfirmed,
  error,
}: {
  isSigning?: boolean;
  hash?: string;
  isConfirming?: boolean;
  isConfirmed?: boolean;
  error?: unknown;
}): TxState {
  if (error) return "error";
  if (isConfirmed) return "success";
  if (hash && (isConfirming ?? true)) return "pending";
  if (isSigning) return "signing";
  return "idle";
}

/** A plain-language message for a failed wallet request or transaction. */
export function describeTxError(error: unknown): string {
  if (!error) return "Something went wrong.";
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason;
      return name ? `The contract refused it: ${name}.` : "The contract refused the transaction.";
    }
    return error.shortMessage || error.message;
  }
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return /user rejected|denied/i.test(error.message) ? "You rejected the request in your wallet." : error.message;
  }
  return String(error);
}

export type TxStatusProps = {
  state: TxState;
  hash?: string;
  error?: unknown;
  /** What the transaction does, e.g. "Approve 100 USDG". */
  label?: ReactNode;
  /** Replaces "Confirmed" on success, e.g. "Cover bought". */
  successLabel?: ReactNode;
  className?: string;
};

/** Pending, success (with an explorer link) and error states for every chain action. */
export function TxStatus({ state, hash, error, label, successLabel, className }: TxStatusProps) {
  if (state === "idle") return null;
  const tone =
    state === "success"
      ? "bg-positive-soft text-positive"
      : state === "error"
        ? "bg-negative-soft text-negative"
        : "bg-sunken text-ink-2";
  const icon =
    state === "success" ? (
      <CheckIcon size={16} />
    ) : state === "error" ? (
      <AlertIcon size={16} />
    ) : (
      <Spinner size={15} className="text-ink-2" />
    );
  const headline =
    state === "signing"
      ? "Confirm in your wallet"
      : state === "pending"
        ? "Waiting for confirmation"
        : state === "success"
          ? (successLabel ?? "Confirmed")
          : "Transaction failed";

  return (
    <div
      role={state === "error" ? "alert" : "status"}
      aria-live="polite"
      className={cn("flex items-start gap-3 rounded-field px-4 py-3 text-[14px] leading-snug", tone, className)}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {headline}
          {label && state !== "error" ? <span className="font-normal opacity-80"> · {label}</span> : null}
        </div>
        {state === "error" ? <div className="mt-0.5 break-words opacity-90">{describeTxError(error)}</div> : null}
      </div>
      {hash && state !== "signing" ? (
        <a
          href={txUrl(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[12.5px] underline decoration-current/30 underline-offset-4 hover:decoration-current"
        >
          {state === "success" ? "View on explorer" : <span className="num">{shortHash(hash)}</span>}
          <ArrowUpRightIcon size={12} />
        </a>
      ) : null}
    </div>
  );
}
