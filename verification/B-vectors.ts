// Independent vector generator for verifying workstream B (written by verifier; own seed and grid).
import { writeFileSync } from "node:fs";
import { PRICING_VECTORS, priceCover } from "../shared/src/pricing.ts";
const out: any[] = [];
const seen = new Set<string>();
function add(w: number, s: number, t: number, l: number, c: number, name?: string) {
  const k = [w, s, t, l, c].join(",");
  if (seen.has(k)) return;
  seen.add(k);
  const b = priceCover({ stockShare: w / 1e4, sigma: s / 1e4, limit: l / 1e4, cap: c / 1e4, termDays: t }).bps;
  const r = (x: number) => Math.round(x * 1e4);
  out.push({ name, w, s, t, l, c, raw: [b.pTouch, b.gap, b.riskPart, b.reservePart, b.fair], want: [r(b.pTouch), r(b.gap), r(b.riskPart), r(b.reservePart), r(b.fair)] });
}
for (const v of PRICING_VECTORS) add(v.stockShareBps, v.sigmaBps, v.termDays, v.limitBps, v.capBps, v.name);
let seed = 0x5eed1234;
const rnd = () => { seed = (seed + 0x9e3779b9) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 16), 0x85ebca6b); t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
// log-uniform sigma, wide
for (let i = 0; i < 20000; i++) {
  const cap = rnd() < 0.5 ? 3000 : int(2, 10000);
  const s = rnd() < 0.2 ? int(0, 100) : Math.floor(Math.exp(rnd() * Math.log(1_000_001)));
  const t = rnd() < 0.3 ? 30 : rnd() < 0.5 ? int(1, 365) : int(1, 36500);
  const l = rnd() < 0.2 ? cap - 1 : rnd() < 0.2 ? 1 : int(1, cap - 1);
  add(int(0, 10000), Math.min(s, 1_000_000), t, l, cap);
}
// systematic grid of different values
for (const w of [0, 1, 2, 17, 333, 2500, 5000, 7777, 9999, 10000])
  for (const s of [0, 1, 7, 321, 2222, 4444, 6666, 9999, 12345, 99999, 500000, 1000000])
    for (const t of [1, 2, 29, 30, 31, 100, 364, 365, 366, 10000, 36499, 36500])
      for (const [l, c] of [[1, 2], [1, 3000], [2999, 3000], [1500, 3000], [1, 10000], [9999, 10000], [5000, 10000], [999, 1000]]) add(w, s, t, l, c);
writeFileSync(process.argv[2], JSON.stringify(out));
console.log("wrote", out.length);
