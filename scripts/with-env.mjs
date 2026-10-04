#!/usr/bin/env node
// Runs a command with variables from ./.env, parsed by dotenv (never by a shell, so a malformed line can't be executed
// or echoed). Only the variables named before `--` are passed, and nothing is printed.
// Usage: node scripts/with-env.mjs DEPLOYER_PRIVATE_KEY KEEPER_PRIVATE_KEY -- forge script ...
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const split = args.indexOf("--");
if (split < 1 || split === args.length - 1) {
  console.error("usage: node scripts/with-env.mjs VAR [VAR...] -- command [args...]");
  process.exit(2);
}
const names = args.slice(0, split);
const [command, ...rest] = args.slice(split + 1);
const parsed = parse(readFileSync(join(root, ".env")));
const env = { ...process.env };
for (const name of names) {
  const value = parsed[name]?.trim();
  if (!value) {
    console.error(`${name} is not set in .env`);
    process.exit(2);
  }
  env[name] = value;
}
const result = spawnSync(command, rest, { stdio: "inherit", env });
process.exit(result.status ?? 1);
