import { BaseError, ContractFunctionRevertedError } from "viem";
import { describeTxError } from "@/components/ui/TxStatus";

/** Plain-language reasons for every refusal a wallet flow can hit. Keys are Solidity custom error names. */
const PLAIN: Record<string, string> = {
  // BondlineCover
  InsufficientCapacity:
    "This offer's free bond can't back this deposit's worst case. Try a smaller deposit, a higher limit or another offer.",
  DepositTooSmall: "The smallest deposit is 1 USDG.",
  LimitOutOfRange: "That limit is outside this offer's range.",
  InvalidRules: "Those rules are outside this offer's bounds.",
  NotListed: "This offer is no longer listed, so it takes no new cover.",
  StalePrices:
    "Prices are too old right now. Withdraw and settle need fresh prices: try again after the keeper pushes a new one.",
  InvalidPrices: "A stock price is missing or invalid right now, so the account can't be valued.",
  WithinLimit: "The loss is within the limit, so there is nothing to settle.",
  NotActive: "This cover is no longer active.",
  UnknownAccount: "This isn't an account covered by this offer.",
  InsufficientCash: "The account doesn't hold that much cash. Only cash can be withdrawn while the cover is active.",
  InsufficientFreeBond: "Only free bond can be released; the rest backs active covers.",
  NotUser: "Only the account's owner can do this.",
  NotUnderwriter: "Only this offer's underwriter can do this.",
  ZeroAmount: "Enter an amount above zero.",
  ZeroAddress: "An address is missing.",
  // BondlineMarket
  InvalidTerms: "Those terms aren't valid: check the limit range (below 30%), the premium (at most 5%) and the name.",
  ZeroBond: "The bond must be above zero.",
  // AgentAccount
  NotOwner: "Only the account's owner can do this.",
  AlreadyStopped: "The agent is already stopped: this cover was settled or closed.",
  AlreadyPaused: "The agent is already paused.",
  NotPaused: "The agent isn't paused.",
  NotReleased: "Sweeping opens only after the cover is settled or closed.",
  // USDG
  CallerMustBePayee: "USDG refused the authorization: only its payee, the market, can use it.",
  AuthorizationAlreadyUsed: "This USDG authorization was already used. Sign a new one.",
  AuthorizationNotYetValid: "This USDG authorization isn't valid yet.",
  AuthorizationExpired: "This USDG authorization expired. Sign a new one.",
  InvalidSignature: "USDG didn't accept the signature. Sign again with the connected wallet.",
  ContractPaused: "USDG transfers are paused by its issuer, Paxos.",
  AddressFrozen: "A wallet in this transfer is frozen by USDG's issuer, Paxos.",
  ERC20InsufficientBalance: "Not enough USDG in the wallet for this.",
  ERC20InsufficientAllowance: "The USDG approval is smaller than the amount. Approve the exact amount first.",
  SafeERC20FailedOperation: "The USDG transfer failed.",
};

/** describeTxError, plus a plain sentence for Bondline's and USDG's own refusals. */
export function explainTxError(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && PLAIN[name]) return PLAIN[name];
    }
  }
  return describeTxError(error);
}
