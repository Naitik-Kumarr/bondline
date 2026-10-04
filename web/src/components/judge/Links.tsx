import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const linkClass =
  "inline-flex items-baseline gap-0.5 text-ink underline decoration-ink/20 underline-offset-4 transition-colors hover:decoration-ink/60";

/** An outbound source link: new tab, with the arrow. */
export function Ext({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(linkClass, className)}>
      {children}
      <ArrowUpRightIcon size={11} className="shrink-0 self-center opacity-60" />
    </a>
  );
}

/** An in-site link, same look. */
export function Int({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn(linkClass, className)}>
      {children}
    </Link>
  );
}

export const SOURCES = {
  hood: "https://robinhood.com/us/en/newsroom/hood-summit-2026/",
  fortune: "https://fortune.com/2025/07/23/ai-agent-insurance-startup-aiuc-stealth-15-million-seed-nat-friedman",
  dealroom: "https://dealroom.co/news/150943-aiuc-lands-40m-series-a-to-insure-ai-agents/",
  paxos: "https://docs.paxos.com/guides/stablecoin/usdg",
} as const;
