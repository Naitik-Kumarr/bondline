/**
 * Pure geometry for the gap replay. Everything is in normalised chart space (x and y from 0 to 1, y down),
 * so the same numbers place SVG paths (scaled to each viewBox) and HTML labels (as percentages).
 * Deterministic: a seeded PRNG, so the server and the client draw the same line.
 */

export type GapDemo = {
  status: "illustration" | "real";
  accountUsd: number;
  limitBps: number;
  fridayDrawdownBps: number;
  mondayDrawdownBps: number;
  userLossUsd: number;
  bondPaysUsd: number;
  settleTx: string | null;
  market: string;
  note?: string;
};

export type Pt = { x: number; y: number };

/** Cover pays the loss beyond the limit up to a 30% drop (CAP_BPS in the contracts). */
export const CAP_BPS = 3000;

/** Horizontal layout: Friday trading, the closed weekend, Monday. */
export const X = {
  start: 0.035,
  bandStart: 0.47,
  bandEnd: 0.655,
  plunge: 0.006, // how far right the Monday open lands from the end of the band
  end: 0.975,
} as const;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10000) / 10000;

export function buildGeometry(d: GapDemo) {
  const limit = Math.max(1, d.limitBps);
  const fri = clamp(d.fridayDrawdownBps, 0, limit - 60); // Friday closes above the limit, or there'd be no gap story
  const mon = Math.max(d.mondayDrawdownBps, limit + 1);
  const floorBps = Math.max(mon, CAP_BPS);
  const topBps = -380; // headroom above the starting value
  const bottomBps = floorBps + 380;
  /** Drawdown in bps (positive = down) to normalised y. */
  const y = (bps: number) => round((bps - topBps) / (bottomBps - topBps));

  // Friday: a random walk pinned at 0 and at Friday's close (a Brownian bridge), kept clear of the limit.
  const rand = mulberry32(20261002);
  const n = 34;
  const walk = [0];
  for (let i = 1; i <= n; i++) {
    const g = (rand() + rand() + rand() - 1.5) * 2; // roughly normal
    walk.push(walk[i - 1] + g * 62);
  }
  const friday: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const trend = fri * Math.pow(t, 1.25) - 140 * Math.sin(Math.PI * t) * (1 - t);
    const bridge = walk[i] - t * walk[n];
    const v = i === 0 ? 0 : i === n ? fri : clamp(trend + bridge, -260, limit - 150);
    friday.push({ x: round(X.start + (X.bandStart - X.start) * t), y: y(v) });
  }

  // The weekend: no trades, the price holds. Drawn as ticks at Friday's close.
  const ticks = 9;
  const weekend: Pt[] = [];
  const step = (X.bandEnd - X.bandStart) / ticks;
  for (let i = 0; i < ticks; i++) weekend.push({ x: round(X.bandStart + step * (i + 0.5)), y: y(fri) });

  // Monday: it opens through the limit and trades a little around the open.
  const openX = X.bandEnd + X.plunge;
  const plunge: Pt[] = [
    { x: X.bandEnd, y: y(fri) },
    { x: openX, y: y(mon) },
  ];
  const m = 14;
  const monday: Pt[] = [{ x: openX, y: y(mon) }];
  const rand2 = mulberry32(20261005);
  for (let j = 1; j <= m; j++) {
    const t = j / m;
    const v = mon - 30 * Math.sin(Math.PI * t * 1.6) + (rand2() - 0.5) * 34;
    monday.push({ x: round(openX + (X.end - openX) * t), y: y(v) });
  }

  // Where the plunge crosses the limit.
  const crossX = round(X.bandEnd + X.plunge * ((limit - fri) / (mon - fri)));
  const yLimit = y(limit);
  const yCap = y(CAP_BPS);
  const coveredBottom = (p: Pt) => ({ x: p.x, y: Math.min(p.y, yCap) });

  // The bond's share: between the limit and the price (never below the 30% cap).
  const bondArea: Pt[] = [
    { x: crossX, y: yLimit },
    { x: X.end, y: yLimit },
    ...[...monday].reverse().map(coveredBottom),
    coveredBottom({ x: openX, y: y(mon) }),
  ];

  // The user's share: from where they started down to their limit.
  const userArea: Pt[] = [
    { x: X.bandEnd, y: y(0) },
    { x: X.end, y: y(0) },
    { x: X.end, y: yLimit },
    { x: crossX, y: yLimit },
  ];

  return {
    y,
    friday,
    weekend,
    plunge,
    monday,
    bondArea,
    userArea,
    levels: { zero: y(0), limit: yLimit, cap: yCap, friday: y(fri), monday: y(mon) },
    openX,
  };
}

export type GapGeometry = ReturnType<typeof buildGeometry>;

/** Normalised points to an SVG path in a w × h viewBox. */
export function toPath(points: Pt[], w: number, h: number, close = false) {
  const d = points.map((p, i) => `${i ? "L" : "M"}${(p.x * w).toFixed(1)} ${(p.y * h).toFixed(1)}`).join("");
  return close ? `${d}Z` : d;
}

export const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
