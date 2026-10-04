// Every deployed contract, from the deployment record, and whether the public explorer has its verified source.
import "server-only";
import type { Address } from "viem";
import { EXPLORER_URL } from "@bondline/shared/chain";
import { deployment, isLocalFork } from "@bondline/shared/deployment";

export interface ContractRow {
  name: string;
  role: string;
  address: Address;
}

export function deployedContracts(): ContractRow[] {
  const rows: ContractRow[] = [];
  const add = (name: string, role: string, address: Address | null | undefined) => {
    if (address) rows.push({ name, role, address });
  };
  add("BondlineMarket", "Live market: factory and registry, no owner", deployment.markets.live.address);
  add("BondlineMarket", "Replay market: factory and registry, no owner", deployment.markets.replay.address);
  add("BondlineCover", "Implementation every offer clones (EIP-1167)", deployment.implementations.cover);
  add("AgentAccount", "Implementation every covered account clones", deployment.implementations.account);
  add("OracleVenue", "Live market's demo exchange", deployment.markets.live.venue);
  add("OracleVenue", "Replay market's demo exchange", deployment.markets.replay.venue);
  for (const m of ["live", "replay"] as const) {
    for (const [sym, feed] of Object.entries(deployment.markets[m].feeds)) {
      add("MirrorFeed", `${sym} price, ${m === "live" ? "Live" : "Replay"} market (pushed by our keeper)`, feed);
    }
  }
  add("ProofOfCover", "Read-only lookup: whether an account has active cover, its underwriter, limit and cap, and the cover's free capacity", deployment.proofOfCover?.address);
  return rows;
}

/**
 * Asks the explorer (Blockscout API) whether each address has verified source. Cached for an hour.
 * null = couldn't tell (explorer unreachable, or this build reads a local fork, where the explorer can't see it).
 */
export async function verifiedOnExplorer(addresses: Address[]): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  if (isLocalFork) {
    for (const a of addresses) out.set(a.toLowerCase(), null);
    return out;
  }
  await Promise.all(
    addresses.map(async (a) => {
      try {
        const res = await fetch(`${EXPLORER_URL}/api/v2/smart-contracts/${a}`, {
          next: { revalidate: 3600 },
          signal: AbortSignal.timeout(5000),
          headers: { accept: "application/json" },
        });
        if (res.status === 404) return void out.set(a.toLowerCase(), false);
        if (!res.ok) return void out.set(a.toLowerCase(), null);
        const body = (await res.json()) as { is_verified?: boolean };
        out.set(a.toLowerCase(), body.is_verified === true);
      } catch {
        out.set(a.toLowerCase(), null);
      }
    }),
  );
  return out;
}
