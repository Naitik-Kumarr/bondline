import { readFileSync } from "node:fs";
import { priceCover } from "../shared/src/pricing.ts";
const b = JSON.parse(readFileSync("stylus/vectors.json", "utf8")).vectors;
let bad = 0;
for (const r of b) {
  const x = priceCover({ stockShare: r.wBps / 1e4, sigma: r.sigmaBps / 1e4, limit: r.limitBps / 1e4, cap: r.capBps / 1e4, termDays: r.termDays }).bps;
  const got = [x.pTouch, x.gap, x.riskPart, x.reservePart, x.fair].map((v) => Math.round(v * 1e4));
  if (got.join() !== [r.pHitBps, r.gapBps, r.riskBps, r.reserveBps, r.fairBps].join()) bad++;
}
console.log("builder vectors.json rows", b.length, "recomputed by me from shared/src/pricing.ts; differing rows:", bad);
