// npx tsx --test scripts/claim-letters.test.ts
// The letter path for a settle (audit finding W2). The last test runs the worker offline: --dry-run --once --fixture,
// in a temp folder, with no model, RPC or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalTx, letterPathFor } from "./claim-letters.ts";

const HEX64 = "ab".repeat(32);
const DIR = resolve(tmpdir(), "letters-out");

test("a canonical hash names a file directly inside the output folder", () => {
  assert.equal(letterPathFor(DIR, `0x${HEX64}`), join(DIR, `0x${HEX64}.json`));
});

test("upper-case hex is accepted and written lower-case, like the chain's hashes", () => {
  assert.equal(canonicalTx(`0x${HEX64.toUpperCase()}`), `0x${HEX64}`);
  assert.equal(letterPathFor(DIR, `0x${HEX64.toUpperCase()}`), join(DIR, `0x${HEX64}.json`));
});

test("anything that isn't 0x + 64 hex gets no path", () => {
  for (const tx of [
    "../fixture-escaped",
    `0x${HEX64.slice(1)}`, // 63 hex
    `0x${HEX64}a`, // 65 hex
    `0X${HEX64}`,
    HEX64,
    `0x${HEX64.slice(2)}/.`,
    `0x../../${HEX64.slice(6)}`,
    `0x${"g".repeat(64)}`,
    "",
    null,
    undefined,
    123,
  ]) {
    assert.equal(letterPathFor(DIR, tx), null, `path for ${String(tx)}`);
  }
});

test("the worker skips a fixture settle with a malformed tx and writes nothing outside its output folder", () => {
  const area = mkdtempSync(join(tmpdir(), "claim-letters-test-"));
  const out = join(area, "worker-output");
  const row = {
    blockNumber: 0,
    market: "0x1111111111111111111111111111111111111111",
    marketLabel: "Live",
    cover: "0x2222222222222222222222222222222222222222",
    account: "0x3333333333333333333333333333333333333333",
    user: "0x4444444444444444444444444444444444444444",
    value: "80000000",
    loss: "20000000",
    limit: "10000000",
    payout: "10000000",
  };
  const fixture = join(area, "fixture.json");
  writeFileSync(fixture, JSON.stringify([{ ...row, settleTx: "../fixture-escaped" }, { ...row, settleTx: `0x${HEX64.toUpperCase()}` }]));
  const script = fileURLToPath(new URL("./claim-letters.ts", import.meta.url));
  const run = spawnSync(process.execPath, ["--import", "tsx", script, "--dry-run", "--once", "--fixture", fixture, "--out-dir", out], {
    cwd: resolve(fileURLToPath(new URL("..", import.meta.url))),
    encoding: "utf8",
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? "", TMPDIR: area },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(join(area, "fixture-escaped.json")), false, "escaped the output folder");
  assert.deepEqual(readdirSync(out), [`0x${HEX64}.json`]);
  assert.match(run.stderr, /skipped a settle from the fixture/);
});
