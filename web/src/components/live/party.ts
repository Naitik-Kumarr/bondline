// The Gap Party plan, from deployments/party.json (the main session's file: the source of truth for the times).
import "server-only";
import { readRepoJson } from "@/lib/external/files";
import type { GapRecord } from "@/components/judge/gap";

export interface Party {
  label: string;
  market: "replay" | "live";
  status: string;
  sessionStartsAt: number;
  gapAt: number;
  note: string;
}

export function readParty(): Party | null {
  const p = readRepoJson<Partial<Party>>("deployments/party.json");
  if (!p || typeof p.sessionStartsAt !== "number" || typeof p.gapAt !== "number") return null;
  return {
    label: p.label ?? "Gap Party",
    market: p.market === "live" ? "live" : "replay",
    status: p.status ?? "scheduled",
    sessionStartsAt: p.sessionStartsAt,
    gapAt: p.gapAt,
    note: p.note ?? "",
  };
}

/** The keeper's record of the scripted gap (deployments/gap-party.json), once it exists. */
export const readPartyRecord = () => readRepoJson<GapRecord>("deployments/gap-party.json");
