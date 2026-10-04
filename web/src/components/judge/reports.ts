// The contracts' real quality numbers, read from contracts/reports (coverage, Slither, gas) and counted from
// contracts/test when the page is built. Nothing here is typed in by hand: if a file is missing, its numbers are too.
import "server-only";
import type fsType from "node:fs";
import type pathType from "node:path";

// The reads are plain require("fs") / require("path") calls on literal paths from process.cwd() (web/ for `next build`
// and `next dev`). webpackIgnore makes webpack emit them as-is, so Next's file tracing sees these files and ships them
// with the serverless function that regenerates the page; Turbopack treats them as ordinary builtin requires.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = (): typeof fsType => require(/* webpackIgnore: true */ "fs");
const path = (): typeof pathType => require(/* webpackIgnore: true */ "path");
const read = (load: () => string) => {
  try {
    return load();
  } catch {
    return null;
  }
};
const coverageMd = () =>
  read(() =>
    require(/* webpackIgnore: true */ "fs").readFileSync(
      require(/* webpackIgnore: true */ "path").join(process.cwd(), "..", "contracts", "reports", "coverage.md"),
      "utf8",
    ),
  );
const slitherMd = () =>
  read(() =>
    require(/* webpackIgnore: true */ "fs").readFileSync(
      require(/* webpackIgnore: true */ "path").join(process.cwd(), "..", "contracts", "reports", "slither.md"),
      "utf8",
    ),
  );
const gasTxt = () =>
  read(() =>
    require(/* webpackIgnore: true */ "fs").readFileSync(
      require(/* webpackIgnore: true */ "path").join(process.cwd(), "..", "contracts", "reports", "gas.txt"),
      "utf8",
    ),
  );
const testsTxt = () =>
  read(() =>
    require(/* webpackIgnore: true */ "fs").readFileSync(
      require(/* webpackIgnore: true */ "path").join(process.cwd(), "..", "contracts", "reports", "tests.txt"),
      "utf8",
    ),
  );
const TESTS: string = require(/* webpackIgnore: true */ "path").join(process.cwd(), "..", "contracts", "test");
/* eslint-enable @typescript-eslint/no-require-imports */

export interface Ratio {
  pct: number;
  hit: number;
  total: number;
}
export interface Coverage {
  lines: Ratio;
  statements: Ratio;
  branches: Ratio;
  functions: Ratio;
  files: number;
}

/** coverage.md: forge coverage's summary table; the Total row. */
function parseCoverage(md: string | null): Coverage | null {
  if (!md) return null;
  const row = md.split("\n").find((l) => /^\|\s*Total\s*\|/.test(l));
  if (!row) return null;
  const cells = [...row.matchAll(/([\d.]+)%\s*\((\d+)\/(\d+)\)/g)].map((m) => ({
    pct: Number(m[1]),
    hit: Number(m[2]),
    total: Number(m[3]),
  }));
  if (cells.length < 4) return null;
  const files = md.split("\n").filter((l) => /^\|\s*src\//.test(l)).length;
  return { lines: cells[0], statements: cells[1], branches: cells[2], functions: cells[3], files };
}

export interface Slither {
  title: string | null;
  high: number;
  medium: number;
  low: number;
  informational: number;
  detectors: { impact: string; detector: string; count: number }[];
}

/** slither.md: a table of findings by impact and detector, and a "High: 0. Medium: 0." line. */
function parseSlither(md: string | null): Slither | null {
  if (!md) return null;
  const detectors = [...md.matchAll(/^\|\s*(High|Medium|Low|Informational|Optimization)\s*\|\s*([\w-]+)\s*\|\s*(\d+)\s*\|/gm)].map(
    (m) => ({ impact: m[1], detector: m[2], count: Number(m[3]) }),
  );
  const sum = (impact: string) => detectors.filter((d) => d.impact === impact).reduce((s, d) => s + d.count, 0);
  const high = md.match(/High:\s*(\d+)/);
  const medium = md.match(/Medium:\s*(\d+)/);
  if (!high && !medium && detectors.length === 0) return null;
  return {
    title: md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null,
    high: high ? Number(high[1]) : sum("High"),
    medium: medium ? Number(medium[1]) : sum("Medium"),
    low: sum("Low"),
    informational: sum("Informational"),
    detectors,
  };
}

export interface GasRow {
  contract: string;
  fn: string;
  min: number;
  median: number;
  max: number;
  calls: number;
}

/** gas.txt: forge's gas report. One table per contract; we keep the calls a judge cares about. */
function parseGas(txt: string | null): GasRow[] | null {
  if (!txt) return null;
  const wanted: Record<string, string[]> = {
    BondlineMarket: ["createOfferWithAuthorization", "createOffer"],
    BondlineCover: ["open", "deposit", "settle", "withdraw", "close"],
    AgentAccount: ["trade"],
    MirrorFeed: ["push"],
  };
  const out: GasRow[] = [];
  let contract: string | null = null;
  for (const line of txt.split("\n")) {
    const head = line.match(/^\|\s*src\/[\w/]+\.sol:(\w+) Contract/);
    if (head) {
      contract = head[1];
      continue;
    }
    if (line.match(/^\|\s*(test|script)\//)) contract = null;
    const row = line.match(/^\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
    if (row && contract && wanted[contract]?.includes(row[1])) {
      out.push({
        contract,
        fn: row[1],
        min: Number(row[2]),
        median: Number(row[4]),
        max: Number(row[5]),
        calls: Number(row[6]),
      });
    }
  }
  const order = Object.values(wanted).flat();
  return out.length ? out.sort((a, b) => order.indexOf(a.fn) - order.indexOf(b.fn)) : null;
}

export interface Tests {
  unit: number;
  fuzz: number;
  invariant: number;
  /** In contracts/test/fork: run with FORK_TESTS=true. */
  fork: number;
  /** unit + fuzz + invariant: the default `forge test` suite. */
  suite: number;
  files: number;
  /** Every test function name, so the page only cites tests that exist. */
  names: Set<string>;
  /** From contracts/reports/tests.txt (forge test's summary), when it exists. */
  result: { passed: number; failed: number; skipped: number } | null;
}

function solFiles(dir: string): string[] {
  try {
    return fs()
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory() ? solFiles(path().join(dir, e.name)) : e.name.endsWith(".t.sol") ? [path().join(dir, e.name)] : [],
      );
  } catch {
    return [];
  }
}

/** Counts test functions in contracts/test (forge runs every `test*` and `invariant*` function). */
function countTests(): Tests | null {
  const files = solFiles(TESTS);
  if (files.length === 0) return null;
  const t: Tests = { unit: 0, fuzz: 0, invariant: 0, fork: 0, suite: 0, files: 0, names: new Set(), result: null };
  for (const f of files) {
    const src = fs().readFileSync(f, "utf8");
    const names = [...src.matchAll(/function\s+((?:test|invariant)\w*)\s*\(/g)].map((m) => m[1]);
    if (names.length === 0) continue;
    t.files += 1;
    const fork = f.split(path().sep).includes("fork");
    for (const n of names) {
      t.names.add(n);
      if (fork) t.fork += 1;
      else if (n.startsWith("invariant")) t.invariant += 1;
      else if (n.startsWith("testFuzz")) t.fuzz += 1;
      else t.unit += 1;
    }
  }
  t.suite = t.unit + t.fuzz + t.invariant;
  const summary = testsTxt();
  const m = summary?.match(/(\d+)\s+tests?\s+passed,\s+(\d+)\s+failed,\s+(\d+)\s+skipped/);
  if (m) t.result = { passed: Number(m[1]), failed: Number(m[2]), skipped: Number(m[3]) };
  return t;
}

export interface Reports {
  coverage: Coverage | null;
  slither: Slither | null;
  gas: GasRow[] | null;
  tests: Tests | null;
}

/** Read once per server process (at build time for the prerendered page). */
let cached: Reports | null = null;
export function readReports(): Reports {
  if (cached) return cached;
  cached = {
    coverage: parseCoverage(coverageMd()),
    slither: parseSlither(slitherMd()),
    gas: parseGas(gasTxt()),
    tests: countTests(),
  };
  return cached;
}
