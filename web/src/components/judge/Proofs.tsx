// Formal-proof and mutation-testing numbers, from contracts/reports/proofs.json (workstream A). Each block renders only
// when A's verifier passed it (verification/A.json: "pass", or "partial" with the claim named in verified[]). With none
// verified the section is absent, not empty.
import "server-only";
import { Card } from "@/components/ui/Card";
import { DemoLabel } from "@/components/ui/Pill";
import { Section, SectionHeader } from "@/components/ui/Section";
import { readRepoJson } from "@/lib/external/files";
import { claimVerified } from "@/lib/external/verification";
import { int, pct } from "@/components/market/fmt";

type Json = Record<string, unknown>;
interface Proofs {
  halmos?: { properties?: unknown[] } & Json;
  invariants?: Json;
  mutation?: { total?: number; killed?: number; survived?: number; survivors?: unknown[] } & Json;
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const label = (x: unknown): string => {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const o = x as Json;
    const name = o.name ?? o.property ?? o.id ?? o.title ?? o.mutant ?? o.description;
    const where = o.file ? ` (${String(o.file)}${o.line ? `:${String(o.line)}` : ""})` : "";
    if (typeof name === "string") return name + where;
    return JSON.stringify(x).slice(0, 160);
  }
  return String(x);
};
const words = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function Tile({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="border-b border-r border-line p-5 sm:p-6">
      <dt className="text-[13px] text-ink-3">{title}</dt>
      <dd className="num mt-1.5 text-[26px] leading-none tracking-[-0.02em] text-ink sm:text-[28px]">{value}</dd>
      {hint ? <dd className="mt-2 text-[12.5px] leading-snug text-ink-3">{hint}</dd> : null}
    </div>
  );
}

function List({ title, items }: { title: string; items: unknown[] }) {
  if (items.length === 0) return null;
  return (
    <details className="group border-t border-line px-5 py-4 sm:px-6">
      <summary className="cursor-pointer text-[14px] text-ink-2 marker:text-ink-3">
        {title} <span className="num text-ink-3">({int(items.length)})</span>
      </summary>
      <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-ink-2">
        {items.slice(0, 80).map((it, i) => (
          <li key={i} className="num break-words">
            {label(it)}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ProofsSection() {
  const proofs = readRepoJson<Proofs>("contracts/reports/proofs.json");
  if (!proofs) return null;
  const showHalmos = proofs.halmos && claimVerified("A", "halmos", "symbolic");
  const showInv = proofs.invariants && claimVerified("A", "invariant");
  const showMut = proofs.mutation && claimVerified("A", "mutation", "mutant");
  if (!showHalmos && !showInv && !showMut) return null;

  const halmos = (proofs.halmos?.properties ?? []) as Json[];
  const proven = halmos.reduce((n, p) => n + (isNum(p.proven) ? p.proven : 0), 0);
  const instances = halmos.reduce((n, p) => n + (isNum(p.instances) ? p.instances : 0), 0);
  const timedOut = halmos.reduce((n, p) => n + (isNum(p.timedOut) ? p.timedOut : 0), 0);
  // Each property with its own verdict ("proven within stated bounds", timeouts), never just its name.
  const halmosItems = halmos.map((p) => `${String(p.id ?? "")}: ${String(p.name ?? "")}. ${String(p.status ?? "")}`.trim());
  const m = proofs.mutation;
  const survivorItems = ((m?.survivors ?? []) as Json[]).map((x) =>
    typeof x === "object" && x && "mutation" in x
      ? `line ${String(x.line ?? "?")}: ${String(x.mutation)}${x.note ? ` (${String(x.note)})` : ""}`
      : label(x),
  );
  const invNums = Object.entries(proofs.invariants ?? {}).flatMap(([k, v]) =>
    isNum(v) ? [[words(k), int(v)] as const] : Array.isArray(v) ? [[words(k), int(v.length)] as const] : [],
  );
  const invList = Object.values(proofs.invariants ?? {}).find((v): v is unknown[] => Array.isArray(v) && v.length > 0 && typeof v[0] !== "number");

  return (
    <Section spacing="sm" aria-labelledby="proofs-title" id="proofs" className="scroll-mt-24">
      <SectionHeader
        eyebrow="Proofs"
        title={<span id="proofs-title">Symbolic proofs, invariants, mutation testing</span>}
        size="m"
        lead="Read from contracts/reports/proofs.json. Each block appears only after an independent verifier re-ran it."
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {showHalmos ? (
          <Card padding="none" className="overflow-hidden">
            <dl>
              <Tile
                title="Halmos proof instances"
                value={instances > 0 ? `${int(proven)} of ${int(instances)}` : int(halmos.length)}
                hint={`${int(halmos.length)} properties, proven within stated bounds: each P1 to P4 instance fixes the deposit or the limit and leaves the rest symbolic; P5 holds within its stated assumptions.${timedOut > 0 ? ` ${int(timedOut)} timed out and are not proven.` : ""}`}
              />
            </dl>
            <List title="Properties" items={halmosItems} />
          </Card>
        ) : null}
        {showInv ? (
          <Card padding="none" className="overflow-hidden">
            <dl className="grid grid-cols-2">
              {invNums.slice(0, 4).map(([k, v]) => (
                <Tile key={k} title={k} value={v} hint={/calls/i.test(k) ? "handler calls; those whose precondition fails return early" : undefined} />
              ))}
            </dl>
            {invList ? <List title="Invariants" items={invList} /> : null}
          </Card>
        ) : null}
        {showMut && m ? (
          <Card padding="none" className="overflow-hidden">
            <dl className="grid grid-cols-2">
              <Tile
                title="Mutants"
                value={isNum(m.total) ? int(m.total) : "n/a"}
                hint={`deliberate bugs in BondlineCover.sol that compile${isNum(m.compileFailures) ? `; ${int(m.compileFailures)} more didn't` : ""}`}
              />
              <Tile
                title="Caught by tests"
                value={isNum(m.killed) ? int(m.killed) : "n/a"}
                hint={isNum(m.killed) && isNum(m.total) && m.total > 0 ? `${pct(m.killed / m.total)} of them` : undefined}
              />
              <Tile title="Survived" value={isNum(m.survived) ? int(m.survived) : "n/a"} hint="judged equivalent by reading the code; listed below" />
            </dl>
            <List title="Surviving mutants" items={survivorItems} />
          </Card>
        ) : null}
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
        <DemoLabel kind="model">Not an audit</DemoLabel> Proofs cover the properties listed, not the whole system. See What nobody can do above.
      </p>
    </Section>
  );
}
