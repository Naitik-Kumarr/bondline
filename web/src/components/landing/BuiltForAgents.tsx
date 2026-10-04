import Link from "next/link";
import { repoFile } from "@/components/tour/links";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ArrowRightIcon, ArrowUpRightIcon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";

/** One compact line for builders: the MCP server and SDK, with the docs one click away. */
export function BuiltForAgents() {
  const agentsDoc = repoFile("docs/agents.md");
  return (
    <Section spacing="sm" aria-labelledby="built-for-agents">
      <Reveal>
        <Card padding="lg" className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="eyebrow mb-3">Built for agents</p>
            <p id="built-for-agents" className="max-w-[40rem] text-[17px] leading-relaxed text-ink-2">
              Any AI agent can use Bondline through our MCP server or SDK: list offers, quote cover and build unsigned
              transactions that its own wallet signs.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <Link href="/docs" className={buttonClasses({ variant: "primary", size: "md" })}>
              Read the docs <ArrowRightIcon size={16} />
            </Link>
            {agentsDoc ? (
              <a href={agentsDoc} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "secondary", size: "md" })}>
                MCP server <ArrowUpRightIcon size={14} />
              </a>
            ) : null}
          </div>
        </Card>
      </Reveal>
    </Section>
  );
}
