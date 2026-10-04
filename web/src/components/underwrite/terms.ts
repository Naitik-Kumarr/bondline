// The underwriter's terms as typed, and their validation: the same bounds BondlineMarket checks, said plainly.
import { CAP_BPS, MAX_FEE_BPS } from "@bondline/shared/constants";
import type { Address } from "viem";
import type { OfferTerms } from "@/lib/bondline/actions";
import type { AgentInfo } from "@/components/account/kit/bondline";
import { parseUsdg } from "@/components/cover/math";

export interface TermsDraft {
  minLimit: string;
  maxLimit: string;
  fee: string;
  bond: string;
  name: string;
  /** Once the name is typed by hand, stop suggesting one. */
  nameEdited: boolean;
}

export type TermsField = "minLimit" | "maxLimit" | "fee" | "bond" | "name";

export const draftFor = (agent: AgentInfo): TermsDraft => {
  const fee = agent.key === "careful" ? "1" : "4";
  return { minLimit: "5", maxLimit: "20", fee, bond: "500", name: suggestName(agent, fee), nameEdited: false };
};

export const suggestName = (agent: AgentInfo, fee: string) => `${agent.name} ${fee || "0"}%`;

const toBps = (pct: string) => {
  if (!/^\d+(\.\d{0,2})?$/.test(pct.trim())) return null;
  return Math.round(Number(pct) * 100);
};

export const nameBytes = (name: string) => new TextEncoder().encode(name).length;

export interface ValidTerms {
  terms: OfferTerms;
  bond: bigint;
}

export function validateTerms(
  draft: TermsDraft,
  agent: AgentInfo & { address: Address },
): { valid: ValidTerms | null; errors: Partial<Record<TermsField, string>> } {
  const errors: Partial<Record<TermsField, string>> = {};
  const min = toBps(draft.minLimit);
  const max = toBps(draft.maxLimit);
  const fee = toBps(draft.fee);
  const bond = parseUsdg(draft.bond);
  if (min === null || min <= 0) errors.minLimit = "Above 0%";
  if (max === null || max <= 0) errors.maxLimit = "Above 0%";
  else if (max >= CAP_BPS) errors.maxLimit = `Below the ${CAP_BPS / 100}% cap`;
  if (min !== null && max !== null && min > max && !errors.minLimit) errors.minLimit = "At most the largest limit";
  if (fee === null) errors.fee = "Enter a premium";
  else if (fee > MAX_FEE_BPS) errors.fee = `At most ${MAX_FEE_BPS / 100}%`;
  if (bond === null || bond === 0n) errors.bond = "Enter a bond above zero";
  const bytes = nameBytes(draft.name.trim());
  if (bytes === 0) errors.name = "Give the offer a name";
  else if (bytes > 64) errors.name = "At most 64 bytes";
  if (Object.keys(errors).length > 0) return { valid: null, errors };
  return {
    valid: {
      terms: {
        agent: agent.address,
        minLimitBps: min!,
        maxLimitBps: max!,
        feeBps: fee!,
        maxStockBps: agent.maxStockBps,
        name: draft.name.trim(),
      },
      bond: bond!,
    },
    errors,
  };
}
