import type { Address } from "viem";
import { usdg } from "@/lib/bondline/format";
import { readAccountHistoryOnce } from "./read-history";

/** What the bond actually paid when this account was settled, from its Settled event. */
export async function SettledPayout({ account }: { account: Address }) {
  try {
    const { items } = await readAccountHistoryOnce(account);
    const settled = items.find((i) => i.kind === "settled");
    return <>{settled?.payout ? `$${usdg(settled.payout)}` : "Not settled"}</>;
  } catch {
    return <>See History</>;
  }
}
