import { CAP_BPS, STOCK_SYMBOLS, type StockSymbol } from "./constants.ts";
import volatilityJson from "./volatility.json" with { type: "json" };

/**
 * Bondline's reference price: a simple published model, not actuarial. See docs/PRICING.md.
 *
 *   w     = share of the account in stocks
 *   σ     = annual volatility of the most volatile allowed stock
 *   σa    = w × σ
 *   T     = the cover's term in years (30 days on the board)
 *   L     = limit;  band = cap − limit   (cap = 30%)
 *   P     = min(1, 2 × N(−L / (σa × √T)))   chance the account touches its limit (zero drift)
 *   gap   = min(band, 0.5826 × σa × √g)     expected overshoot when a price jump crosses the limit; g = 1.5 / 252
 *   fair  = 2 × P × gap  +  band × r × T    ×2 = loading for fat tails; r = 5% a year cost of the locked reserve
 *
 * 0.5826 = −ζ(1/2) / √(2π), the expected overshoot of a Gaussian random walk over a barrier, in units of one
 * step's standard deviation (Siegmund 1979; Broadie, Glasserman and Kou 1997).
 */
export const PRICING_MODEL = {
  /** Cover pays down to a 30% drop. */
  cap: CAP_BPS / 10_000,
  /** The board quotes 30-day cover. */
  termDays: 30,
  daysPerYear: 365,
  /** g: the variance of one weekend gap, in years: 1.5 trading days. A stated assumption. */
  gapYears: 1.5 / 252,
  /** β = −ζ(1/2)/√(2π): the Gaussian random walk's overshoot constant. */
  overshoot: 0.5826,
  /** The fat-tail loading on the expected payout. */
  loading: 2,
  /** r: what locking the reserve costs the underwriter, per year. */
  reserveRate: 0.05,
} as const;

export const PRICING_LABEL = "A reference price from a simple published model, not actuarial.";

/**
 * Standard normal CDF, N(x). Hart's (1968) double-precision rational approximation, as given by G. West, "Better
 * approximations to cumulative normal functions", Wilmott Magazine (2005). Against erfc: absolute error below 1e-15,
 * relative error below 1e-8 even in the far tail (x < −7). The tests check both.
 */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const z = Math.abs(x);
  let tail: number;
  if (z > 37) {
    tail = 0;
  } else {
    const e = Math.exp((-z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165;
      n = n * z + 33.912866078383;
      n = n * z + 112.079291497871;
      n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      tail = (e * n) / d;
    } else {
      let b = z + 0.65;
      b = z + 4 / b;
      b = z + 3 / b;
      b = z + 2 / b;
      b = z + 1 / b;
      tail = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - tail : tail;
}

export interface PricingInputs {
  /** w: share of the account in stocks, 0 to 1. */
  stockShare: number;
  /** σ: annual volatility of the most volatile allowed stock, e.g. 0.5457. */
  sigma: number;
  /** L: the loss limit, as a share of principal, e.g. 0.10. Must be below the cap. */
  limit: number;
  /** Defaults to 0.30. */
  cap?: number;
  /** Defaults to 30. */
  termDays?: number;
}

/** Every part of the price, as fractions of the amount covered and in basis points (unrounded). */
export interface PriceBreakdown {
  inputs: {
    stockShare: number;
    sigma: number;
    limit: number;
    cap: number;
    termDays: number;
    termYears: number;
    gapYears: number;
    overshoot: number;
    loading: number;
    reserveRate: number;
  };
  /** σa = w × σ. */
  sigmaAccount: number;
  /** cap − L: the most the cover can pay. */
  band: number;
  /** L / (σa √T); Infinity when σa = 0. */
  distance: number;
  /** P: chance the account touches its limit within the term. */
  pTouch: number;
  /** Expected overshoot past the limit when a jump crosses it, capped at the band. */
  gap: number;
  /** loading × P × gap. */
  riskPart: number;
  /** band × r × T. */
  reservePart: number;
  /** riskPart + reservePart. */
  fair: number;
  bps: { pTouch: number; gap: number; riskPart: number; reservePart: number; fair: number };
}

/** The model's fair price for one cover. Throws RangeError on inputs outside the model's domain. */
export function priceCover(input: PricingInputs): PriceBreakdown {
  const { stockShare: w, sigma, limit: L } = input;
  const cap = input.cap ?? PRICING_MODEL.cap;
  const termDays = input.termDays ?? PRICING_MODEL.termDays;
  const { gapYears: g, overshoot, loading, reserveRate: r, daysPerYear } = PRICING_MODEL;

  if (!(w >= 0 && w <= 1)) throw new RangeError(`stockShare must be in [0, 1], got ${w}`);
  if (!(sigma >= 0 && Number.isFinite(sigma))) throw new RangeError(`sigma must be >= 0, got ${sigma}`);
  if (!(cap > 0 && cap <= 1)) throw new RangeError(`cap must be in (0, 1], got ${cap}`);
  if (!(L > 0 && L < cap)) throw new RangeError(`limit must be in (0, cap), got ${L}`);
  if (!(termDays > 0 && Number.isFinite(termDays))) throw new RangeError(`termDays must be > 0, got ${termDays}`);

  const T = termDays / daysPerYear;
  const sigmaAccount = w * sigma;
  const band = cap - L;
  const distance = sigmaAccount > 0 ? L / (sigmaAccount * Math.sqrt(T)) : Number.POSITIVE_INFINITY;
  const pTouch = sigmaAccount > 0 ? Math.min(1, 2 * normalCdf(-distance)) : 0;
  const gap = Math.min(band, overshoot * sigmaAccount * Math.sqrt(g));
  const riskPart = loading * pTouch * gap;
  const reservePart = band * r * T;
  const fair = riskPart + reservePart;

  return {
    inputs: { stockShare: w, sigma, limit: L, cap, termDays, termYears: T, gapYears: g, overshoot, loading, reserveRate: r },
    sigmaAccount,
    band,
    distance,
    pTouch,
    gap,
    riskPart,
    reservePart,
    fair,
    bps: {
      pTouch: pTouch * 10_000,
      gap: gap * 10_000,
      riskPart: riskPart * 10_000,
      reservePart: reservePart * 10_000,
      fair: fair * 10_000,
    },
  };
}

export interface ReferencePrices {
  limit: number;
  termDays: number;
  sigma: number;
  /** w = the rules' maximum stock share. */
  worstCase: PriceBreakdown;
  /** w = the agent's observed exposure (95th percentile); null with no record. */
  record: PriceBreakdown | null;
  /** worstCase.fair − record.fair: what a good record is worth, as a share of the amount covered. */
  recordSaving: number | null;
}

/** The two prices shown per agent: worst case under its rules, and its record. */
export function referencePrices(args: {
  maxStockShare: number;
  observedStockShare: number | null;
  sigma: number;
  limit: number;
  termDays?: number;
  cap?: number;
}): ReferencePrices {
  const { sigma, limit, cap } = args;
  const termDays = args.termDays ?? PRICING_MODEL.termDays;
  const worstCase = priceCover({ stockShare: args.maxStockShare, sigma, limit, cap, termDays });
  const record =
    args.observedStockShare === null
      ? null
      : priceCover({ stockShare: args.observedStockShare, sigma, limit, cap, termDays });
  return { limit, termDays, sigma, worstCase, record, recordSaving: record ? worstCase.fair - record.fair : null };
}

// ------------------------------------------------------------------ σ

/** The parts of shared/src/volatility.json (written by scripts/volatility.ts) that other code reads. */
export interface VolatilityFile {
  generatedAt: string;
  summary: string;
  source: { provider: string; chain: string; chainId: number; rpc: string; block: string; script: string };
  method: Record<string, string | number>;
  sigma: Record<StockSymbol, number>;
  mostVolatile: StockSymbol;
  window: { from: string; to: string; returns: number };
  assets: Record<
    StockSymbol,
    {
      feed: string;
      description: string;
      sigma: number;
      sigmaDaily: number;
      ci95: [number, number];
      window: { from: string; to: string; closes: number; returns: number };
    }
  >;
  caveats: string[];
}

export const VOLATILITY = volatilityJson as unknown as VolatilityFile;

/** σ of the most volatile of `symbols` (every listed stock when empty), from volatility.json. */
export function sigmaOf(symbols: readonly StockSymbol[] = STOCK_SYMBOLS): { symbol: StockSymbol; sigma: number } {
  const list = symbols.length > 0 ? symbols : STOCK_SYMBOLS;
  let best: { symbol: StockSymbol; sigma: number } | null = null;
  for (const symbol of list) {
    const sigma = VOLATILITY.sigma[symbol];
    if (typeof sigma !== "number") throw new Error(`no σ for ${symbol} in volatility.json`);
    if (!best || sigma > best.sigma) best = { symbol, sigma };
  }
  return best!;
}

// ------------------------------------------------------------------ test vectors

/**
 * Fixed vectors for this model and any port of it (e.g. a Rust/Stylus version). Inputs are in basis points and
 * days; outputs are unrounded basis points, computed independently in Python with math.erfc (double precision).
 */
export interface PricingVector {
  name: string;
  stockShareBps: number;
  sigmaBps: number;
  limitBps: number;
  capBps: number;
  termDays: number;
  pTouchBps: number;
  gapBps: number;
  riskBps: number;
  reserveBps: number;
  fairBps: number;
}

export const PRICING_VECTORS: readonly PricingVector[] = [
  { name: "sanity: w 50%, σ 50%, L 10%, 30 days", stockShareBps: 5000, sigmaBps: 5000, limitBps: 1000, capBps: 3000, termDays: 30, pTouchBps: 1629.465024, gapBps: 112.371415, riskBps: 36.621058, reserveBps: 8.219178, fairBps: 44.840236 },
  { name: "sanity: w 100%, σ 50%, L 10%, 30 days", stockShareBps: 10000, sigmaBps: 5000, limitBps: 1000, capBps: 3000, termDays: 30, pTouchBps: 4854.18008, gapBps: 224.742829, riskBps: 218.188433, reserveBps: 8.219178, fairBps: 226.407611 },
  { name: "all cash: w 0", stockShareBps: 0, sigmaBps: 5000, limitBps: 1000, capBps: 3000, termDays: 30, pTouchBps: 0, gapBps: 0, riskBps: 0, reserveBps: 8.219178, fairBps: 8.219178 },
  { name: "Careful's rules: w 30%, TSLA σ 54.57%, L 10%", stockShareBps: 3000, sigmaBps: 5457, limitBps: 1000, capBps: 3000, termDays: 30, pTouchBps: 331.186011, gapBps: 73.585297, riskBps: 4.874084, reserveBps: 8.219178, fairBps: 13.093262 },
  { name: "Bold's rules: w 80%, TSLA σ 54.57%, L 10%", stockShareBps: 8000, sigmaBps: 5457, limitBps: 1000, capBps: 3000, termDays: 30, pTouchBps: 4242.956554, gapBps: 196.227459, riskBps: 166.516917, reserveBps: 8.219178, fairBps: 174.736095 },
  { name: "deep limit: w 80%, σ 54.57%, L 20%", stockShareBps: 8000, sigmaBps: 5457, limitBps: 2000, capBps: 3000, termDays: 30, pTouchBps: 1100.470021, gapBps: 196.227459, riskBps: 43.188487, reserveBps: 4.109589, fairBps: 47.298076 },
  { name: "AMZN only, short term: w 60%, σ 39.32%, L 5%, 7 days", stockShareBps: 6000, sigmaBps: 3932, limitBps: 500, capBps: 3000, termDays: 7, pTouchBps: 1259.197539, gapBps: 106.042657, riskBps: 26.70573, reserveBps: 2.39726, fairBps: 29.102991 },
  { name: "tight limit: w 100%, σ 100%, L 1%", stockShareBps: 10000, sigmaBps: 10000, limitBps: 100, capBps: 3000, termDays: 30, pTouchBps: 9721.748312, gapBps: 449.485658, riskBps: 873.957288, reserveBps: 11.917808, fairBps: 885.875096 },
  { name: "gap capped by band: w 100%, σ 300%, L 29%", stockShareBps: 10000, sigmaBps: 30000, limitBps: 2900, capBps: 3000, termDays: 30, pTouchBps: 7359.80779, gapBps: 100, riskBps: 147.196156, reserveBps: 0.410959, fairBps: 147.607115 },
  { name: "long term: w 50%, σ 54.57%, L 15%, 365 days", stockShareBps: 5000, sigmaBps: 5457, limitBps: 1500, capBps: 3000, termDays: 365, pTouchBps: 5824.89066, gapBps: 122.642162, riskBps: 142.875437, reserveBps: 75, fairBps: 217.875437 },
];

/** Runs `priceCover` on a vector's inputs. */
export const priceVector = (v: PricingVector) =>
  priceCover({
    stockShare: v.stockShareBps / 10_000,
    sigma: v.sigmaBps / 10_000,
    limit: v.limitBps / 10_000,
    cap: v.capBps / 10_000,
    termDays: v.termDays,
  });
