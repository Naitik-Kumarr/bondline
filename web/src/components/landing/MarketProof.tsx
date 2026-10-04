import Link from "next/link";
import { getBook } from "@/components/market/data";
import { AgentPriceLine } from "@/components/market/AgentPriceLine";
import { int, usd, usdgToUsd } from "@/components/market/fmt";
import { Card } from "@/components/ui/Card";

/**
 * The first thing under the headline: the underwriting market and the paid claim, as the chain says it right now
 * (bonded USDG behind the agents, claims actually paid), then what a cover costs for each team agent. Testnet.
 */
export async function MarketProof() {
  const read = await getBook();
  const t = read.ok && read.book.deployed ? read.book.totals : null;
  const settled = read.ok ? read.book.offers.reduce((n, o) => n + o.accounts.filter((a) => a.health.status === "Settled").length, 0) : 0;
  return (
    <div className="mx-auto mt-10 max-w-[56rem] text-left sm:mt-12">
      {t ? (
        <Card padding="none" className="overflow-hidden bg-surface/90">
          <dl className="grid grid-cols-2 sm:grid-cols-3">
            <div className="border-b border-r border-line p-5 sm:border-b-0 sm:p-6">
              <dt className="text-[13px] text-ink-3">USDG bonded behind agents</dt>
              <dd className="num mt-1.5 text-[26px] leading-none tracking-[-0.02em] text-bond-ink sm:text-[30px]">{usd(usdgToUsd(t.usdgBonded))}</dd>
              <dd className="mt-2 text-[12.5px] text-ink-3">{int(t.offers)} underwriter offers</dd>
            </div>
            <div className="border-b border-line p-5 sm:border-b-0 sm:border-r sm:p-6">
              <dt className="text-[13px] text-ink-3">Claims paid</dt>
              <dd className="num mt-1.5 text-[26px] leading-none tracking-[-0.02em] text-ink sm:text-[30px]">{usd(usdgToUsd(t.claimsPaid), { cents: true })}</dd>
              <dd className="mt-2 text-[12.5px] text-ink-3">
                {settled === 0 ? (
                  <>
                    None yet.{" "}
                    <Link href="/party" className="underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60">
                      The scripted gap
                    </Link>{" "}
                    is scheduled.
                  </>
                ) : (
                  <>
                    {int(settled)} settled {settled === 1 ? "cover" : "covers"}
                  </>
                )}
              </dd>
            </div>
            <div className="col-span-2 p-5 sm:col-span-1 sm:p-6">
              <dt className="text-[13px] text-ink-3">Covers sold</dt>
              <dd className="num mt-1.5 text-[26px] leading-none tracking-[-0.02em] text-ink sm:text-[30px]">{usd(usdgToUsd(t.coverSold))}</dd>
              <dd className="mt-2 text-[12.5px] text-ink-3">{int(t.covers)} covers, {int(t.activeCovers)} active</dd>
            </div>
          </dl>
        </Card>
      ) : null}
      <AgentPriceLine className="mt-5 text-center text-[15px] leading-relaxed text-ink-2" />
      <p className="mt-3 text-center text-[12.5px] text-ink-3">
        Read from the chain, testnet. Team operated wallets and the scripted gap are labelled on the{" "}
        <Link href="/market" className="underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60">
          market
        </Link>{" "}
        and the{" "}
        <Link href="/judge" className="underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60">
          judge kit
        </Link>
        .
      </p>
    </div>
  );
}
