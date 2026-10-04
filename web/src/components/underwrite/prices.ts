// Server only. Reference prices for the underwrite flow, worked out on the server from the published model and the agents'
// records, so neither ships to the browser. The client looks prices up by limit in a 0.5% grid.
import { CAP_BPS } from "@bondline/shared/constants";
import { PRICING_MODEL, priceCover, sigmaOf, VOLATILITY } from "@bondline/shared/pricing";
import { RECORDS_INDEX } from "@bondline/shared/record";
import { AGENTS, type PersonaKey } from "@/components/account/kit/bondline";
import { LIMIT_STEP_BPS, type AgentPriceTable, type PriceTables } from "./price-lookup";

/** "2026-06-23" → "23 Jun 2026". */
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const limits = () => {
  const out: number[] = [];
  for (let l = LIMIT_STEP_BPS; l < CAP_BPS; l += LIMIT_STEP_BPS) out.push(l);
  return out;
};

export function buildPriceTables(): PriceTables {
  const { symbol, sigma } = sigmaOf();
  const grid = limits();
  const agents = Object.fromEntries(
    AGENTS.map((a) => {
      const summary = RECORDS_INDEX.agents.find((s) => s.agent.toLowerCase() === a.address.toLowerCase());
      const observed = summary?.hasRecord && summary.exposureP95 !== null ? summary.exposureP95 : null;
      const at = (w: number) => grid.map((l) => priceCover({ stockShare: w, sigma, limit: l / 10_000 }).bps.fair);
      return [
        a.key,
        {
          worst: at(a.maxStockBps / 10_000),
          record: observed === null ? null : at(observed),
          maxStockBps: a.maxStockBps,
          exposureP95: observed,
          score: summary?.score ?? null,
        },
      ];
    }),
  ) as Record<PersonaKey, AgentPriceTable>;
  return {
    agents,
    sigma,
    sigmaAsset: symbol,
    sigmaWindow: `${day(VOLATILITY.window.from)} – ${day(VOLATILITY.window.to)}`,
    termDays: PRICING_MODEL.termDays,
  };
}
