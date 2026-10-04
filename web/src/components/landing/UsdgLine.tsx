import { Card } from "@/components/ui/Card";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";

const FLOWS = ["Bonds", "Premiums", "Cover", "Claims"] as const;

/** One USDG line. The issuer facts are about USDG only; Bondline itself is not regulated. */
export function UsdgLine() {
  return (
    <Section spacing="md" aria-labelledby="usdg">
      <Reveal>
        <Card padding="lg" className="overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 size-[22rem] rounded-full bg-[radial-gradient(closest-side,rgb(242_163_122/0.16),transparent)]"
          />
          <p className="eyebrow mb-5">One currency</p>
          <h2 id="usdg" className="relative max-w-[26ch] font-display text-display-m text-ink">
            Every dollar in Bondline is Paxos USDG: bonds, premiums, cover and claims.
          </h2>
          <ul className="relative mt-8 flex flex-wrap gap-2">
            {FLOWS.map((f) => (
              <li
                key={f}
                className="inline-flex h-8 items-center gap-2 rounded-full bg-bond-tint px-3.5 text-[13px] text-bond-ink shadow-[inset_0_0_0_1px_rgb(156_74_34/0.12)]"
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-bond-strong" />
                {f}
                <span className="num text-[11.5px] text-bond-ink/70">USDG</span>
              </li>
            ))}
          </ul>
          <p className="relative mt-8 max-w-[46rem] text-[13.5px] leading-relaxed text-ink-3">
            USDG is &ldquo;issued by Paxos Digital Singapore Pte. Ltd. (PDS)&rdquo;, which &ldquo;is a Major Payments
            Institution supervised by the Monetary Authority of Singapore.&rdquo;{" "}
            <a
              href="https://docs.paxos.com/guides/stablecoin/usdg"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60"
            >
              Paxos docs
              <ArrowUpRightIcon size={12} />
            </a>{" "}
            That describes USDG only: Bondline is an independent testnet project, not a regulated product.
          </p>
        </Card>
      </Reveal>
    </Section>
  );
}
