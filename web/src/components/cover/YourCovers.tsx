"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { AgentMark } from "@/components/ui/AgentMark";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { formatBps, shortAddress } from "@/lib/format";
import { usdg as fmtUsdg } from "@/lib/bondline/format";
import { agentName, marketByKey } from "@/components/account/kit/bondline";
import type { LiveOffer } from "@/components/account/kit/useOffers";

const STATUS_TONE = { Active: "positive", Settled: "bond", Closed: "neutral", None: "neutral" } as const;

/** The connected wallet's covered accounts, newest last, each linking to its page. */
export function YourCovers({ offers }: { offers: LiveOffer[] | undefined }) {
  const { address } = useAccount();
  if (!address || !offers) return null;
  const mine = offers.flatMap((o) =>
    (o.accounts ?? []).filter((a) => a.user.toLowerCase() === address.toLowerCase()).map((a) => ({ o, a })),
  );
  if (mine.length === 0) return null;
  return (
    <section aria-labelledby="your-covers" className="mt-14">
      <h2 id="your-covers" className="font-display text-display-s text-ink">
        Your covers
      </h2>
      <ul className="mt-5 grid gap-3 md:grid-cols-2">
        {mine.map(({ o, a }) => (
          <li key={a.address}>
            <Link
              href={`/account/${a.address}`}
              className="lift group flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-soft"
            >
              <AgentMark address={o.agent} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium text-ink">{o.terms.name}</span>
                  <Pill size="sm" tone={STATUS_TONE[a.status]} dot>
                    {a.status}
                  </Pill>
                </div>
                <div className="mt-1 text-[13px] text-ink-3">
                  {agentName(o.agent)} · {marketByKey(o.market)?.label} · <span className="num">{formatBps(a.limitBps)}</span> limit ·{" "}
                  <span className="num">{fmtUsdg(a.principal)}</span> USDG covered
                </div>
              </div>
              <span className="num hidden text-[12.5px] text-ink-3 sm:block">{shortAddress(a.address)}</span>
              <ArrowRightIcon size={16} className="shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
