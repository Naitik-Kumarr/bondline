// The Rust (Stylus) pricer on the testnet: BondlinePricer.quote(wBps, sigmaBps, termDays, limitBps, capBps), read with
// eth_call. Shown only when its verifier has passed it (verification/B.json). Outputs are basis points x 1e4.
import "server-only";
import { parseAbi, type Abi, type Address } from "viem";
import { PRICING_VECTORS, priceCover } from "@bondline/shared";
import { publicClient } from "@/lib/bondline/book";
import { readRepoJson } from "@/lib/external/files";
import { claimVerified } from "@/lib/external/verification";

const quoteAbi = parseAbi([
  "function quote(uint256 wBps, uint256 sigmaBps, uint256 termDays, uint256 limitBps, uint256 capBps) view returns (uint256 pHitBps, uint256 gapBps, uint256 riskBps, uint256 reserveBps, uint256 fairBps)",
]);

export interface StylusPricer {
  address: Address;
  deployTx: string | null;
  abi: Abi;
}

/** The verified Stylus pricer record, or null (not deployed, or B's verifier hasn't passed it). */
export function readStylusPricer(): StylusPricer | null {
  // Needles name the on-chain claim itself: a verified claim about the Rust model alone (or one saying activation is paused) must not unlock this.
  if (!claimVerified("B", "deployed and callable", "callable on robinhood", "on-chain quote")) return null;
  const f = readRepoJson<{ address?: string; deployTx?: string; abi?: Abi }>("deployments/stylus-pricer.json");
  if (!f?.address || !/^0x[0-9a-fA-F]{40}$/.test(f.address)) return null;
  const hasQuote = Array.isArray(f.abi) && f.abi.some((x) => x.type === "function" && x.name === "quote");
  return { address: f.address as Address, deployTx: f.deployTx ?? null, abi: hasQuote ? (f.abi as Abi) : quoteAbi };
}

export interface StylusQuote {
  /** Basis points, de-scaled from the contract's bps x 1e4. */
  pHitBps: number;
  gapBps: number;
  riskBps: number;
  reserveBps: number;
  fairBps: number;
}

export interface QuoteInputs {
  wBps: number;
  sigmaBps: number;
  termDays: number;
  limitBps: number;
  capBps: number;
}

/** One quote from the chain. Null when the call fails. */
export async function stylusQuote(p: StylusPricer, i: QuoteInputs): Promise<StylusQuote | null> {
  try {
    const r = (await publicClient.readContract({
      address: p.address,
      abi: p.abi,
      functionName: "quote",
      args: [BigInt(i.wBps), BigInt(i.sigmaBps), BigInt(i.termDays), BigInt(i.limitBps), BigInt(i.capBps)],
    } as never)) as readonly bigint[];
    const d = (n: bigint) => Number(n) / 1e4;
    return { pHitBps: d(r[0]), gapBps: d(r[1]), riskBps: d(r[2]), reserveBps: d(r[3]), fairBps: d(r[4]) };
  } catch {
    return null;
  }
}

/**
 * The Rust program's answers computed off-chain (stylus/offchain-prices.json, from stylus/scripts/offchain-prices.ts):
 * Stylus activations are paused on Robinhood Chain, so the program can't be deployed and called. Shown only once B's
 * verifier has checked that file by name.
 */
export interface OffchainPrices {
  codeHash: string;
  generatedAt: string;
  inputs: { sigmaBps: number; termDays: number; limitBps: number; capBps: number };
  /** Fair price in bps x 1e4, for w = index bps in stocks (0..10,000). */
  fairByWBps: number[];
  /** How many of those the TypeScript model matches exactly. */
  matching: number;
}

export function readOffchainPrices(): OffchainPrices | null {
  if (!claimVerified("B", "offchain-prices.json")) return null;
  const f = readRepoJson<{
    generatedAt?: string;
    program?: { codeHash?: string };
    inputs?: OffchainPrices["inputs"];
    fairByWBps?: number[];
    typescriptCheck?: { compared?: number; matching?: number };
  }>("stylus/offchain-prices.json");
  if (!f?.program?.codeHash || !f.inputs || !Array.isArray(f.fairByWBps) || f.fairByWBps.length !== 10_001) return null;
  if (f.typescriptCheck?.matching == null || f.typescriptCheck.matching !== f.typescriptCheck.compared) return null;
  return { codeHash: f.program.codeHash, generatedAt: f.generatedAt ?? "", inputs: f.inputs, fairByWBps: f.fairByWBps, matching: f.typescriptCheck.matching };
}

/** The off-chain Rust fair price (bps) for these inputs, or null when the table wasn't computed for them. */
export function offchainFair(t: OffchainPrices, i: QuoteInputs): number | null {
  const same = i.sigmaBps === t.inputs.sigmaBps && i.termDays === t.inputs.termDays && i.limitBps === t.inputs.limitBps && i.capBps === t.inputs.capBps;
  if (!same || !Number.isInteger(i.wBps) || i.wBps < 0 || i.wBps > 10_000) return null;
  return t.fairByWBps[i.wBps] / 1e4;
}

/** The TypeScript model's fair price (bps) for the same integer inputs. */
export const tsFairBps = (i: QuoteInputs) =>
  priceCover({
    stockShare: i.wBps / 10_000,
    sigma: i.sigmaBps / 10_000,
    limit: i.limitBps / 10_000,
    cap: i.capBps / 10_000,
    termDays: i.termDays,
  }).bps.fair;

/** Runs the shared reference vectors through the on-chain pricer: how many match the vectors' fair price. */
export async function stylusVectorCheck(p: StylusPricer): Promise<{ matched: number; total: number } | null> {
  const results = await Promise.all(
    PRICING_VECTORS.map((v) =>
      stylusQuote(p, { wBps: v.stockShareBps, sigmaBps: v.sigmaBps, termDays: v.termDays, limitBps: v.limitBps, capBps: v.capBps }),
    ),
  );
  if (results.some((r) => r == null)) return null;
  const matched = results.filter((r, i) => Math.abs(r!.fairBps - PRICING_VECTORS[i].fairBps) <= 2e-4).length;
  return { matched, total: PRICING_VECTORS.length };
}
