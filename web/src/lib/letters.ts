// Claim letters (deployments/letters/<settleTx>.json, written by scripts/claim-letters.ts). Shown only when the
// letters' verifier has passed them (verification/D.json). Dry-run template letters are never shown as letters.
import "server-only";
import { readRepoJsonDir } from "@/lib/external/files";
import { claimVerified } from "@/lib/external/verification";

export interface ClaimLetterRecord {
  settleTx: string;
  account: string;
  letter: string;
  hash: string;
  model: string;
  scripted: boolean;
  payout?: string;
  loss?: string;
  limit?: string;
  unit?: string;
  createdAt?: string;
  dryRun?: boolean;
}

/** The letters written for this account, newest first. Empty when none exist or they aren't verified. */
export function lettersFor(account: string): ClaimLetterRecord[] {
  if (!claimVerified("D", "letter")) return [];
  return readRepoJsonDir<Partial<ClaimLetterRecord>>("deployments/letters")
    .map((f) => f.data)
    .filter(
      (l): l is ClaimLetterRecord =>
        typeof l.settleTx === "string" &&
        typeof l.account === "string" &&
        typeof l.letter === "string" &&
        typeof l.hash === "string" &&
        l.account.toLowerCase() === account.toLowerCase() &&
        l.dryRun !== true,
    )
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
