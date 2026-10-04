// The Rust pricer's answers, computed off-chain by running the exact program cargo-stylus would deploy (the wasm inside
// `cargo stylus get-initcode`) in Node with stubbed host functions. Stylus activations are paused on Robinhood Chain
// (ArbWasm.activationGas() is 2^64-1), so the program can't be deployed; this is the closest honest stand-in for the
// on-chain call, and the site labels it as off-chain.
//
// For the board's reference inputs (σ of the most volatile allowed stock, 10% limit, 30% cap, 30 days) it quotes every
// stock share w from 0 to 100% in 1 bps steps, and checks each against the TypeScript model's integers.
//
//   cd stylus && cargo build --release --target wasm32-unknown-unknown && cargo stylus get-initcode --output /tmp/initcode.hex
//   npx tsx stylus/scripts/offchain-prices.ts --initcode /tmp/initcode.hex \
//     --expect-codehash 0x063026be3176d38d9a5f1dca4d2c9e829918371b4430f6abb98bb1a5b3fdaaec
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAP_BPS, STOCK_SYMBOLS } from "../../shared/src/constants.ts";
import { PRICING_MODEL, priceCover, sigmaOf } from "../../shared/src/pricing.ts";
import { REFERENCE_LIMIT_BPS } from "../../shared/src/record.ts";
import { QUOTE_SELECTOR, makeCaller, wasmFromInitcode } from "./lib/program.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const initcodeFile = arg("--initcode");
const expected = arg("--expect-codehash")?.toLowerCase();
if (!initcodeFile) {
  console.error("usage: npx tsx stylus/scripts/offchain-prices.ts --initcode FILE [--expect-codehash 0x...]");
  process.exit(2);
}

const program = wasmFromInitcode(initcodeFile);
if (expected && program.codeHash.toLowerCase() !== expected) {
  console.error(`codehash ${program.codeHash} is not the expected ${expected}: not the program this records`);
  process.exit(1);
}
const call = makeCaller(program.wasm);
const word = (n: number) => BigInt(n).toString(16).padStart(64, "0");

const sigma = sigmaOf(STOCK_SYMBOLS);
const inputs = {
  sigmaBps: Math.round(sigma.sigma * 10_000),
  sigmaAsset: sigma.symbol,
  termDays: PRICING_MODEL.termDays,
  limitBps: REFERENCE_LIMIT_BPS,
  capBps: CAP_BPS,
};

/** The TypeScript model's fair price for the same integer inputs, in the contract's unit (bps x 1e4, half up). */
const tsFair = (wBps: number) =>
  Math.round(
    priceCover({
      stockShare: wBps / 10_000,
      sigma: inputs.sigmaBps / 10_000,
      limit: inputs.limitBps / 10_000,
      cap: inputs.capBps / 10_000,
      termDays: inputs.termDays,
    }).bps.fair * 1e4,
  );

const fairByWBps: number[] = [];
const mismatches: { wBps: number; rust: number; ts: number }[] = [];
for (let w = 0; w <= 10_000; w++) {
  const { status, result } = call(QUOTE_SELECTOR + [w, inputs.sigmaBps, inputs.termDays, inputs.limitBps, inputs.capBps].map(word).join(""));
  if (status !== 0 || !result || result.length !== 160) throw new Error(`quote reverted for w = ${w} bps`);
  const fair = Number(BigInt("0x" + result.subarray(128, 160).toString("hex")));
  fairByWBps.push(fair);
  const ts = tsFair(w);
  if (ts !== fair) mismatches.push({ wBps: w, rust: fair, ts });
}

const out = {
  label: "The Rust (Stylus) pricer's answers, computed off-chain: Stylus activations are paused on Robinhood Chain, so it is not deployed.",
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  command: "npx tsx stylus/scripts/offchain-prices.ts --initcode <cargo stylus get-initcode output> --expect-codehash <codehash>",
  program: {
    codeHash: program.codeHash,
    programBytes: program.programBytes,
    wasmBytes: program.wasm.length,
    initcodeSha256: createHash("sha256").update(readFileSync(initcodeFile, "utf8").trim().replace(/^0x/, "")).digest("hex"),
    runner: "stylus/scripts/lib/program.mjs (Node WebAssembly, stubbed Stylus host functions)",
  },
  inputs,
  unit: "basis points x 1e4 (1 = 0.0001 bps)",
  /** fair price for w = index bps of the account in stocks. */
  fairByWBps,
  typescriptCheck: { compared: fairByWBps.length, matching: fairByWBps.length - mismatches.length, mismatches },
};
const path = join(here, "..", "offchain-prices.json");
writeFileSync(path, JSON.stringify(out) + "\n");
console.log(
  `wrote ${path}: ${fairByWBps.length} quotes from program ${program.codeHash}; TypeScript matches ${out.typescriptCheck.matching}/${out.typescriptCheck.compared}`,
);
console.log(`w = 30%: ${fairByWBps[3000] / 1e4} bps, w = 80%: ${fairByWBps[8000] / 1e4} bps (σ ${inputs.sigmaBps} bps, ${inputs.sigmaAsset})`);
