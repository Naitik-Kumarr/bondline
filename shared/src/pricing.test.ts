// Unit tests for the reference-price model. Run: npm run test:model
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalCdf,
  priceCover,
  priceVector,
  PRICING_MODEL,
  PRICING_VECTORS,
  referencePrices,
  sigmaOf,
  VOLATILITY,
} from "./pricing.ts";

/** N(x) = erfc(−x/√2) / 2, from Python's math.erfc (double precision). */
const CDF_REFERENCE: readonly [number, number][] = [
  [-30, 4.9067139271487634e-198],
  [-20, 2.7536241186063314e-89],
  [-10, 7.619853024160593e-24],
  [-8.5, 9.479534822203356e-18],
  [-7.2, 3.0106279811174455e-13],
  [-7.0710678, 7.687299629545495e-13],
  [-6, 9.865876450377014e-10],
  [-5, 2.866515718791945e-7],
  [-4, 3.167124183311996e-5],
  [-3.5, 0.00023262907903552502],
  [-3, 0.0013498980316300957],
  [-2.5, 0.0062096653257761375],
  [-2, 0.022750131948179216],
  [-1.959964, 0.024999999096442415],
  [-1.5, 0.06680720126885809],
  [-1.395229, 0.08147339728307444],
  [-1, 0.15865525393145705],
  [-0.697615, 0.24270899915305957],
  [-0.5, 0.30853753872598694],
  [-0.25, 0.4012936743170763],
  [-0.1, 0.460172162722971],
  [-1e-9, 0.49999999960105773],
  [0, 0.5],
  [0.1, 0.539827837277029],
  [0.5, 0.691462461274013],
  [1, 0.8413447460685429],
  [1.5, 0.9331927987311419],
  [2, 0.9772498680518208],
  [3, 0.9986501019683699],
  [5, 0.9999997133484281],
  [8, 0.9999999999999993],
];

const close = (actual: number, expected: number, tol: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} vs ${expected} (tolerance ${tol})`);

test("normalCdf matches erfc: absolute error below 1e-15, relative error below 1e-8 even in the far tail", () => {
  for (const [x, ref] of CDF_REFERENCE) {
    const v = normalCdf(x);
    close(v, ref, 1e-15, `N(${x})`);
    if (ref > 0) assert.ok(Math.abs(v - ref) / ref < 1e-8, `N(${x}) relative error ${Math.abs(v - ref) / ref}`);
  }
});

test("normalCdf is symmetric and handles the extremes", () => {
  for (let x = -9; x <= 9; x += 0.37) close(normalCdf(x) + normalCdf(-x), 1, 2e-16, `N(${x}) + N(${-x})`);
  assert.equal(normalCdf(-40), 0);
  assert.equal(normalCdf(40), 1);
  assert.equal(normalCdf(Number.NEGATIVE_INFINITY), 0);
  assert.equal(normalCdf(Number.POSITIVE_INFINITY), 1);
  assert.ok(Number.isNaN(normalCdf(Number.NaN)));
});

test("sanity values from the spec: L 10%, cap 30%, 30 days, σ 50%", () => {
  const half = priceCover({ stockShare: 0.5, sigma: 0.5, limit: 0.1 });
  const full = priceCover({ stockShare: 1, sigma: 0.5, limit: 0.1 });
  assert.equal(Math.round(half.bps.riskPart), 37); // "w = 0.5 gives about 37 bps"
  assert.equal(Math.round(full.bps.riskPart), 218); // "w = 1 about 218 bps"
  assert.equal(Math.round(half.bps.reservePart), 8); // "the reserve cost adds about 8 bps"
  assert.equal(half.inputs.termYears, 30 / 365);
  assert.equal(half.inputs.cap, 0.3);
});

test("fixed vectors (shared with any port of the model)", () => {
  assert.ok(PRICING_VECTORS.length >= 10);
  for (const v of PRICING_VECTORS) {
    const b = priceVector(v);
    close(b.bps.pTouch, v.pTouchBps, 1e-5, `${v.name}: P`);
    close(b.bps.gap, v.gapBps, 1e-5, `${v.name}: gap`);
    close(b.bps.riskPart, v.riskBps, 1e-5, `${v.name}: risk part`);
    close(b.bps.reservePart, v.reserveBps, 1e-5, `${v.name}: reserve part`);
    close(b.bps.fair, v.fairBps, 1e-5, `${v.name}: fair`);
  }
});

test("breakdown: fractions and bps agree, and fair = risk part + reserve part", () => {
  const b = priceCover({ stockShare: 0.8, sigma: 0.5457, limit: 0.1 });
  assert.equal(b.sigmaAccount, 0.8 * 0.5457);
  close(b.band, 0.2, 1e-15, "band");
  close(b.distance, 0.1 / (0.8 * 0.5457 * Math.sqrt(30 / 365)), 1e-12, "distance");
  close(b.pTouch, 2 * normalCdf(-b.distance), 1e-15, "P");
  close(b.gap, 0.5826 * 0.8 * 0.5457 * Math.sqrt(1.5 / 252), 1e-15, "gap");
  close(b.riskPart, 2 * b.pTouch * b.gap, 1e-15, "risk part");
  close(b.reservePart, 0.2 * 0.05 * (30 / 365), 1e-15, "reserve part");
  close(b.fair, b.riskPart + b.reservePart, 1e-15, "fair");
  for (const k of ["pTouch", "gap", "riskPart", "reservePart", "fair"] as const) close(b.bps[k], b[k] * 10_000, 1e-9, `${k} bps`);
});

test("w = 0: σa = 0, so P = 0, gap = 0, and only the reserve cost remains", () => {
  const b = priceCover({ stockShare: 0, sigma: 0.5457, limit: 0.1 });
  assert.equal(b.sigmaAccount, 0);
  assert.equal(b.distance, Number.POSITIVE_INFINITY);
  assert.equal(b.pTouch, 0);
  assert.equal(b.gap, 0);
  assert.equal(b.riskPart, 0);
  close(b.fair, 0.2 * 0.05 * (30 / 365), 1e-15, "fair");
  assert.equal(priceCover({ stockShare: 0.7, sigma: 0, limit: 0.1 }).pTouch, 0); // σ = 0 too
});

test("the price rises with stock share and σ, and falls as the limit deepens", () => {
  let last = -1;
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const fair = priceCover({ stockShare: Math.min(1, w), sigma: 0.5, limit: 0.1 }).fair;
    // At tiny w the chance of touching the limit underflows to ~0, so the price is flat there, never lower.
    if (w >= 0.2) assert.ok(fair > last, `fair should rise with w (w = ${w})`);
    else assert.ok(fair >= last, `fair should not fall with w (w = ${w})`);
    last = fair;
  }
  last = -1;
  for (const sigma of [0.1, 0.2, 0.4, 0.6, 0.8, 1.2]) {
    const fair = priceCover({ stockShare: 0.8, sigma, limit: 0.1 }).fair;
    assert.ok(fair > last, `fair should rise with σ (σ = ${sigma})`);
    last = fair;
  }
  last = Number.POSITIVE_INFINITY;
  for (const limit of [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.29]) {
    const fair = priceCover({ stockShare: 0.8, sigma: 0.5, limit }).fair;
    assert.ok(fair < last, `fair should fall as the limit deepens (L = ${limit})`);
    last = fair;
  }
});

test("P never exceeds 1, and the gap never exceeds the band", () => {
  const b = priceCover({ stockShare: 1, sigma: 3, limit: 0.29 });
  close(b.band, 0.01, 1e-15, "band");
  assert.equal(b.gap, b.band);
  assert.ok(b.pTouch <= 1);
  const tiny = priceCover({ stockShare: 1, sigma: 5, limit: 1e-6 });
  assert.ok(tiny.pTouch <= 1 && tiny.pTouch > 0.99);
});

test("term defaults to the board's 30 days and can be changed", () => {
  assert.equal(PRICING_MODEL.termDays, 30);
  const d7 = priceCover({ stockShare: 0.5, sigma: 0.5, limit: 0.1, termDays: 7 });
  const d30 = priceCover({ stockShare: 0.5, sigma: 0.5, limit: 0.1 });
  assert.equal(d7.inputs.termDays, 7);
  assert.ok(d7.fair < d30.fair);
});

test("rejects inputs outside the model", () => {
  const ok = { stockShare: 0.5, sigma: 0.5, limit: 0.1 };
  for (const bad of [
    { ...ok, stockShare: -0.01 },
    { ...ok, stockShare: 1.01 },
    { ...ok, stockShare: Number.NaN },
    { ...ok, sigma: -0.1 },
    { ...ok, sigma: Number.POSITIVE_INFINITY },
    { ...ok, limit: 0 },
    { ...ok, limit: 0.3 }, // must be below the cap
    { ...ok, limit: 0.35 },
    { ...ok, termDays: 0 },
    { ...ok, cap: 1.5 },
  ]) {
    assert.throws(() => priceCover(bad), RangeError, JSON.stringify(bad));
  }
});

test("reference prices: the record is cheaper when the agent keeps less in stocks, and the saving is the difference", () => {
  const p = referencePrices({ maxStockShare: 0.8, observedStockShare: 0.35, sigma: 0.5457, limit: 0.1 });
  assert.equal(p.termDays, 30);
  assert.ok(p.record && p.record.fair < p.worstCase.fair);
  close(p.recordSaving!, p.worstCase.fair - p.record!.fair, 1e-15, "saving");
  const none = referencePrices({ maxStockShare: 0.3, observedStockShare: null, sigma: 0.5457, limit: 0.1 });
  assert.equal(none.record, null);
  assert.equal(none.recordSaving, null);
});

test("σ comes from Chainlink history in volatility.json, and the most volatile allowed stock is used", () => {
  assert.equal(VOLATILITY.source.chainId, 4663);
  for (const [symbol, sigma] of Object.entries(VOLATILITY.sigma)) {
    assert.ok(sigma > 0.05 && sigma < 3, `${symbol} σ ${sigma} out of a plausible range`);
    const a = VOLATILITY.assets[symbol as keyof typeof VOLATILITY.assets];
    assert.equal(a.sigma, sigma);
    assert.ok(a.window.returns >= 20, `${symbol}: too few returns`);
    assert.ok(a.ci95[0] < sigma && sigma < a.ci95[1]);
  }
  assert.equal(sigmaOf().symbol, VOLATILITY.mostVolatile);
  assert.equal(sigmaOf(["AMZN"]).sigma, VOLATILITY.sigma.AMZN);
  assert.equal(sigmaOf(["TSLA", "AMZN"]).sigma, Math.max(VOLATILITY.sigma.TSLA, VOLATILITY.sigma.AMZN));
});
