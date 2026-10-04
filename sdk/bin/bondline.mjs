#!/usr/bin/env node
// Runs the TypeScript CLI through tsx, so the package works from a fresh `npm install` with no build step.
import { register } from "tsx/esm/api";
register();
const { main } = await import("../src/cli.ts");
await main(process.argv.slice(2));
