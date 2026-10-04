import type { Metadata } from "next";
import Link from "next/link";
import { repoFile } from "@/components/tour/links";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { ArrowRightIcon, ArrowUpRightIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { Reveal } from "@/components/ui/Reveal";
import { Accent, Section, SectionHeader } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Everything you need to build on Bondline, or to check our work: the MCP server and SDK for AI agents, and the technical, pricing, security and roadmap notes.",
};

// The MCP server's six tools (mcp/src/tools.ts), one plain line each.
const TOOLS: { name: string; line: string }[] = [
  { name: "list_offers", line: "Lists every offer on each market: its terms, bond, free capacity, premiums earned and claims paid." },
  { name: "quote_cover", line: "Quotes a cover before anyone buys it: premium, loss limit, the bond it reserves and whether it would go through." },
  { name: "get_agent_record", line: "Reads an agent's public record: score, trades, refusals, exposure, claims and its reference prices." },
  { name: "build_cover_transactions", line: "Builds the two unsigned transactions that buy cover: approve the exact deposit, then open the cover." },
  { name: "build_offer_authorization", line: "Builds the one signature an underwriter needs to back an agent, then the transaction that creates the offer." },
  { name: "build_trade_transaction", line: "Builds an unsigned trade for an agent's account, with its decision JSON hashed into the receipt." },
];

// From docs/agents.md.
const MCP_CONFIG = `{ "mcpServers": { "bondline": { "command": "node", "args": ["/absolute/path/to/surety/mcp/bin/bondline-mcp.mjs"] } } }`;
const CLI = `npx bondline offers --listed
npx bondline quote --market live --offer 0 --amount 100 --limit-bps 1000
npx bondline record careful`;

const DOCS: { file: string; title: string; line: string }[] = [
  { file: "agents.md", title: "Agents: SDK and MCP server", line: "Read offers, quotes and records, and build unsigned transactions from any agent." },
  { file: "TECHNICAL.md", title: "Technical notes", line: "How the market works: contracts, money math, the keeper, the agents and the trust assumptions." },
  { file: "PRICING.md", title: "Pricing", line: "The published reference price model that any premium can be compared against." },
  { file: "PROOF_OF_COVER.md", title: "ProofOfCover", line: "A read only contract any app can ask: is this account covered, by whom, and how much room is left?" },
  { file: "BACKTEST.md", title: "Backtest", line: "Careful and Bold on real Chainlink prices since June: covers, claims and loss ratios." },
  { file: "SECURITY.md", title: "Security", line: "Scope, trust assumptions, known limits and every finding of the independent review." },
  { file: "JUDGES.md", title: "For judges", line: "The 3 minute path: the tour, the onchain transactions and the contracts." },
  { file: "ROADMAP.md", title: "Roadmap", line: "Milestones with deliverables and KPIs, from the review fixes to a capped mainnet beta." },
];

function Code({ children, label }: { children: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12.5px] text-ink-3">{label}</p>
      <pre className="num overflow-x-auto rounded-field bg-sunken px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
        <code>{children}</code>
      </pre>
    </div>
  );
}

const external = "inline-flex items-center gap-1 text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60";

export default function DocsPage() {
  const agentsDoc = repoFile("docs/agents.md");
  return (
    <>
      <Container className="pb-8 pt-14 sm:pb-10 sm:pt-20">
        <p className="eyebrow mb-4">Docs</p>
        <h1 className="max-w-[18ch] font-display text-display-l text-ink">
          Build on <Accent>Bondline</Accent>.
        </h1>
        <p className="mt-5 max-w-[44rem] text-[17px] leading-relaxed text-ink-2 sm:text-lg">
          Everything you need to build on Bondline, or to check our work.
        </p>
      </Container>

      <Container className="pb-10 sm:pb-14">
        <Reveal>
          <Card padding="lg" tone="accent">
            <div className="flex flex-wrap items-center gap-3">
              <p className="eyebrow">For AI agents</p>
              <Pill size="sm" tone="accent" dot>
                Six tools
              </Pill>
            </div>
            <h2 id="agents" className="mt-4 max-w-[26ch] font-display text-display-m text-ink">
              MCP server and SDK
            </h2>
            <p className="mt-4 max-w-[46rem] text-[16px] leading-relaxed text-ink-2">
              Any AI agent can use Bondline through our MCP server or SDK. It lists offers, quotes cover, reads an
              agent&apos;s record and builds unsigned transactions for cover, underwriting and trades. It holds no keys:
              the agent&apos;s own wallet signs.
            </p>
            <ul className="mt-7 grid gap-x-8 gap-y-4 md:grid-cols-2">
              {TOOLS.map((t) => (
                <li key={t.name} className="min-w-0">
                  <code className="num text-[13px] text-accent-ink">{t.name}</code>
                  <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">{t.line}</p>
                </li>
              ))}
            </ul>
            <div className="mt-8 grid gap-5">
              <Code label="Point any MCP client at the server">{MCP_CONFIG}</Code>
              <Code label="Or try the SDK's command line">{CLI}</Code>
            </div>
            {agentsDoc ? (
              <p className="mt-6 text-[14px]">
                <a href={agentsDoc} target="_blank" rel="noopener noreferrer" className={external}>
                  The full agent guide: docs/agents.md <ArrowUpRightIcon size={12} />
                </a>
              </p>
            ) : null}
          </Card>
        </Reveal>
      </Container>

      <Section spacing="sm" aria-labelledby="docs-title">
        <SectionHeader eyebrow="Read the docs" title={<span id="docs-title">The notes behind the product</span>} size="m" />
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DOCS.map((d) => {
            const href = repoFile(`docs/${d.file}`);
            return (
              <li key={d.file} className="min-w-0">
                <Card className="flex h-full flex-col">
                  <p className="num text-[12px] text-ink-3">{d.file}</p>
                  <h3 className="mt-2 text-[16px] font-medium text-ink">{d.title}</h3>
                  <p className="mt-2 flex-1 text-[14px] leading-relaxed text-ink-2">{d.line}</p>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className={`mt-4 text-[13.5px] ${external}`}>
                      Read on GitHub <ArrowUpRightIcon size={12} />
                    </a>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-[15px] text-ink-2">
          Contract addresses and their verified source are in the{" "}
          <Link href="/judge" className="inline-flex items-center gap-1 text-ink underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60">
            judge kit <ArrowRightIcon size={13} />
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
