import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";

/** The top of a wallet-flow page: eyebrow, a display title with one accented word, a lead, and the fine print. */
export function PageIntro({
  eyebrow,
  title,
  lead,
  fine,
  aside,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  fine?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Container className="pt-12 sm:pt-16">
      <Reveal className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-[44rem]">
          <p className="eyebrow mb-4">{eyebrow}</p>
          <h1 className="font-display text-display-l text-ink">{title}</h1>
          {lead ? <p className="mt-5 text-[17px] leading-relaxed text-ink-2 sm:text-lg">{lead}</p> : null}
          {fine ? <p className="mt-4 text-[13px] leading-relaxed text-ink-3">{fine}</p> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </Reveal>
    </Container>
  );
}
