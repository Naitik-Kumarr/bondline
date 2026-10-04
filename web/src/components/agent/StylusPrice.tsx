import { CAP_BPS } from "@bondline/shared/constants";
import { addressUrl, txUrl } from "@bondline/shared/chain";
import type { AgentPrices } from "@/components/market/data";
import { bpsText, modelPct, pct } from "@/components/market/fmt";
import { Card } from "@/components/ui/Card";
import { ArrowUpRightIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { Section, SectionHeader } from "@/components/ui/Section";
import {
  offchainFair,
  readOffchainPrices,
  readStylusPricer,
  stylusQuote,
  stylusVectorCheck,
  tsFairBps,
  type OffchainPrices,
  type QuoteInputs,
  type StylusPricer,
} from "@/lib/stylus";

function Row({
  title,
  share,
  ts,
  rust,
  rustLabel = "Rust (Stylus, onchain)",
  rounding = "the contract's rounding to 0.0001 bps",
}: {
  title: string;
  share: number;
  ts: number;
  rust: number | null;
  rustLabel?: string;
  rounding?: string;
}) {
  const diff = rust == null ? null : rust - ts;
  return (
    <Card tone="surface">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="num mt-1 text-[12.5px] text-ink-3">w = {pct(share)} in stocks</p>
      <dl className="mt-5 grid grid-cols-2 gap-5">
        <div>
          <dt className="text-[12.5px] text-ink-3">TypeScript (this site)</dt>
          <dd className="num mt-1.5 text-[26px] leading-none tracking-[-0.02em] text-ink">{modelPct(ts)}</dd>
          <dd className="num mt-1.5 text-[12px] text-ink-3">{bpsText(ts, 4)}</dd>
        </div>
        <div>
          <dt className="text-[12.5px] text-ink-3">{rustLabel}</dt>
          <dd className="num mt-1.5 text-[26px] leading-none tracking-[-0.02em] text-accent-ink">
            {rust == null ? "n/a" : modelPct(rust)}
          </dd>
          <dd className="num mt-1.5 text-[12px] text-ink-3">{rust == null ? "call failed" : bpsText(rust, 4)}</dd>
        </div>
      </dl>
      {diff != null ? (
        <p className="mt-4 text-[12.5px] text-ink-3">
          Difference <span className="num text-ink-2">{bpsText(Math.abs(diff), 4)}</span>
          {Math.abs(diff) <= 2e-4 ? ` (${rounding})` : ""}.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * The reference price computed by a Rust (Stylus) contract on the testnet, next to the TypeScript one on this site, for the
 * same inputs. Server component: renders nothing unless the Stylus pricer is deployed and verified.
 */
export async function StylusPriceSection({
  prices,
  pricer = readStylusPricer(),
  offchain = pricer ? null : readOffchainPrices(),
}: {
  prices: AgentPrices;
  pricer?: StylusPricer | null;
  offchain?: OffchainPrices | null;
}) {
  if ((!pricer && !offchain) || prices.worstCaseBps == null || prices.worstCaseShare == null) return null;
  const base = { sigmaBps: Math.round(prices.sigma * 10_000), termDays: prices.termDays, limitBps: prices.limitBps, capBps: CAP_BPS };
  const cases: { title: string; share: number; inputs: QuoteInputs }[] = [
    { title: "Reference price at the maximum stock share allowed after a buy", share: prices.worstCaseShare, inputs: { ...base, wBps: Math.round(prices.worstCaseShare * 10_000) } },
  ];
  if (prices.recordBps != null && prices.recordShare != null) {
    cases.push({ title: "Its record", share: prices.recordShare, inputs: { ...base, wBps: Math.round(prices.recordShare * 10_000) } });
  }
  if (!pricer) return <OffchainSection cases={cases} table={offchain!} />;
  const [quotes, vectors] = await Promise.all([Promise.all(cases.map((c) => stylusQuote(pricer, c.inputs))), stylusVectorCheck(pricer)]);
  return (
    <Section spacing="sm" aria-labelledby="stylus">
      <SectionHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-3">
            Same model, onchain <Pill size="sm" tone="accent">Rust · Stylus</Pill>
          </span>
        }
        title={<span id="stylus">The price from a Rust contract</span>}
        size="m"
        lead="The same published model, written in Rust and deployed on Robinhood Chain testnet with Stylus. The site calls it with the agent's inputs and shows it beside the TypeScript price."
      />
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {cases.map((c, i) => (
          <Row key={c.title} title={c.title} share={c.share} ts={tsFairBps(c.inputs)} rust={quotes[i]?.fairBps ?? null} />
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-3">
        <a href={addressUrl(pricer.address)} target="_blank" rel="noopener noreferrer" className="num inline-flex items-center gap-1 text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60">
          pricer {pricer.address.slice(0, 10)}…{pricer.address.slice(-6)} <ArrowUpRightIcon size={12} />
        </a>
        {pricer.deployTx ? (
          <a href={txUrl(pricer.deployTx)} target="_blank" rel="noopener noreferrer" className="num inline-flex items-center gap-1 text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60">
            deploy tx <ArrowUpRightIcon size={12} />
          </a>
        ) : null}
        {vectors ? (
          <span>
            Checked when this page rendered: <span className="num text-ink-2">{vectors.matched} of {vectors.total}</span> shared reference
            vectors match onchain.
          </span>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * The Rust pricer can't be deployed (Stylus activations are paused on Robinhood Chain), so this shows the answers of
 * the exact program cargo-stylus would deploy, computed off-chain, beside the TypeScript price. Labelled as off-chain.
 */
function OffchainSection({ cases, table }: { cases: { title: string; share: number; inputs: QuoteInputs }[]; table: OffchainPrices }) {
  const rows = cases.map((c) => ({ ...c, rust: offchainFair(table, c.inputs) }));
  if (rows.every((r) => r.rust == null)) return null;
  return (
    <Section spacing="sm" aria-labelledby="stylus">
      <SectionHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-3">
            Same model, in Rust <Pill size="sm" tone="accent">Rust · Stylus · offchain</Pill>
          </span>
        }
        title={<span id="stylus">The price from the Rust pricer</span>}
        size="m"
        lead="The same published model, written in Rust for Stylus. Stylus activations are paused on Robinhood Chain (ArbWasm reports an activation cost of 2^64 − 1), so the pricer isn't deployed. These are the answers of the exact program cargo-stylus would deploy, computed offchain."
      />
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <Row
            key={r.title}
            title={r.title}
            share={r.share}
            ts={tsFairBps(r.inputs)}
            rust={r.rust}
            rustLabel="Rust (Stylus program, offchain)"
            rounding="the program's rounding to 0.0001 bps"
          />
        ))}
      </div>
      <p className="mt-5 text-[13px] leading-relaxed text-ink-3">
        Program codehash <span className="num text-ink-2">{table.codeHash.slice(0, 10)}…{table.codeHash.slice(-6)}</span>. At
        these inputs, all <span className="num text-ink-2">{table.matching.toLocaleString("en-US")}</span> stock shares from 0% to
        100% (1 bps steps) give the same integer price in Rust and TypeScript. Not an onchain call.
      </p>
    </Section>
  );
}
