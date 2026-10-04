// The decision receipt. `AgentAccount.trade` takes the AI's decision as calldata bytes and emits keccak256(bytes) in
// the Traded or Blocked event. This is the same canonical form the Bondline agents use (sorted keys, no whitespace),
// so anyone can re-hash a trade's input and check the reasoning. The contract only hashes; it does not parse.
import { keccak256, stringToBytes, toHex, bytesToString, hexToBytes, type Hex } from "viem";

export const MAX_DECISION_BYTES = 800;
export const MAX_REASON_CHARS = 240;

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

/** One line, no control characters, at most MAX_REASON_CHARS. */
export function cleanReason(reason: string): string {
  const flat = reason.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > MAX_REASON_CHARS ? `${flat.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…` : flat;
}

export interface EncodedDecision {
  /** The exact text that is hashed. */
  json: string;
  /** The bytes passed to `trade` as `decision`. */
  hex: Hex;
  /** keccak256(hex): what the Traded or Blocked event carries as `decisionHash`. */
  hash: Hex;
  bytes: number;
}

/**
 * Encodes a decision for `trade`. An object is written as canonical JSON; if it has a string `reason` and is over
 * `maxBytes`, the reason is shortened until it fits (as the Bondline agents do). A string is used exactly as given
 * (it must be valid JSON), so a hash you computed elsewhere still matches.
 */
export function encodeDecision(decision: Record<string, unknown> | string, maxBytes = MAX_DECISION_BYTES): EncodedDecision {
  let json: string;
  if (typeof decision === "string") {
    try {
      JSON.parse(decision);
    } catch {
      throw new Error("decision string is not valid JSON");
    }
    json = decision;
  } else {
    if (decision === null || typeof decision !== "object" || Array.isArray(decision)) {
      throw new Error("decision must be a JSON object or a JSON string");
    }
    let r: Record<string, unknown> = { ...decision };
    json = canonicalJson(r);
    while (stringToBytes(json).length > maxBytes && typeof r.reason === "string" && r.reason.length > 20) {
      r = { ...r, reason: `${r.reason.slice(0, Math.max(20, r.reason.length - 40)).trimEnd()}…` };
      json = canonicalJson(r);
    }
  }
  const bytes = stringToBytes(json);
  if (bytes.length > maxBytes) throw new Error(`decision is ${bytes.length} bytes, over the ${maxBytes}-byte limit`);
  return { json, hex: toHex(bytes), hash: keccak256(bytes), bytes: bytes.length };
}

/** The hash an event should carry for these decision bytes, and the text they spell. */
export function hashDecisionBytes(hex: Hex): { hash: Hex; json: string } {
  return { hash: keccak256(hex), json: bytesToString(hexToBytes(hex)) };
}
