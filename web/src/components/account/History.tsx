// Server component: the account's life, newest first, each line linked to its transaction.
import { txUrl } from "@bondline/shared/chain";
import { TEAM_WALLETS } from "@bondline/shared/deployment";
import { USDG } from "@bondline/shared/constants";
import { formatUnits, type Address } from "viem";
import { Card } from "@/components/ui/Card";
import { AlertIcon, ArrowUpRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatBps, shortAddress } from "@/lib/format";
import { ago, usdg } from "@/lib/bondline/format";
import { readAccountHistoryOnce, type HistoryItem } from "./read-history";
import { symbolOf } from "./kit/bondline";

function line(i: HistoryItem): { title: string; detail?: string; tone?: "bond" | "muted" } {
  switch (i.kind) {
    case "opened":
      return { title: "Cover opened", detail: `${formatBps(i.limitBps ?? 0)} loss limit` };
    case "deposited":
      return {
        title: `Deposited $${usdg(i.amount ?? "0")}`,
        detail: `$${usdg(i.fee ?? "0")} premium to the bond, $${usdg(i.net ?? "0")} into the account`,
      };
    case "withdrawn":
      return { title: `Withdrew $${usdg(i.amount ?? "0")}`, detail: `Covered principal now $${usdg(i.principal ?? "0")}` };
    case "paused":
      return { title: "Agent paused by the owner", tone: "muted" };
    case "resumed":
      return { title: "Agent resumed by the owner", tone: "muted" };
    case "settled": {
      const who = i.caller ? TEAM_WALLETS[i.caller.toLowerCase()] : undefined;
      return {
        title: `Settled: the bond paid $${usdg(i.payout ?? "0")}`,
        detail: `Loss $${usdg(i.loss ?? "0")} against a $${usdg(i.limit ?? "0")} limit · settled by ${
          who === "keeper" ? "our keeper" : i.caller ? shortAddress(i.caller) : "someone"
        }`,
        tone: "bond",
      };
    }
    case "closed":
      return { title: "Cover closed by the owner", detail: "The agent stopped; the account was released" };
    case "swept": {
      const isUsdg = i.token?.toLowerCase() === USDG.toLowerCase();
      const amount = i.amount ?? "0";
      return isUsdg
        ? { title: `Swept ${usdg(amount)} USDG to the owner` }
        : {
            title: `Swept ${Number(formatUnits(BigInt(amount), 18)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${
              i.token ? symbolOf(i.token) : "stock"
            } to the owner`,
          };
    }
  }
}

export async function AccountHistory({ account }: { account: Address }) {
  let items: HistoryItem[];
  try {
    items = (await readAccountHistoryOnce(account)).items;
  } catch {
    return (
      <Card tone="sunken" className="flex items-start gap-3" role="alert">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
        <p className="text-[15px] text-ink-2">Couldn&apos;t read this account&apos;s history just now.</p>
      </Card>
    );
  }
  if (items.length === 0) return null;
  const now = Date.now() / 1000;
  return (
    <Card padding="sm">
      <ol className="flex flex-col">
        {items.map((i) => {
          const l = line(i);
          return (
            <li key={`${i.txHash}-${i.logIndex}`} className="flex items-start gap-3 py-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  l.tone === "bond" ? "bg-bond-strong" : l.tone === "muted" ? "bg-ink-4" : "bg-accent",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className={cn("text-[14px]", l.tone === "bond" ? "font-medium text-bond-ink" : "text-ink")}>{l.title}</div>
                {l.detail ? <div className="num mt-0.5 text-[12.5px] text-ink-3">{l.detail}</div> : null}
              </div>
              <a
                href={txUrl(i.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink"
              >
                {i.timestamp ? ago(i.timestamp, now) : "tx"}
                <ArrowUpRightIcon size={12} />
              </a>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
