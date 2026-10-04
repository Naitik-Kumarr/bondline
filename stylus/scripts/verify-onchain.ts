/**
 * Calls quote() on a deployed pricer (the Stylus BondlinePricer or its EVM twin: same ABI) for rows of vectors.json
 * and compares every output with the TypeScript model's integers. Read-only eth_calls: it sends no transaction.
 *
 *   npx tsx stylus/scripts/verify-onchain.ts <address> [--rpc URL] [--n 400 | --all] [--expect-codehash 0x...]
 *   npx tsx stylus/scripts/verify-onchain.ts --local-initcode FILE      # offline self-test against the built program
 *
 * Default RPC: Robinhood Chain testnet. The ten PRICING_VECTORS rows are always included; the rest of the sample is
 * evenly spaced over the file. Also checks that a bad input reverts with WBpsTooLarge, and (with --expect-codehash)
 * that keccak256 of the code at the address is the codehash `wasm-check.mjs --initcode` printed for the local build.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, custom, http, keccak256, type Address, type Hex, ContractFunctionRevertedError } from "viem";
import { makeCaller, wasmFromInitcode } from "./lib/program.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RPC = "https://rpc.testnet.chain.robinhood.com";
const argv = process.argv.slice(2);
const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

const abi = JSON.parse(readFileSync(join(here, "../abi.json"), "utf8"));
const doc = JSON.parse(readFileSync(join(here, "../vectors.json"), "utf8")) as {
  fixed: number;
  vectors: { wBps: number; sigmaBps: number; termDays: number; limitBps: number; capBps: number; pHitBps: number; gapBps: number; riskBps: number; reserveBps: number; fairBps: number }[];
};

const localInitcode = flag("--local-initcode");
const address = (argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) ?? "0x0000000000000000000000000000000000000001") as Address;
if (!localInitcode && !argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a))) {
  console.error("usage: verify-onchain.ts <address> [--rpc URL] [--n 400 | --all] [--expect-codehash 0x...]  |  --local-initcode FILE");
  process.exit(2);
}

let transport;
if (localInitcode) {
  // In-process: eth_call is answered by running the program's wasm, so the script's ABI plumbing is tested offline.
  const call = makeCaller(wasmFromInitcode(localInitcode).wasm);
  transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method === "eth_call") {
        const tx = (params as [{ data?: Hex; input?: Hex }])[0];
        const { status, result } = call((tx.data ?? tx.input) as string);
        if (status === 0 && result) return ("0x" + result.toString("hex")) as Hex;
        throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x" + (result?.toString("hex") ?? "") });
      }
      if (method === "eth_chainId") return "0x1";
      throw new Error(`unsupported in local mode: ${method}`);
    },
  });
} else {
  transport = http(flag("--rpc") ?? DEFAULT_RPC);
}
const client = createPublicClient({ transport });

const want = flag("--n") ? Number(flag("--n")) : 400;
const all = argv.includes("--all");
const rows = doc.vectors;
const picked = new Set<number>();
for (let i = 0; i < doc.fixed; i++) picked.add(i);
if (all) rows.forEach((_, i) => picked.add(i));
else for (let k = 0; k < want; k++) picked.add(Math.floor((k * rows.length) / want));
const indexes = [...picked].sort((a, b) => a - b);

async function quote(v: (typeof rows)[number], attempt = 0): Promise<bigint[]> {
  try {
    return (await client.readContract({
      address,
      abi,
      functionName: "quote",
      args: [BigInt(v.wBps), BigInt(v.sigmaBps), BigInt(v.termDays), BigInt(v.limitBps), BigInt(v.capBps)],
    })) as unknown as bigint[];
  } catch (e) {
    if (attempt < 4 && /429|rate|timeout|fetch/i.test(String(e))) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); // back off on rate limits
      return quote(v, attempt + 1);
    }
    throw e;
  }
}

let matched = 0;
const mismatches: string[] = [];
const CONCURRENCY = 4;
let next = 0;
try {
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < indexes.length) {
        const i = indexes[next++]!;
        const v = rows[i]!;
        const got = await quote(v);
        const exp = [v.pHitBps, v.gapBps, v.riskBps, v.reserveBps, v.fairBps].map(BigInt);
        if (got.length === 5 && got.every((g, k) => g === exp[k])) matched++;
        else mismatches.push(`row ${i} ${JSON.stringify(v)} got ${got} want ${exp}`);
      }
    }),
  );
} catch (e) {
  const msg = (e as { shortMessage?: string }).shortMessage ?? String(e).split("\n")[0];
  console.error(`FAILED: quote() could not be called at ${localInitcode ? "the local program" : address}: ${msg}`);
  process.exit(1);
}

// A bad input must revert with the WBpsTooLarge() custom error.
let revertOk = false;
try {
  await client.readContract({ address, abi, functionName: "quote", args: [10_001n, 5000n, 30n, 1000n, 3000n] });
} catch (e) {
  const err = (e as { walk?: (fn: (x: unknown) => boolean) => unknown }).walk?.((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined;
  revertOk = err?.data?.errorName === "WBpsTooLarge" || /c05c55f5/i.test(String(e));
}

let codehashLine = "";
let codehashOk = true;
const expectHash = flag("--expect-codehash");
if (expectHash && !localInitcode) {
  const code = await client.getCode({ address });
  const actual = code ? keccak256(code) : "(no code)";
  codehashOk = actual.toLowerCase() === expectHash.toLowerCase();
  codehashLine = `\ncodehash: keccak256(code at ${address}) = ${actual}; expected ${expectHash}: ${codehashOk ? "equal" : "DIFFERENT"}`;
}

console.log(`${localInitcode ? "local program" : address}: ${matched} of ${indexes.length} sampled vectors match exactly (${indexes.length * 5} outputs), file has ${rows.length}`);
console.log(`bad input wBps=10001 reverts with WBpsTooLarge: ${revertOk ? "yes" : "NO"}${codehashLine}`);
if (mismatches.length) console.log(mismatches.slice(0, 5).join("\n"));
process.exit(mismatches.length === 0 && revertOk && codehashOk ? 0 : 1);
