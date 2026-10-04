// The decision receipt: a compact canonical JSON (sorted keys, no whitespace) passed as `decision` calldata to
// AgentAccount.trade. The Traded/Blocked event carries its keccak256, so anyone can re-hash the transaction input and
// check the reasoning.
import { keccak256, stringToBytes, toHex, type Hex } from "viem";

export const DECISION_VERSION = 1;
export const MAX_DECISION_BYTES = 800;
export const MAX_REASON_CHARS = 240;

export type Action = "buy" | "sell" | "hold";
export type Asset = "TSLA" | "AMZN";

export interface Decision {
  action: Action;
  asset: Asset;
  /** US dollars, rounded down to cents. 0 for hold. */
  usdAmount: number;
  reason: string;
}

/** Deterministic JSON: object keys sorted, no whitespace, undefined fields dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** Cleans a model's reason: one line, no control characters, at most MAX_REASON_CHARS. */
export function cleanReason(reason: string): string {
  const flat = reason.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > MAX_REASON_CHARS ? `${flat.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…` : flat;
}

/** Validates a parsed model answer. Returns null (with why) if it isn't a usable decision. */
export function validateDecision(raw: unknown): { decision: Decision } | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "not a JSON object" };
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !["action", "asset", "usdAmount", "reason"].includes(k));
  if (extra.length) return { error: `unexpected fields: ${extra.join(", ")}` };
  if (o.action !== "buy" && o.action !== "sell" && o.action !== "hold") return { error: "action must be buy, sell or hold" };
  if (o.asset !== "TSLA" && o.asset !== "AMZN") return { error: "asset must be TSLA or AMZN" };
  if (typeof o.usdAmount !== "number" || !Number.isFinite(o.usdAmount) || o.usdAmount < 0) {
    return { error: "usdAmount must be a non-negative number" };
  }
  if (typeof o.reason !== "string" || !o.reason.trim()) return { error: "reason must be a non-empty string" };
  const usd = o.action === "hold" ? 0 : Math.floor(o.usdAmount * 100) / 100;
  if (o.action !== "hold" && usd < 1) return { error: "a trade must be at least $1" };
  if (usd > 1e12) return { error: "usdAmount is absurd" };
  return { decision: { action: o.action, asset: o.asset, usdAmount: usd, reason: cleanReason(o.reason) } };
}

export interface Encoded {
  json: string;
  hex: Hex;
  hash: Hex;
  bytes: number;
}

/** Encodes a record, trimming its reason if needed to stay under MAX_DECISION_BYTES. */
export function encodeDecision(record: Record<string, unknown> & { reason: string }): Encoded {
  let r = { ...record };
  let json = canonicalJson(r);
  while (stringToBytes(json).length > MAX_DECISION_BYTES && r.reason.length > 20) {
    r = { ...r, reason: `${r.reason.slice(0, Math.max(20, r.reason.length - 40)).trimEnd()}…` };
    json = canonicalJson(r);
  }
  const bytes = stringToBytes(json);
  return { json, hex: toHex(bytes), hash: keccak256(bytes), bytes: bytes.length };
}

export const usdString = (units6: bigint) => {
  const neg = units6 < 0n;
  const v = neg ? -units6 : units6;
  const cents = v / 10_000n;
  return `${neg ? "-" : ""}${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
};

export const priceString = (answer8: bigint) => {
  const cents = answer8 / 1_000_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
};
