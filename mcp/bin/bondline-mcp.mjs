#!/usr/bin/env node
// Starts the Bondline MCP server on stdio, through tsx so it works from a fresh `npm install` with no build step.
import { register } from "tsx/esm/api";
register();
const { main } = await import("../src/server.ts");
await main();
