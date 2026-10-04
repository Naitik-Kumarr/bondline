// The backtest, from docs/data/backtest.json (workstream D). Shown only when D's verifier passed it. Hypothetical covers
// on real Chainlink prices: none of them was sold, and the page says so before it says anything else.
import "server-only";
import { Card } from "@/components/ui/Card";
import { DemoLabel } from "@/components/ui/Pill";
import { Section, SectionHeader } from "@/components/ui/Section";
import { readRepoJson } from "@/lib/external/files";
import { claimVerified } from "@/lib/external/verification";
import { bpsText, int, pct, usd } from "@/components/market/fmt";

interface Agent {
  key?: string;
  name?: string;
  offer?: string;
  scenario?: string;
  covers?: number;
  claims?: number;
  claimRate?: number;
  payouts?: number;
  averagePayout?: number;
  largestPayout?: number;
  offerFee?: { feeBps?: number; premiumBps?: number; lossRatio?: number; annualisedReturnOnReserve?: number };
  modelPrice?: { fairBps?: number; lossRatio?: number; annualisedReturnOnReserve?: number };
  worstLossBps?: { median?: number; max?: number; coversPastHalfTheLimit?: number };
}
interface Backtest {
  generatedAt?: string;
  label?: string;
  source?: { provider?: string; chain?: string; block?: string };
  window?: { from?: string; to?: string; tradingDays?: number };
  parameters?: { principalPerCover?: number; limitBps?: number; holdDays?: number };
  caveats?: string[];
  agents?: Agent[];
}

const n = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "?");

function Cell({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-ink-3">{k}</dt>
      <dd className="num mt-1.5 text-[20px] leading-none tracking-[-0.02em] text-ink">{v}</dd>
      {hint ? <dd className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{hint}</dd> : null}
    </div>
  );
}

export function BacktestSection() {
  if (!claimVerified("D", "backtest")) return null;
  const b = readRepoJson<Backtest>("docs/data/backtest.json");
  const agents = (b?.agents ?? []).filter((a) => n(a.covers));
  if (!b || agents.length === 0) return null;
  const p = b.parameters;
  return (
    <Section spacing="sm" aria-labelledby="backtest-title" id="backtest" className="scroll-mt-24">
      <SectionHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-3">
            Backtest <DemoLabel kind="model">Hypothetical covers</DemoLabel>
          </span>
        }
        title={<span id="backtest-title">Careful and Bold on real Chainlink prices</span>}
        size="m"
        lead={`${b.label ?? "Hypothetical covers on real Chainlink prices. No cover here was sold."} ${
          b.source?.chain ? `Prices: ${b.source.provider ?? "Chainlink"} on ${b.source.chain}.` : ""
        } ${b.window ? `${int(b.window.tradingDays ?? 0)} trading days, ${day(b.window.from)} to ${day(b.window.to)}.` : ""}`}
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        {agents.map((a) => (
          <Card key={a.key ?? a.name}>
            <p className="text-[17px] font-medium tracking-[-0.01em] text-ink">{a.name}</p>
            {a.scenario ? <p className="mt-1 text-[13px] leading-snug text-ink-3">{a.scenario}</p> : null}
            <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3">
              <Cell k="Covers" v={int(a.covers!)} hint={p?.principalPerCover ? `${usd(p.principalPerCover)} each` : undefined} />
              <Cell k="Claims" v={n(a.claims) ? int(a.claims) : "n/a"} hint={n(a.claimRate) ? `${pct(a.claimRate)} of covers` : undefined} />
              <Cell k="Largest payout" v={n(a.largestPayout) ? usd(a.largestPayout, { cents: true }) : "n/a"} />
              <Cell
                k="Worst loss, median"
                v={n(a.worstLossBps?.median) ? pct(a.worstLossBps!.median / 10_000, 1) : "n/a"}
                hint={n(a.worstLossBps?.max) ? `max ${pct(a.worstLossBps!.max / 10_000, 1)}` : undefined}
              />
              <Cell
                k="Model price"
                v={n(a.modelPrice?.fairBps) ? bpsText(a.modelPrice!.fairBps, 1) : "n/a"}
                hint="30 days, 10% limit"
              />
              <Cell
                k="Offer premium"
                v={n(a.offerFee?.premiumBps) ? bpsText(a.offerFee!.premiumBps, 0) : "n/a"}
                hint={n(a.offerFee?.lossRatio) ? `loss ratio ${pct(a.offerFee!.lossRatio, 1)}` : undefined}
              />
            </dl>
          </Card>
        ))}
      </div>
      {b.caveats?.length ? (
        <details className="mt-5 rounded-card border border-line bg-surface px-5 py-4">
          <summary className="cursor-pointer text-[14px] text-ink-2">
            Caveats <span className="num text-ink-3">({b.caveats.length})</span>
          </summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[13.5px] leading-relaxed text-ink-2">
            {b.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-4 text-[13px] text-ink-3">
        Read from docs/data/backtest.json{b.generatedAt ? `, generated ${b.generatedAt.slice(0, 10)}` : ""}. Rerun it with{" "}
        <span className="num">npx tsx scripts/backtest.ts</span>.
      </p>
    </Section>
  );
}
