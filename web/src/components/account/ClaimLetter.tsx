import { txUrl } from "@bondline/shared/chain";
import { Card } from "@/components/ui/Card";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { lettersFor } from "@/lib/letters";
import { RehashCheck } from "./RehashCheck";

/**
 * The claim letter for a settled account, written by Claude from the Settled event's numbers (scripts/claim-letters.ts)
 * and stored with its keccak256 hash. Renders nothing when there is no verified letter for this account.
 */
export function ClaimLetter({ account }: { account: string }) {
  const letters = lettersFor(account);
  if (letters.length === 0) return null;
  return (
    <section aria-labelledby="letter" className="mt-4">
      <h2 id="letter" className="mb-1.5 font-display text-display-s text-ink">
        Claim letter
      </h2>
      <p className="mb-4 text-[14px] text-ink-3">
        Written after the settle from the onchain numbers, then hashed. Anyone can rehash the text below.
      </p>
      <div className="flex flex-col gap-4">
        {letters.map((l) => (
          <Card key={l.settleTx}>
            <div className="flex flex-wrap items-center gap-2">
              {l.scripted ? <DemoLabel kind="scripted" /> : null}
              <Pill size="sm" tone="neutral">
                {l.model === "template, no model" ? "Template, no model" : `Written by ${l.model}`}
              </Pill>
              <a
                href={txUrl(l.settleTx)}
                target="_blank"
                rel="noopener noreferrer"
                className="num ml-auto inline-flex items-center gap-1 text-[12.5px] text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60"
                title={l.settleTx}
              >
                settle tx {l.settleTx.slice(0, 10)}…{l.settleTx.slice(-6)}
                <ArrowUpRightIcon size={12} />
              </a>
            </div>
            <div className="mt-5 whitespace-pre-wrap break-words border-l-2 border-bond/60 pl-4 text-[15px] leading-relaxed text-ink">
              {l.letter}
            </div>
            <p className="mt-5 text-[12.5px] text-ink-3">
              Stored hash <span className="num break-all text-ink-2">{l.hash}</span>
            </p>
            <RehashCheck letter={l.letter} hash={l.hash} />
          </Card>
        ))}
      </div>
    </section>
  );
}
