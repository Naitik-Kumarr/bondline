// Kept identical to keeper/src/log.ts so each service bundles on its own.
// Structured JSON-lines logging to stdout and a log file. Never log secrets: callers pass addresses only.
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { BaseError, ContractFunctionRevertedError } from "viem";

export type Level = "debug" | "info" | "warn" | "error";
export type Fields = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BYTES = 50 * 1024 * 1024; // rotate once at 50 MB so an unattended service can't fill the disk

function replacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return describeError(value);
  return value;
}

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  file: string;
}

export function createLogger(service: string): Logger {
  const dir = resolve(process.env.LOG_DIR ?? join(process.cwd(), "logs"));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${service}.log`);
  const min = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;
  let writes = 0;

  const write = (level: Level, event: string, fields: Fields = {}) => {
    if (LEVELS[level] < min) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, svc: service, event, ...fields }, replacer);
    process.stdout.write(line + "\n");
    try {
      if (++writes % 500 === 0 && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
      appendFileSync(file, line + "\n");
    } catch {
      // Logging must never take the service down.
    }
  };

  return {
    debug: (e, f) => write("debug", e, f),
    info: (e, f) => write("info", e, f),
    warn: (e, f) => write("warn", e, f),
    error: (e, f) => write("error", e, f),
    file,
  };
}

/** A compact, secret-free description of an error, with the decoded revert reason when there is one. */
export function describeError(e: unknown): Fields {
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return {
        message: reverted.shortMessage,
        revert: reverted.data?.errorName ?? reverted.reason ?? null,
        args: reverted.data?.args?.map((a) => (typeof a === "bigint" ? a.toString() : a)) ?? null,
      };
    }
    return { message: e.shortMessage || e.message.split("\n")[0], name: e.name };
  }
  if (e instanceof Error) return { message: e.message.split("\n")[0], name: e.name };
  return { message: String(e) };
}

/** The decoded custom error name of a revert, if any. */
export function revertName(e: unknown): string | null {
  if (!(e instanceof BaseError)) return null;
  const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? (reverted.data?.errorName ?? null) : null;
}
