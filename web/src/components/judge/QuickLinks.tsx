import { addressUrl } from "@bondline/shared/chain";
import { USDG } from "@bondline/shared/constants";
import { deployment } from "@bondline/shared/deployment";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon, ArrowUpRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const pill =
  "group inline-flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-[14px] text-ink shadow-hairline transition-transform duration-[var(--duration-spring)] ease-spring hover:-translate-y-px motion-reduce:transition-none";

function Q({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  const icon = external ? (
    <ArrowUpRightIcon size={13} className="text-ink-3 transition-colors group-hover:text-ink" />
  ) : (
    <ArrowRightIcon size={13} className="text-ink-3 transition-colors group-hover:text-ink" />
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(pill)}>
      {children}
      {icon}
    </a>
  ) : (
    <Link href={href} className={pill}>
      {children}
      {icon}
    </Link>
  );
}

/** Where to look: the app's pages, and the contracts on the explorer. */
export function QuickLinks() {
  const { careful, bold } = deployment.wallets;
  const live = deployment.markets.live.address;
  const replay = deployment.markets.replay.address;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Q href="/market">The market</Q>
        <Q href={`/agent/${careful}`}>Careful&apos;s record</Q>
        <Q href={`/agent/${bold}`}>Bold&apos;s record</Q>
        <Q href="/live">Live market</Q>
        <Q href="/tour">The 2 minute tour</Q>
        <Q href="/underwrite">Underwrite: one signature</Q>
        <Q href="/cover">Get cover</Q>
        <Q href="#moments">The onchain moments</Q>
      </div>
      <div className="flex flex-wrap gap-2">
        {live ? (
          <Q href={addressUrl(live)} external>
            Live market contract
          </Q>
        ) : null}
        {replay ? (
          <Q href={addressUrl(replay)} external>
            Replay market contract
          </Q>
        ) : null}
        <Q href={addressUrl(USDG)} external>
          USDG on Robinhood Chain testnet
        </Q>
      </div>
    </div>
  );
}
