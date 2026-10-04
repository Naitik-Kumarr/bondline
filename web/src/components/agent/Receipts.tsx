import { txUrl } from "@bondline/shared/chain";
import type { AgentRecord, MarketKey } from "@bondline/shared";
import type { Address } from "viem";
import { bpsPct, modelName, usd, utcTime } from "@/components/market/fmt";
import { NumText } from "@/components/market/NumText";
import { Card } from "@/components/ui/Card";
import { AlertIcon, ArrowUpRightIcon } from "@/components/ui/icons";
import { DemoLabel, Pill } from "@/components/ui/Pill";
import { readAgentReceipts, type ReceiptView } from "./data";
import { VerifyButton } from "./VerifyButton";

const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

function Saw({ inputs }: { inputs: unknown }) {
  if (!inputs || typeof inputs !== "object") return null;
  const i = inputs as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "string" || typeof v === "number" ? Number(v) : NaN);
  const parts: string[] = [];
  if (Number.isFinite(num(i.value))) parts.push(`account ${usd(num(i.value), { cents: true })}`);
  if (Number.isFinite(num(i.stockBps))) parts.push(`${bpsPct(num(i.stockBps))} in stocks`);
  if (Number.isFinite(num(i.lossBps))) parts.push(`down ${bpsPct(num(i.lossBps))}`);
  if (i.px && typeof i.px === "object") {
    for (const [sym, p] of Object.entries(i.px as Record<string, unknown>)) {
      if (Number.isFinite(num(p))) parts.push(`${sym} ${usd(num(p), { cents: true })}`);
    }
  }
  if (parts.length === 0) return null;
  return (
    <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
      What it saw: <NumText text={parts.join(" · ")} className="text-ink-2" />
    </p>
  );
}

function ReceiptCard({ r }: { r: ReceiptView }) {
  const model = r.parsed?.model;
  const mock = model === "mock";
  const reason = typeof r.parsed?.reason === "string" ? r.parsed.reason : null;
  const bytes = r.decision ? new TextEncoder().encode(r.decision).length : 0;
  return (
    <li>
      <Card compact padding="none" className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {r.kind === "trade" ? (
              <Pill size="sm" tone="positive" dot>
                Trade
              </Pill>
            ) : (
              <Pill size="sm" tone="caution" dot>
                Refusal
              </Pill>
            )}
            <span className="text-[14.5px] font-medium text-ink">
              {r.side === "buy" ? "Buy" : "Sell"} {r.asset}{" "}
              <span className="num font-normal text-ink-2">{r.usd != null ? usd(r.usd, { cents: true }) : "everything"}</span>
            </span>
            {r.market === "replay" ? (
              <DemoLabel kind="replay" />
            ) : r.market === "live" ? (
              <Pill size="sm" tone="accent">
                Live market
              </Pill>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-[12.5px] text-ink-3">
            {r.timestamp != null ? <span>{utcTime(r.timestamp, { seconds: true })}</span> : null}
            <a
              href={txUrl(r.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="num inline-flex items-center gap-1 text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60"
              title={`Transaction ${r.txHash} on the explorer`}
            >
              tx {shortHash(r.txHash)}
              <ArrowUpRightIcon size={12} />
            </a>
          </div>
        </div>

        {r.kind === "refusal" && r.reason ? (
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">
            <span className="font-medium text-ink">Refused: {r.reason.label.toLowerCase()}.</span>{" "}
            {r.detail ? <NumText text={`${r.detail}.`} /> : null} Nothing changed.
          </p>
        ) : null}

        <figure className="mt-4 border-l-2 border-accent/50 pl-4">
          <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
            {mock ? (
              <>
                <span>The decision&apos;s reason, from the transaction input</span>
                <DemoLabel kind="demo" className="h-5 px-2 text-[9.5px]" title='"model": "mock" in the decision JSON: a pipeline test, not an AI'>
                  Mock, not an AI
                </DemoLabel>
              </>
            ) : (
              <span>
                The AI&apos;s reasoning, from the transaction input
                {modelName(model) ? (
                  <>
                    {" "}
                    · <span className="text-ink-2">{modelName(model)}</span>
                  </>
                ) : null}
              </span>
            )}
          </figcaption>
          {reason ? (
            <blockquote className="mt-1.5 text-[15px] leading-relaxed text-ink">&ldquo;{reason}&rdquo;</blockquote>
          ) : (
            <p className="mt-1.5 text-[14px] text-ink-3">
              {r.decision ? "The decision has no reason field." : "No decision found in this transaction's input."}
            </p>
          )}
          <Saw inputs={r.parsed?.inputs} />
        </figure>

        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <VerifyButton txHash={r.txHash} account={r.account as Address} className="sm:max-w-[26rem]" />
          {r.decision ? (
            <details className="group min-w-0 sm:max-w-[60%]">
              <summary className="cursor-pointer list-none text-[13px] text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60 [&::-webkit-details-marker]:hidden">
                Decision JSON, exact bytes (<span className="num">{bytes}</span>)
              </summary>
              <pre
                className="num mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-field bg-sunken p-3 text-[11.5px] leading-relaxed text-ink-2"
                data-lenis-prevent=""
              >
                {r.decision}
              </pre>
              <p className="num mt-2 break-all text-[11px] text-ink-3">decisionHash {r.decisionHash}</p>
            </details>
          ) : null}
        </div>
      </Card>
    </li>
  );
}

/** The latest trades and refusals, newest first, read live from the chain. */
export async function Receipts({
  accounts,
  record,
  name,
}: {
  accounts: { address: Address; market: MarketKey }[];
  record: AgentRecord | null;
  name: string;
}) {
  if (accounts.length === 0) {
    return <p className="text-[15px] text-ink-2">{name} has no covered accounts yet, so no trades or refusals.</p>;
  }
  const res = await readAgentReceipts(accounts, record, 8);
  if (!res.ok) {
    return (
      <Card tone="sunken" className="flex items-start gap-3" role="alert">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
        <p className="text-[14px] text-ink-2">Couldn&apos;t read the receipts from the chain just now. This page retries every 30 seconds.</p>
      </Card>
    );
  }
  if (res.receipts.length === 0) {
    return <p className="text-[15px] text-ink-2">No trades or refusals yet.</p>;
  }
  return (
    <>
      {res.source === "record" ? (
        <p className="mb-4 text-[13px] text-ink-3">
          The chain didn&apos;t answer, so these come from the static record built by <span className="num">npm run record</span>.
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {res.receipts.map((r) => (
          <ReceiptCard key={`${r.txHash}:${r.account}`} r={r} />
        ))}
      </ol>
    </>
  );
}
