// Server component: the account's receipts, completed trades and rule-check refusals, with the AI's reasoning decoded from the
// transaction input and re-hashed against the event (receipts.ts).
import type { Address } from "viem";
import { formatUnits } from "viem";
import { Card } from "@/components/ui/Card";
import { AlertIcon, ArrowUpRightIcon, CheckIcon } from "@/components/ui/icons";
import { DemoLabel } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";
import { formatBps } from "@/lib/format";
import { ago, usdg } from "@/lib/bondline/format";
import { readReceipts, verifyDecision, type Receipt } from "@/lib/bondline/receipts";
import { txUrl } from "@bondline/shared/chain";
import { formatAge, symbolOf } from "./kit/bondline";

const MAX_UINT = 2n ** 256n - 1n;
const SHOWN = 20;

/** The rule a refusal hit, with the two numbers the contract compared, in words. */
function ruleDetail(r: Receipt): string | null {
  const o = r.observed;
  const l = r.limit;
  if (o === undefined || l === undefined || !r.reason) return null;
  switch (r.reason.key) {
    case "StockShare":
      return `${formatBps(Number(o))} of the account in stocks after the buy; the rule allows ${formatBps(Number(l))}.`;
    case "TradeTooLarge":
      return `A $${usdg(o)} trade; the rule allows $${usdg(l)}.`;
    case "DailyLimit":
      return `$${usdg(o)} traded today with this one; the rule allows $${usdg(l)}.`;
    case "InsufficientCash":
      return `Needed $${usdg(o)}; the account had $${usdg(l)} in cash.`;
    case "InsufficientStock":
      return `Asked to sell $${usdg(o)}; the account held $${usdg(l)}.`;
    case "Slippage":
      return `The fill was ${formatBps(Number(o))} below the oracle price; the rule allows ${formatBps(Number(l))}.`;
    case "PriceStale":
      if (o === MAX_UINT) return "No valid price for a stock it trades or holds.";
      if (o < 10n ** 9n && l < 10n ** 9n) return `The price was ${formatAge(Number(o))} old; the rule allows ${formatAge(Number(l))}.`;
      return "The demo exchange quoted a different price from the oracle.";
    default:
      return null;
  }
}

function sideText(r: Receipt) {
  const symbol = symbolOf(r.asset);
  const amount = r.usdAmount === MAX_UINT ? "everything" : `$${usdg(r.usdAmount)}`;
  if (r.kind === "trade") return { verb: r.isBuy ? "Bought" : "Sold", symbol, amount };
  return { verb: r.isBuy ? "Refused: buy" : "Refused: sell", symbol, amount };
}

export async function AccountReceipts({ account }: { account: Address }) {
  let receipts: Receipt[];
  try {
    receipts = await readReceipts([account], SHOWN);
  } catch {
    return (
      <Card tone="sunken" className="flex items-start gap-3" role="alert">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
        <p className="text-[15px] text-ink-2">Couldn&apos;t read the receipts from the chain just now. Refresh to try again.</p>
      </Card>
    );
  }
  if (receipts.length === 0) {
    return (
      <Card tone="sunken">
        <p className="text-[15px] leading-relaxed text-ink-2">
          No trades or refusals yet. The agent decides every few minutes when prices are fresh; holds stay off-chain.
        </p>
      </Card>
    );
  }
  const checks = await Promise.all(receipts.map((r) => verifyDecision(r.txHash, r.decisionHash).catch(() => null)));
  const now = Date.now() / 1000;

  return (
    <Card padding="none" className="overflow-hidden">
      <ul className="divide-y divide-line">
        {receipts.map((r, i) => {
          const c = checks[i];
          const parsed = c?.parsed as { reason?: unknown; model?: unknown } | null | undefined;
          const reason = typeof parsed?.reason === "string" ? parsed.reason : null;
          const model = typeof parsed?.model === "string" ? parsed.model : null;
          const side = sideText(r);
          const detail = r.kind === "refusal" ? ruleDetail(r) : null;
          return (
            <li key={`${r.txHash}-${i}`} className="px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      aria-hidden="true"
                      className={cn("size-2 shrink-0 rounded-full", r.kind === "trade" ? "bg-positive" : "bg-caution")}
                    />
                    <span className="text-[15px] font-medium text-ink">
                      {side.verb} {side.symbol}
                    </span>
                    <span className="num text-[14px] text-ink-2">{side.amount}</span>
                    {r.kind === "trade" && r.price !== undefined ? (
                      <span className="num text-[12.5px] text-ink-3">
                        at ${Number(formatUnits(r.price, 8)).toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                  {r.kind === "refusal" ? (
                    <p className="mt-1 text-[13.5px] text-caution">
                      {r.reason?.label}
                      {detail ? <span className="text-ink-2"> · {detail}</span> : null}
                    </p>
                  ) : null}
                </div>
                <a
                  href={txUrl(r.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"
                  title="The transaction on the explorer"
                >
                  {r.timestamp ? ago(r.timestamp, now) : `block ${r.blockNumber}`}
                  <ArrowUpRightIcon size={12} />
                </a>
              </div>
              {reason ? (
                <blockquote className="mt-2.5 border-l-2 border-accent-soft pl-3 text-[14px] leading-relaxed text-ink-2">
                  {reason}
                </blockquote>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                {model ? <span className="num">model: {model}</span> : null}
                {model === "mock" ? (
                  <DemoLabel kind="demo" title="The agents ran in mock mode for this pipeline test: no AI call was made.">
                    Mock decision
                  </DemoLabel>
                ) : null}
                {c?.matches ? (
                  <span
                    className="inline-flex items-center gap-1 text-positive"
                    title="keccak256 of the decision JSON in the transaction input equals the event's decisionHash"
                  >
                    <CheckIcon size={12} strokeWidth={2.2} /> Reasoning matches its on-chain hash
                  </span>
                ) : c ? (
                  <span className="text-caution">Reasoning not verified</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {receipts.length >= SHOWN ? (
        <p className="border-t border-line px-5 py-3 text-[12.5px] text-ink-3 sm:px-6">Showing the latest {SHOWN}.</p>
      ) : null}
    </Card>
  );
}
