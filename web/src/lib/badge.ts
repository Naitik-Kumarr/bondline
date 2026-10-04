// "Insured by Bondline": whether an account is covered right now, read from the chain. When the ProofOfCover contract
// is deployed AND its verifier has passed it (verification/D.json), the answer comes from ProofOfCover.isCovered;
// otherwise from the cover's own health. Server only.
import "server-only";
import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  InvalidAddressError,
  parseAbi,
  type Address,
} from "viem";
import { agentAccountAbi, bondlineCoverAbi, bondlineMarketAbi, deployment, CAP_BPS } from "@bondline/shared";
import { publicClient } from "@/lib/bondline/book";
import { readRepoJson } from "@/lib/external/files";
import { claimVerified } from "@/lib/external/verification";

export type BadgeState = "covered" | "settled" | "closed" | "none" | "unavailable";

export interface BadgeStatus {
  state: BadgeState;
  /** Where the answer came from. */
  source: "ProofOfCover" | "cover health" | null;
  limitBps: number | null;
  capBps: number | null;
  market: "live" | "replay" | null;
}

const proofOfCoverAbi = parseAbi([
  "function isCovered(address account) view returns (bool covered, address underwriter, uint256 limitBps, uint256 capBps, uint256 capacity)",
]);

const none = (state: BadgeState = "none"): BadgeStatus => ({ state, source: null, limitBps: null, capBps: null, market: null });

/**
 * A read that reverts, returns no data or returns garbage means "not a Bondline account" (an EOA, or a contract
 * without these functions). Anything else (RPC down, timeout, rate limit) is rethrown, so the badge says
 * "unavailable" instead of a false "not insured".
 */
function notAnAccount(err: unknown): null {
  const benign =
    err instanceof BaseError &&
    err.walk(
      (e) =>
        e instanceof ContractFunctionRevertedError ||
        e instanceof ContractFunctionZeroDataError ||
        e instanceof AbiDecodingZeroDataError ||
        e instanceof AbiDecodingDataSizeTooSmallError ||
        e instanceof InvalidAddressError,
    );
  if (benign) return null;
  throw err;
}

/** The verified ProofOfCover address, or null (not deployed, or its verifier hasn't passed it). */
export function proofOfCoverAddress(): Address | null {
  if (!claimVerified("D", "proofofcover", "proof-of-cover", "proof of cover", "iscovered")) return null;
  const f = readRepoJson<{ address?: string }>("deployments/proof-of-cover.json");
  return f?.address && /^0x[0-9a-fA-F]{40}$/.test(f.address) ? (f.address as Address) : null;
}

/** Is this address one of Bondline's covered accounts, and in which state? Never throws. */
export async function readBadgeStatus(account: Address): Promise<BadgeStatus> {
  try {
    const poc = proofOfCoverAddress();
    // The account must belong to a real Bondline market: a stranger's contract can't claim cover.
    const [cover, market] = await Promise.all([
      publicClient.readContract({ address: account, abi: agentAccountAbi, functionName: "cover" }).catch(notAnAccount),
      publicClient.readContract({ address: account, abi: agentAccountAbi, functionName: "market" }).catch(notAnAccount),
    ]);
    if (!cover || !market) return none();
    const key = (["live", "replay"] as const).find((k) => deployment.markets[k].address?.toLowerCase() === market.toLowerCase());
    if (!key) return none();
    const [isOffer, isAccount] = await Promise.all([
      publicClient.readContract({ address: market, abi: bondlineMarketAbi, functionName: "isOffer", args: [cover] }),
      publicClient.readContract({ address: cover, abi: bondlineCoverAbi, functionName: "isAccount", args: [account] }),
    ]);
    if (!isOffer || !isAccount) return none();

    const health = await publicClient.readContract({ address: cover, abi: bondlineCoverAbi, functionName: "health", args: [account] });
    if (health.status === 2) return { state: "settled", source: "cover health", limitBps: health.limitBps, capBps: CAP_BPS, market: key };
    if (health.status === 3) return { state: "closed", source: "cover health", limitBps: null, capBps: null, market: key };

    if (poc) {
      try {
        const [covered, , limitBps, capBps] = await publicClient.readContract({
          address: poc,
          abi: proofOfCoverAbi,
          functionName: "isCovered",
          args: [account],
        });
        return {
          state: covered ? "covered" : "none",
          source: "ProofOfCover",
          limitBps: covered ? Number(limitBps) : null,
          capBps: covered ? Number(capBps) : null,
          market: key,
        };
      } catch {
        // Fall through to the cover's own health.
      }
    }
    return health.status === 1
      ? { state: "covered", source: "cover health", limitBps: health.limitBps, capBps: CAP_BPS, market: key }
      : none();
  } catch {
    return none("unavailable");
  }
}
