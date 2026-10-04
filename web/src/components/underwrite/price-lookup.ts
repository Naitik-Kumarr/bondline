// Client-safe half of prices.ts: the table shapes and the lookup. No model code here.
import type { PersonaKey } from "@/components/account/kit/bondline";

export const LIMIT_STEP_BPS = 50;

export interface AgentPriceTable {
  /** Fair price in bps of the amount covered, for limits LIMIT_STEP_BPS, 2×, … below the cap. */
  worst: number[];
  /** Same, at the agent's observed exposure; null with no record. */
  record: number[] | null;
  maxStockBps: number;
  exposureP95: number | null;
  score: number | null;
}

export interface PriceTables {
  agents: Record<PersonaKey, AgentPriceTable>;
  sigma: number;
  sigmaAsset: string;
  sigmaWindow: string;
  termDays: number;
}

/** The table's price at a limit, snapped to the grid. */
export function priceAt(table: number[], limitBps: number): number | null {
  const i = Math.round(limitBps / LIMIT_STEP_BPS) - 1;
  return i >= 0 && i < table.length ? table[i] : null;
}
