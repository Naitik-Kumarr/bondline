// Verdicts from the independent verifiers (verification/<A|B|C|D|E>.json). The rule: show a workstream's numbers
// only when its file exists with status "pass"; with "partial", only claims its verified[] names; else nothing.
import "server-only";
import { readRepoJson } from "./files";

export type Workstream = "A" | "B" | "C" | "D" | "E";

export interface Verification {
  workstream: string;
  status: "pass" | "partial" | "fail";
  verified: unknown[];
}

export function readVerification(ws: Workstream): Verification | null {
  const v = readRepoJson<Partial<Verification>>(`verification/${ws}.json`);
  if (!v || (v.status !== "pass" && v.status !== "partial" && v.status !== "fail")) return null;
  return { workstream: v.workstream ?? ws, status: v.status, verified: Array.isArray(v.verified) ? v.verified : [] };
}

/**
 * May this claim be shown? "pass": yes. "partial": only when a verified[] entry mentions one of the needles
 * (case-insensitive). "fail" or no file: no.
 */
export function claimVerified(ws: Workstream, ...needles: string[]): boolean {
  const v = readVerification(ws);
  if (!v || v.status === "fail") return false;
  if (v.status === "pass") return true;
  const hay = v.verified.map((x) => (typeof x === "string" ? x : JSON.stringify(x)).toLowerCase());
  return needles.some((n) => hay.some((h) => h.includes(n.toLowerCase())));
}
