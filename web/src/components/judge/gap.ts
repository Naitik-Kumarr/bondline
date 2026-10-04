// The scripted gap demo's record, written by the keeper on the real testnet to deployments/gap-demo.json.
// Bundled when the site is built (absent until the demo runs). Only that exact file is read: never a fork's copy.
// /judge shows it only when its settle transaction is among the Settled events of the chain the site reads.
import "server-only";

interface Push {
  symbol?: string;
  price?: string;
  tx?: string;
}

export interface GapRecord {
  label?: string;
  market?: string;
  cover?: string;
  account?: string;
  user?: string;
  agent?: string;
  keeper?: string;
  limitBps?: number;
  principal?: string;
  friday?: { drawdownBps?: number; valueAfter?: string; lossAfter?: string; lossBps?: number; pushes?: Push[] };
  weekend?: { seconds?: number; marketMaxPriceAge?: number };
  monday?: { drawdownBps?: number; targetValue?: string; pushes?: Push[] };
  settle?: {
    tx?: string;
    caller?: string;
    settledBy?: string;
    value?: string;
    loss?: string;
    limit?: string;
    payout?: string;
  };
  summary?: { principal?: string; userLoses?: string; bondPays?: string; settleTx?: string };
  completedAt?: string;
}

export async function readGapDemo(): Promise<GapRecord | null> {
  const file = "gap-demo.json";
  try {
    // Webpack (next build) bundles the file when it exists; Turbopack (dev only) skips it.
    const mod = await import(
      /* webpackInclude: /[\\/]gap-demo\.json$/ */
      /* webpackMode: "eager" */
      /* turbopackIgnore: true */
      `../../../../deployments/${file}`
    );
    const record = (mod.default ?? mod) as GapRecord;
    return record && typeof record === "object" ? record : null;
  } catch {
    return null;
  }
}

/** The settle transaction the record names, lowercased. */
export const gapSettleTx = (g: GapRecord | null) => (g?.settle?.tx ?? g?.summary?.settleTx ?? null)?.toLowerCase() ?? null;
