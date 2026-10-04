import { addressUrl } from "@bondline/shared/chain";
import { isLocalFork } from "@bondline/shared/deployment";
import type { ReactNode } from "react";
import { int } from "@/components/market/fmt";
import { Card } from "@/components/ui/Card";
import { ArrowUpRightIcon, CheckIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";
import { Reveal } from "@/components/ui/Reveal";
import type { ContractRow } from "./contracts";
import type { Reports } from "./reports";

function Tile({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-r border-line p-5 sm:p-6">
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className="num mt-1.5 text-[26px] leading-none tracking-[-0.02em] text-ink sm:text-[30px]">{value}</p>
      {children ? <div className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3">{children}</div> : null}
    </div>
  );
}

const missing = <span className="font-sans text-[16px] tracking-normal text-ink-3">no report</span>;

/** Tests, coverage, Slither and gas from contracts/reports (read at build time), and every deployed contract. */
export function Quality({
  reports,
  contracts,
  verified,
}: {
  reports: Reports;
  contracts: ContractRow[];
  verified: Map<string, boolean | null>;
}) {
  const { tests, coverage, slither, gas } = reports;
  return (
    <div className="flex flex-col gap-4">
      <Reveal>
        <Card padding="none" className="overflow-hidden">
          <div className="-mr-px grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Foundry tests" value={tests ? int(tests.suite) : missing}>
              {tests ? (
                <>
                  <span className="num">{int(tests.unit)}</span> unit, <span className="num">{int(tests.fuzz)}</span>{" "}
                  fuzz, <span className="num">{int(tests.invariant)}</span> invariants.{" "}
                  {tests.result ? (
                    <>
                      Last run{tests.fork > 0 ? <>, with the <span className="num">{int(tests.fork)}</span> fork tests</> : null}:{" "}
                      <span className="num">{int(tests.result.passed)}</span> passed,{" "}
                      <span className="num">{int(tests.result.failed)}</span> failed.
                    </>
                  ) : (
                    <>Counted from contracts/test when this page was built.</>
                  )}
                </>
              ) : null}
            </Tile>
            <Tile label="Line coverage" value={coverage ? `${coverage.lines.pct}%` : missing}>
              {coverage ? (
                <>
                  <span className="num">
                    {int(coverage.lines.hit)}/{int(coverage.lines.total)}
                  </span>{" "}
                  lines. Statements <span className="num">{coverage.statements.pct}%</span>, branches{" "}
                  <span className="num">{coverage.branches.pct}%</span>, functions{" "}
                  <span className="num">{coverage.functions.pct}%</span>.
                </>
              ) : null}
            </Tile>
            <Tile
              label="Slither"
              value={
                slither ? (
                  <>
                    {slither.high} <span className="font-sans text-[15px] tracking-normal text-ink-3">High</span>
                    <span className="mx-2 text-ink-4">·</span>
                    {slither.medium} <span className="font-sans text-[15px] tracking-normal text-ink-3">Medium</span>
                  </>
                ) : (
                  missing
                )
              }
            >
              {slither ? (
                <>
                  Plus <span className="num">{int(slither.low)}</span> Low and{" "}
                  <span className="num">{int(slither.informational)}</span> informational findings
                  {slither.title ? <> ({slither.title.replace(/^Slither\s*\(([^)]+)\)/i, "Slither $1")})</> : null}.
                </>
              ) : null}
            </Tile>
            <Tile label="Fork tests" value={tests ? int(tests.fork) : missing}>
              Against the real USDG on Robinhood Chain testnet, and Chainlink&apos;s TSLA and AMZN feeds on a mainnet
              fork. Run with <span className="num">FORK_TESTS=true</span>.
            </Tile>
          </div>
        </Card>
      </Reveal>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Reveal className="h-full">
          <Card className="h-full">
            <h3 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Gas, from the test suite</h3>
            <p className="mt-1 text-[12.5px] text-ink-3">contracts/reports/gas.txt · median and max per call</p>
            {gas ? (
              <table className="mt-5 w-full table-fixed text-[13.5px]">
                <thead>
                  <tr className="text-[12px] text-ink-3">
                    <th scope="col" className="pb-2 text-left font-normal">
                      Call
                    </th>
                    <th scope="col" className="w-[5.5rem] pb-2 text-right font-normal">
                      Median
                    </th>
                    <th scope="col" className="w-[5.5rem] pb-2 text-right font-normal">
                      Max
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {gas.map((g) => (
                    <tr key={`${g.contract}.${g.fn}`} className="border-t border-line">
                      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                        <span className="num text-ink [overflow-wrap:anywhere]">{g.fn}</span>
                        <span className="block text-[11.5px] text-ink-3">{g.contract}</span>
                      </th>
                      <td className="num py-2.5 text-right text-ink-2">{int(g.median)}</td>
                      <td className="num py-2.5 pl-3 text-right text-ink-2">{int(g.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-5 text-[14px] text-ink-3">No gas report found.</p>
            )}
          </Card>
        </Reveal>

        <Reveal className="h-full" delay={0.06}>
          <Card className="h-full">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Every deployed contract</h3>
              <p className="text-[12.5px] text-ink-3">
                {isLocalFork ? "Local fork: verification shows on the public testnet" : "Verified source, checked live on the explorer"}
              </p>
            </div>
            <ul className="mt-5 divide-y divide-line">
              {contracts.map((c) => {
                const v = verified.get(c.address.toLowerCase());
                return (
                  <li key={c.address} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3">
                    <div className="min-w-0">
                      <p className="num text-[13.5px] text-ink">{c.name}</p>
                      <p className="text-[12.5px] text-ink-3">{c.role}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {v === true ? (
                        <Pill size="sm" tone="positive" icon={<CheckIcon size={12} />}>
                          Verified
                        </Pill>
                      ) : v === false ? (
                        <Pill size="sm" tone="caution">
                          Not verified
                        </Pill>
                      ) : null}
                      <a
                        href={addressUrl(c.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="num inline-flex items-center gap-1 text-[12.5px] text-ink-2 underline decoration-ink/20 underline-offset-4 hover:decoration-ink/60"
                        title={c.address}
                      >
                        {c.address.slice(0, 6)}…{c.address.slice(-4)}
                        <ArrowUpRightIcon size={12} />
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
