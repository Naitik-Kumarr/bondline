// Sends a decision on-chain: AgentAccount.trade(asset, isBuy, usdAmount, minOut, decisionBytes). The account never
// reverts on a rule break: it emits Blocked and changes nothing, so both outcomes are read back from the receipt.
import {
  maxUint256,
  parseEventLogs,
  type Account,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { agentAccountAbi, oracleVenueAbi } from "@bondline/shared";
import type { Decision, Encoded } from "./decision.ts";
import { stockForUsdUp, type AccountState } from "./state.ts";

export interface Outcome {
  kind: "traded" | "blocked";
  tx: Hash;
  block: bigint;
  gasUsed: bigint;
  decisionHash: Hex;
  usdAmountArg: bigint;
  minOut: bigint;
  blocked?: { reasonIndex: number; observed: bigint; limit: bigint };
  traded?: { usd: bigint; amountIn: bigint; amountOut: bigint; price: bigint; valueAfter: bigint; stockValueAfter: bigint };
}

export async function sendTrade(
  client: PublicClient,
  wallet: WalletClient<Transport, Chain, Account>,
  st: AccountState,
  d: Decision,
  encoded: Encoded,
  toleranceBps: bigint,
): Promise<Outcome> {
  const asset = st.market.assets.find((a) => a.symbol === d.asset);
  const holding = st.holdings.find((h) => h.symbol === d.asset);
  if (!asset || !holding) throw new Error(`${d.asset} is not listed on the ${st.marketKey} market`);
  const isBuy = d.action === "buy";
  const usd6 = BigInt(Math.round(d.usdAmount * 100)) * 10_000n;
  let usdAmountArg = usd6;
  let minOut = 0n;

  // minOut: the venue's quote now, less a small tolerance for the price moving before the trade lands.
  if (isBuy) {
    const [out] = await client.readContract({ address: st.market.venue, abi: oracleVenueAbi, functionName: "quoteBuy", args: [asset.address, usd6] });
    minOut = (out * (10_000n - toleranceBps)) / 10_000n;
  } else {
    const sellAll = holding.value > 0n && usd6 * 1000n >= holding.value * 995n;
    const amountIn = sellAll ? holding.balance : stockForUsdUp(usd6, holding.price);
    if (sellAll) usdAmountArg = maxUint256; // the account sells its whole balance
    if (amountIn > 0n && amountIn <= holding.balance) {
      const [out] = await client.readContract({ address: st.market.venue, abi: oracleVenueAbi, functionName: "quoteSell", args: [asset.address, amountIn] });
      minOut = (out * (10_000n - toleranceBps)) / 10_000n;
    }
    // Otherwise the account refuses it (not enough stock), and that refusal is the receipt.
  }

  const { request } = await client.simulateContract({
    address: st.account,
    abi: agentAccountAbi,
    functionName: "trade",
    args: [asset.address, isBuy, usdAmountArg, minOut, encoded.hex],
    account: wallet.account,
  });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 1_000, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`trade transaction reverted: ${hash}`);

  const logs = parseEventLogs({ abi: agentAccountAbi, logs: receipt.logs }).filter(
    (l) => l.address.toLowerCase() === st.account.toLowerCase(),
  );
  const base = { tx: hash, block: receipt.blockNumber, gasUsed: receipt.gasUsed, decisionHash: encoded.hash, usdAmountArg, minOut };
  for (const l of logs) {
    if (l.eventName === "Traded") {
      if (l.args.decisionHash !== encoded.hash) throw new Error(`decision hash mismatch in ${hash}`);
      return {
        ...base,
        kind: "traded",
        traded: {
          usd: l.args.usdAmount,
          amountIn: l.args.amountIn,
          amountOut: l.args.amountOut,
          price: l.args.price,
          valueAfter: l.args.valueAfter,
          stockValueAfter: l.args.stockValueAfter,
        },
      };
    }
    if (l.eventName === "Blocked") {
      if (l.args.decisionHash !== encoded.hash) throw new Error(`decision hash mismatch in ${hash}`);
      return { ...base, kind: "blocked", blocked: { reasonIndex: Number(l.args.reason), observed: l.args.observed, limit: l.args.limit } };
    }
  }
  throw new Error(`no Traded or Blocked event in ${hash}`);
}
