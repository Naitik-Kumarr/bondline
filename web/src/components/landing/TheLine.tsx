import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";

/** The first line of every pitch. One idea, a lot of room. */
export function TheLine() {
  return (
    <Section spacing="lg" container="default" aria-labelledby="the-line">
      <Reveal>
        <p className="eyebrow mb-6">The difference</p>
        <h2 id="the-line" className="max-w-[28ch] font-display text-display-l text-ink">
          <span className="text-ink-3">The agent bonds we&apos;ve seen pay when an agent breaks a rule.</span>{" "}
          <span className="text-ink-2">Ours can&apos;t place a trade that breaks its rules;</span>{" "}
          <span>
            Bondline pays when the market{" "}
            <span className="bg-[linear-gradient(transparent_64%,var(--color-bond-soft)_64%,var(--color-bond-soft)_94%,transparent_94%)] px-0.5">
              breaks through your limit
            </span>
            .
          </span>
        </h2>
      </Reveal>
    </Section>
  );
}
