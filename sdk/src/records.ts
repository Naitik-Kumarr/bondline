// Agent records: the public record `npm run record <agent>` rebuilds from chain events and writes to
// shared/src/records/<agent>.json. The SDK reads those static files; it does not rebuild them.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import { RECORDS_INDEX, recordFileName, type AgentRecord, type RecordSummary } from "@bondline/shared";

function defaultRecordsDir(): string {
  // @bondline/shared exports ./src/index.ts; the records sit next to it.
  const index = import.meta.resolve("@bondline/shared");
  return join(dirname(fileURLToPath(index)), "records");
}

export interface LoadedRecord {
  agent: Address;
  /** The full record, or null if no record file exists for this agent. */
  record: AgentRecord | null;
  /** The index entry (score, trades, refusals, claims), or null. */
  summary: RecordSummary | null;
  /** When the file was generated. A record is a snapshot, not live. */
  generatedAt: string | null;
}

/** Loads an agent's record snapshot. `recordsDir` defaults to shared/src/records. Never throws on a missing file. */
export function loadRecord(agent: Address, recordsDir?: string): LoadedRecord {
  const dir = recordsDir ?? defaultRecordsDir();
  let record: AgentRecord | null = null;
  try {
    record = JSON.parse(readFileSync(join(dir, recordFileName(agent)), "utf8")) as AgentRecord;
  } catch {
    record = null;
  }
  let summary: RecordSummary | null = null;
  if (recordsDir) {
    try {
      const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as typeof RECORDS_INDEX;
      summary = idx.agents.find((a) => a.agent.toLowerCase() === agent.toLowerCase()) ?? null;
    } catch {
      summary = null;
    }
  } else {
    summary = RECORDS_INDEX.agents.find((a) => a.agent.toLowerCase() === agent.toLowerCase()) ?? null;
  }
  return { agent, record, summary, generatedAt: record?.generatedAt ?? summary?.generatedAt ?? null };
}
