import type { AgentRecord } from "@bondline/shared/record";
import Link from "next/link";
import { ScoreRing } from "@/components/market/ScoreRing";
import { duration, int, modelName, pct, utcTime } from "@/components/market/fmt";
import { AddressPill } from "@/components/ui/AddressPill";
import { AgentMark } from "@/components/ui/AgentMark";
import { Container } from "@/components/ui/Container";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { Accent } from "@/components/ui/Section";

/** The models named in the agent's latest decisions, from the decision JSON in the record. */
export function decisionModels(record: AgentRecord | null): string[] {
  const out = new Set<string>();
  for (const r of record?.recent ?? []) {
    if (!r.decision) continue;
    try {
      const m = (JSON.parse(r.decision) as { model?: unknown }).model;
      if (typeof m === "string" && m) out.add(m);
    } catch {
      // not JSON: nothing to read
    }
  }
  return [...out];
}

export function AgentHeader({
  agent,
  name,
  record,
  rulesMax,
  known,
}: {
  agent: string;
  name: string;
  record: AgentRecord | null;
  rulesMax: number | null;
  /** Has offers or a record on Bondline. */
  known: boolean;
}) {
  const score = record?.score.value ?? null;
  const models = decisionModels(record);
  const a = record?.activity;
  return (
    <Container className="pb-4 pt-10 sm:pb-6 sm:pt-14">
      <nav aria-label="Breadcrumb" className="text-[13.5px] text-ink-3">
        <Link href="/market" className="transition-colors hover:text-ink">
          Market
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-ink-2">{name}</span>
      </nav>

      <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-5">
          <AgentMark address={agent} size={84} className="hidden sm:block" />
          <AgentMark address={agent} size={64} className="sm:hidden" />
          <div className="min-w-0">
            <p className="eyebrow mb-2">Agent</p>
            <h1 className="font-display text-display-l text-ink">
              {name}&apos;s <Accent>record</Accent>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-4 md:flex-col md:items-end md:gap-2">
          <ScoreRing value={score} size={104} stroke={6} />
          <p className="max-w-[13rem] text-[12.5px] leading-snug text-ink-3 md:text-right">
            {score == null ? "No trades yet, so no score." : "Display score. It doesn't set any price."}
          </p>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-2">
        <AddressPill address={agent} copy flagTeam />
        {models.map((m) =>
          m === "mock" ? (
            <DemoLabel key={m} kind="demo" title='Decisions labelled "model": "mock" in their JSON: a pipeline test, not an AI'>
              Mock decisions
            </DemoLabel>
          ) : (
            <Pill key={m} tone="neutral" size="md">
              Decisions by <span className="text-ink">{modelName(m)}</span>
            </Pill>
          ),
        )}
      </div>

      {known ? (
      <p className="mt-6 max-w-[46rem] text-[17px] leading-relaxed text-ink-2">
        It trades covered accounts through onchain rules it can&apos;t change
        {rulesMax != null ? (
          <>
            : at most <span className="num text-ink">{pct(rulesMax, 0)}</span> of an account in stocks, with size and
            price age limits
          </>
        ) : null}
        . It can&apos;t withdraw. Submitted trades that complete emit a trade or rule check refusal receipt with a hash of
        the submitted decision bytes; offchain holds are absent. The hash verifies the bytes, not that a model produced
        them.
      </p>
      ) : null}

      {record ? (
        <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
          Record rebuilt from chain events on both markets up to block{" "}
          <span className="num text-ink-2">{int(Math.max(0, ...record.markets.map((m) => m.toBlock)))}</span>, at{" "}
          {utcTime(Date.parse(record.generatedAt) / 1000)}
          {a?.activeSeconds != null ? (
            <>
              . Active for <span className="num text-ink-2">{duration(a.activeSeconds)}</span> onchain, from its first
              decision to its latest
            </>
          ) : null}
          .
        </p>
      ) : null}
    </Container>
  );
}
