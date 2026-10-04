import type { MarketKey } from "@bondline/shared";
import type { Address } from "viem";
import { bpsPct, duration, int } from "@/components/market/fmt";
import { Pill } from "@/components/ui/Pill";
import { readAccountRules, type AccountRules } from "./data";

const keyOf = (r: AccountRules) =>
  [r.market, r.assets.join("+"), r.maxStockBps, r.maxTradeBps, r.maxDailyBps, r.maxSlippageBps, r.maxPriceAge].join("|");

const ROWS: [string, (r: AccountRules) => string][] = [
  ["Stocks", (r) => r.assets.join(", ") || "none"],
  ["Most in stocks", (r) => bpsPct(r.maxStockBps)],
  ["Largest trade", (r) => bpsPct(r.maxTradeBps)],
  ["Per day", (r) => bpsPct(r.maxDailyBps)],
  ["Slippage", (r) => bpsPct(r.maxSlippageBps)],
  ["Oldest price", (r) => duration(r.maxPriceAge)],
];

/**
 * The rules each covered account enforces on the agent, read from the account contracts: one column per distinct set
 * (usually one per market). Sizes are shares of the account's value.
 */
export async function RulesList({ accounts }: { accounts: { address: Address; market: MarketKey }[] }) {
  const rules = await readAccountRules(accounts);
  if (rules === null) return <p className="text-[13.5px] text-ink-3">Couldn&apos;t read the rules from the chain just now.</p>;
  if (rules.length === 0) return <p className="text-[13.5px] text-ink-3">No covered accounts yet.</p>;
  const groups = new Map<string, AccountRules[]>();
  for (const r of rules) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const cols = [...groups.values()];
  const stopped = rules.filter((r) => r.stopped).length;
  const paused = rules.filter((r) => r.paused && !r.stopped).length;
  return (
    <div className="flex flex-col gap-4">
      {/* Desktop: one row per set of rules (usually one per market). */}
      <div className="hidden overflow-hidden rounded-field border border-line md:block">
        <table className="w-full text-[13px]">
          <caption className="sr-only">The rules of each covered account</caption>
          <thead>
            <tr className="border-b border-line bg-page/60 text-[12px] text-ink-3">
              <th scope="col" className="px-4 py-2.5 text-left font-normal">
                Accounts
              </th>
              {ROWS.map(([label]) => (
                <th key={label} scope="col" className="px-4 py-2.5 text-right font-normal">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {cols.map((g) => (
              <tr key={keyOf(g[0])}>
                <th scope="row" className="px-4 py-3 text-left font-normal text-ink-2">
                  {g[0].market === "replay" ? "Replay market" : "Live market"}
                  {g.length > 1 ? <span className="num text-ink-3"> ×{g.length}</span> : null}
                </th>
                {ROWS.map(([label, value]) => (
                  <td key={label} className="num whitespace-nowrap px-4 py-3 text-right text-ink">
                    {value(g[0])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones: one column per set. */}
      <div className="overflow-hidden rounded-field border border-line md:hidden">
        <table className="w-full text-[13px]">
          <caption className="sr-only">The rules of each covered account, by market</caption>
          {cols.length > 1 ? (
            <thead>
              <tr className="border-b border-line bg-page/60 text-[12px] text-ink-3">
                <th scope="col" className="px-3.5 py-2 text-left font-normal">
                  Rule
                </th>
                {cols.map((g) => (
                  <th key={keyOf(g[0])} scope="col" className="px-3.5 py-2 text-right font-normal">
                    {g[0].market === "replay" ? "Replay" : "Live"}
                    {g.length > 1 ? <span className="num"> ×{g.length}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody className="divide-y divide-line">
            {ROWS.map(([label, value]) => (
              <tr key={label}>
                <th scope="row" className="px-3.5 py-2.5 text-left font-normal text-ink-3">
                  {label}
                </th>
                {cols.map((g) => (
                  <td key={keyOf(g[0])} className="num whitespace-nowrap px-3.5 py-2.5 text-right text-ink">
                    {value(g[0])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">
        Trade sizes are shares of the account&apos;s value; the stock share is checked after every buy.
      </p>
      {stopped || paused ? (
        <div className="flex flex-wrap gap-2">
          {stopped ? (
            <Pill size="sm" tone="bond" dot>
              {int(stopped)} account{stopped === 1 ? "" : "s"} stopped by the cover
            </Pill>
          ) : null}
          {paused ? (
            <Pill size="sm" tone="caution" dot>
              {int(paused)} paused by the user
            </Pill>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
