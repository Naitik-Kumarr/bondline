// The outside-agent flow with the SDK, each step with the wallet that must send it. The SDK builds; your wallets sign.
// The same calls run end to end on a local Anvil chain in test/e2e.test.ts. This file is type-checked, not run.
import type { Address, Hex, WalletClient } from "viem";
import { Bondline, testnetConfig, type UnsignedTransaction } from "@bondline/sdk";

const sdk = new Bondline(testnetConfig()); // BONDLINE_RPC_URL overrides the public RPC through configFromEnv()

// Sends an unsigned transaction built by the SDK from your own wallet.
const send = (wallet: WalletClient, tx: UnsignedTransaction) =>
  wallet.sendTransaction({ account: wallet.account!, chain: sdk.config.chain, to: tx.to, data: tx.data, value: tx.value });

/** 1. An underwriter backs an agent (any address) with ONE signature and ONE transaction. */
export async function underwrite(underwriter: WalletClient, agent: Address) {
  const auth = sdk.buildOfferAuthorization({
    market: "live",
    underwriter: underwriter.account!.address,
    terms: { agent, minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000, name: "My agent 1%" },
    bond: "500", // USDG
  });
  const signature = await underwriter.signTypedData({ account: underwriter.account!, ...auth.typedData });
  return send(underwriter, await sdk.buildCreateOfferFromSignature({ authorization: auth, signature }));
}

/** 2. A user buys cover: approve exactly the deposit, then open. */
export async function buyCover(user: WalletClient, offerId: number) {
  const { transactions, quote } = await sdk.buildCoverTransactions({ market: "live", offerId, user: user.account!.address, amount: "100", limitBps: 1000 });
  console.log("premium", quote.premium, "principal", quote.principal, "reserved", quote.reservationNeeded);
  for (const tx of transactions) await send(user, tx); // in order; wait for each receipt in real code
}

/** 3. The agent finds its accounts and trades one. A refused trade is recorded as Blocked, not reverted. */
export async function trade(agent: WalletClient) {
  const [account] = await sdk.listAccounts({ agent: agent.account!.address });
  const { transaction, decision } = await sdk.buildTradeTransaction({
    account: account.account,
    asset: "TSLA",
    side: "buy",
    usdAmount: "9",
    minOutToleranceBps: 50, // minOut from the demo exchange's current quote, less 0.5%
    decision: { action: "buy", asset: "TSLA", usdAmount: 9, reason: "why the model chose this" },
  });
  const hash: Hex = await send(agent, transaction);
  await sdk.client.waitForTransactionReceipt({ hash });
  console.log("decisionHash", decision.hash, await sdk.verifyDecision(hash));
}
