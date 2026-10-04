// Runs the built WASM in Node with stubbed Stylus host functions and compares every vector in vectors.json against the
// TypeScript model's integers. It checks the compiled contract's ABI decoding, math and ABI encoding offline; it is not
// a substitute for an on-chain call (see verify-onchain.ts for that).
//
//   cargo build --release --target wasm32-unknown-unknown
//   node stylus/scripts/wasm-check.mjs                      # the raw cargo output
//   cargo stylus get-initcode --output /tmp/initcode.hex
//   node stylus/scripts/wasm-check.mjs --initcode /tmp/initcode.hex   # the exact bytes cargo-stylus deploys (decompressed)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { QUOTE_SELECTOR, imports, makeCaller, wasmFromInitcode } from "./lib/program.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const initcodeFile = argv.includes("--initcode") ? argv[argv.indexOf("--initcode") + 1] : null;

let wasm;
let source;
if (initcodeFile) {
  const p = wasmFromInitcode(initcodeFile);
  wasm = p.wasm;
  source = `deployable program from ${initcodeFile} (${p.programBytes} program bytes, codehash ${p.codeHash})`;
} else {
  const path = join(here, "../target/wasm32-unknown-unknown/release/bondline_pricer.wasm");
  wasm = readFileSync(path);
  source = `raw cargo output ${path}`;
}
const call = makeCaller(wasm);
const { vectors } = JSON.parse(readFileSync(join(here, "../vectors.json"), "utf8"));
const word = (n) => BigInt(n).toString(16).padStart(64, "0");

let ok = 0;
const bad = [];
for (const v of vectors) {
  const { status, result } = call(QUOTE_SELECTOR + [v.wBps, v.sigmaBps, v.termDays, v.limitBps, v.capBps].map(word).join(""));
  const want = [v.pHitBps, v.gapBps, v.riskBps, v.reserveBps, v.fairBps];
  const got = status === 0 && result?.length === 160 ? [0, 1, 2, 3, 4].map((i) => Number(BigInt("0x" + result.subarray(i * 32, i * 32 + 32).toString("hex")))) : null;
  if (got && got.every((x, i) => x === want[i])) ok++;
  else bad.push({ v, status, got });
}
const rev = call(QUOTE_SELECTOR + [10001, 5000, 30, 1000, 3000].map(word).join(""));
console.log(`source: ${source}`);
console.log(`wasm: ${wasm.length} bytes, sha256 ${createHash("sha256").update(wasm).digest("hex")}; host imports: ${imports(wasm).join(", ")}`);
console.log(`wasm: ${ok} of ${vectors.length} vectors match exactly; first mismatches: ${JSON.stringify(bad.slice(0, 3))}`);
console.log(`wasm: wBps 10001 -> status ${rev.status} (non-zero = revert), revert data ${rev.result?.toString("hex")} (WBpsTooLarge() = c05c55f5)`);
if (bad.length) process.exit(1);
