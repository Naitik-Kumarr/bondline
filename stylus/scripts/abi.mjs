// Writes stylus/abi.json: the JSON ABI of BondlinePricer with named outputs. The selectors are checked against the
// interface `cargo stylus export-abi` prints (abi.sol), which has unnamed outputs.
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseAbi, toFunctionSelector, toEventSelector } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const abi = parseAbi([
  "function quote(uint256 wBps, uint256 sigmaBps, uint256 termDays, uint256 limitBps, uint256 capBps) pure returns (uint256 pHitBps, uint256 gapBps, uint256 riskBps, uint256 reserveBps, uint256 fairBps)",
  "error WBpsTooLarge()",
  "error SigmaBpsTooLarge()",
  "error TermDaysOutOfRange()",
  "error CapBpsOutOfRange()",
  "error LimitBpsOutOfRange()",
]);
const sol = readFileSync(join(here, "../abi.sol"), "utf8");
for (const name of ["quote(uint256 wBps, uint256 sigmaBps, uint256 termDays, uint256 limitBps, uint256 capBps)", "error WBpsTooLarge()", "error SigmaBpsTooLarge()", "error TermDaysOutOfRange()", "error CapBpsOutOfRange()", "error LimitBpsOutOfRange()"]) {
  if (!sol.includes(name)) throw new Error(`abi.sol (cargo stylus export-abi) does not contain: ${name}`);
}
writeFileSync(join(here, "../abi.json"), JSON.stringify(abi, null, 2) + "\n");
console.log("quote selector", toFunctionSelector("quote(uint256,uint256,uint256,uint256,uint256)"));
