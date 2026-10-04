// Runs the Stylus program in Node with stubbed Stylus host functions (vm_hooks). Offline: no chain, no network.
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { keccak256 } from "viem";

/** Selector of quote(uint256,uint256,uint256,uint256,uint256) (cast sig). */
export const QUOTE_SELECTOR = "0xcf408eb1";

/**
 * The program as cargo-stylus deploys it: `cargo stylus get-initcode --output FILE` writes the creation code
 * (a 43-byte prelude, then the program: 0xEFF000, a dictionary byte, then the brotli-compressed wasm).
 * Returns the decompressed wasm and keccak256 of the program code, which is the on-chain codehash after deployment.
 */
export function wasmFromInitcode(initcodeFile) {
  const hex = readFileSync(initcodeFile, "utf8").trim().replace(/^0x/, "");
  const initcode = Buffer.from(hex, "hex");
  const code = initcode.subarray(43);
  if (code.subarray(0, 3).toString("hex") !== "eff000") throw new Error("initcode does not carry a Stylus program (no 0xEFF000 prefix)");
  const wasm = zlib.brotliDecompressSync(code.subarray(4));
  return { wasm, programBytes: code.length, codeHash: keccak256("0x" + code.toString("hex")) };
}

/** Returns call(calldataHex) -> { status, result } where status 0 = success and non-zero = revert. */
export function makeCaller(wasm) {
  const mod = new WebAssembly.Module(wasm);
  return function call(calldataHex) {
    const calldata = Buffer.from(calldataHex.replace(/^0x/, ""), "hex");
    let result = null;
    let memory;
    const inst = new WebAssembly.Instance(mod, {
      vm_hooks: {
        read_args: (ptr) => Buffer.from(memory.buffer).set(calldata, ptr),
        write_result: (ptr, len) => (result = Buffer.from(memory.buffer.slice(ptr, ptr + len))),
        storage_flush_cache: () => {},
        pay_for_memory_grow: () => {},
        msg_reentrant: () => 0,
        msg_value: (ptr) => new Uint8Array(memory.buffer, ptr, 32).fill(0),
      },
    });
    memory = inst.exports.memory;
    const status = inst.exports.user_entrypoint(calldata.length);
    return { status, result };
  };
}

export const imports = (wasm) => WebAssembly.Module.imports(new WebAssembly.Module(wasm)).map((i) => `${i.module}.${i.name}`);
