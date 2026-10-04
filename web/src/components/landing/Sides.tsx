import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeader } from "@/components/ui/Section";

/** Agents: a price line kept inside a dashed box of rules; one blocked trade at the edge. */
function AgentsArt() {
  return (
    <svg viewBox="0 0 160 84" className="h-[84px] w-[160px]" aria-hidden="true">
      <rect x="8" y="10" width="144" height="64" rx="12" fill="#f5f5fe" stroke="#7c83ee" strokeDasharray="4 4" />
      <path
        d="M20 52 34 46l12 6 14-14 12 5 14-12 12 8 14-9 12 4"
        fill="none"
        stroke="#1f1f1f"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="60" cy="38" r="3.2" fill="#1f1f1f" />
      <circle cx="98" cy="35" r="3.2" fill="#1f1f1f" />
      <g stroke="#4a50c2" strokeWidth="2" strokeLinecap="round">
        <path d="M137 20l8 8M145 20l-8 8" />
      </g>
    </svg>
  );
}

/** Underwriters: a bond with its reserved and free parts. */
function UnderwritersArt() {
  return (
    <svg viewBox="0 0 160 84" className="h-[84px] w-[160px]" aria-hidden="true">
      <rect x="8" y="22" width="144" height="40" rx="12" fill="#fef4ee" stroke="rgb(156 74 34 / 0.18)" />
      <rect x="14" y="28" width="82" height="28" rx="8" fill="#f2a37a" />
      <rect x="100" y="28" width="46" height="28" rx="8" fill="#fde8dc" />
      <path d="M100 18v48" stroke="#9c4a22" strokeOpacity="0.35" strokeDasharray="2 3" />
      <circle cx="55" cy="42" r="5" fill="#fff" fillOpacity="0.85" />
      <path d="M52.6 42.2l1.7 1.7 3.2-3.4" fill="none" stroke="#9c4a22" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Users: a limit, a gap through it, and the bond filling the gap. */
function UsersArt() {
  return (
    <svg viewBox="0 0 160 84" className="h-[84px] w-[160px]" aria-hidden="true">
      <path d="M96 44h56v24H96z" fill="#f8c3a6" />
      <path d="M8 44h144" stroke="#7c83ee" strokeWidth="1.6" strokeDasharray="5 4" />
      <path
        d="M12 22l14 5 12-4 14 8 14-2 14 7 14 0 2 32h56"
        fill="none"
        stroke="#1f1f1f"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="96" cy="68" r="3.4" fill="#1f1f1f" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

const SIDES: { key: string; title: string; art: ReactNode; body: ReactNode; href: string; cta: string }[] = [
  {
    key: "agents",
    title: "Agents",
    art: <AgentsArt />,
    body: (
      <>
        Agents trade through onchain rule checks. Submitted trades that complete emit a trade or rule check refusal
        receipt with a hash of the submitted decision bytes. The hash verifies the bytes, not that a model produced
        them.
      </>
    ),
    href: "/market",
    cta: "See the agents",
  },
  {
    key: "underwriters",
    title: "Underwriters",
    art: <UnderwritersArt />,
    body: (
      <>
        Underwriters put USDG behind an agent they choose, set the premium, and earn it. The contract caps what they can
        lose: it refuses a deposit unless the free bond already covers that deposit&apos;s worst case. An underwriter
        cannot release reserved bond or veto a payout by delisting. Settlement still depends on fresh prices and a
        successful USDG transfer, and unsolicited listed stock dust can currently block it.
      </>
    ),
    href: "/underwrite",
    cta: "Back an agent",
  },
  {
    key: "users",
    title: "Users",
    art: <UsersArt />,
    body: (
      <>
        Users pick an agent and a loss limit, and pay the premium for cover. Past the limit, anyone can call settle. It
        stops the agent and pays once only if the required prices are fresh and the USDG transfer succeeds. The bond
        pays the loss beyond the limit, up to a 30% drop.
      </>
    ),
    href: "/cover",
    cta: "Get cover",
  },
];

export function Sides() {
  return (
    <Section spacing="md" aria-labelledby="sides">
      <SectionHeader eyebrow="Three sides, one market" title={<span id="sides">Who it&apos;s for</span>} size="m" />
      <div className="mt-10 grid gap-4 md:mt-12 md:grid-cols-3">
        {SIDES.map((side, i) => (
          <Reveal key={side.key} delay={i * 0.06} className="h-full">
            <Card as="article" interactive className="flex h-full flex-col">
              <div className="-mx-1 mb-6 flex h-[96px] items-center rounded-card bg-page/70 px-3">{side.art}</div>
              <h3 className="font-display text-[30px] leading-none tracking-[-0.02em] text-ink">{side.title}</h3>
              <p className="mt-4 flex-1 text-[15.5px] leading-relaxed text-ink-2">{side.body}</p>
              <Link
                href={side.href}
                className="group mt-7 inline-flex items-center gap-2 self-start text-[15px] font-medium text-ink after:absolute after:inset-0 after:rounded-card-lg"
              >
                {side.cta}
                <ArrowRightIcon
                  size={15}
                  className="transition-transform duration-[var(--duration-spring)] ease-spring group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
