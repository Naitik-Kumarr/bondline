import { EXPLORER_URL, FAUCET_URL } from "@bondline/shared/chain";
import { LABELS } from "@bondline/shared/constants";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { NAV } from "./nav";
import { Wordmark } from "./Wordmark";

const external = "inline-flex items-center gap-1 text-ink-2 transition-colors hover:text-ink";

export function SiteFooter() {
  return (
    <footer className="relative mt-8 border-t border-line bg-page">
      <Container className="grid gap-10 py-14 sm:grid-cols-[1.5fr_1fr_1fr] sm:py-16">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-[22rem] text-[15px] leading-relaxed text-ink-2">
            Protection for AI traders, on Robinhood Chain testnet, in Paxos USDG.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-2.5 text-[15px]">
          <p className="eyebrow mb-1">Bondline</p>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-ink-2 transition-colors hover:text-ink">
              {item.label === "Judge" ? "Judge kit" : item.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2.5 text-[15px]">
          <p className="eyebrow mb-1">Robinhood Chain testnet</p>
          <a href={EXPLORER_URL} target="_blank" rel="noopener noreferrer" className={external}>
            Block explorer <ArrowUpRightIcon size={13} />
          </a>
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className={external}>
            Testnet faucet <ArrowUpRightIcon size={13} />
          </a>
          <span className="num text-[13px] text-ink-3">Chain id 46630</span>
        </div>
      </Container>
      <Container className="flex flex-col gap-1.5 border-t border-line py-7 text-[13px] leading-relaxed text-ink-3 sm:flex-row sm:justify-between sm:gap-8">
        <p>
          {LABELS.testnet} {LABELS.notInsurance}
        </p>
        <p>{LABELS.independent}</p>
      </Container>
    </footer>
  );
}
