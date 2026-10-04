"use client";

import { usdg as fmtUsdg } from "@/lib/bondline/format";
import { CheckRow, FaucetLinks } from "./Checks";
import { JudgeDrip } from "./JudgeDrip";
import type { WalletFunds } from "./useWalletFunds";

/**
 * The wallet half of "Before you sign": USDG's issuer controls, the USDG balance against what this action needs,
 * and ETH for gas. Faucet links appear wherever funds are missing.
 */
export function FundsChecks({ funds, need, needWhat = "this" }: { funds: WalletFunds; need?: bigint | null; needWhat?: string }) {
  const enough = need == null || (funds.usdg !== undefined && funds.usdg >= need);
  return (
    <>
      {funds.checking ? (
        <CheckRow state="wait" title="Checking USDG's issuer controls…" />
      ) : funds.problem ? (
        <CheckRow
          state="problem"
          title={funds.problem}
          detail="You can still look around. A frozen wallet also can't receive a payout."
        />
      ) : funds.controlsError ? (
        <CheckRow
          state="info"
          title="Couldn't read USDG's issuer controls just now"
          detail="If USDG is paused or this wallet is frozen, the transaction fails and says so. It retries every 30 seconds."
        />
      ) : (
        <CheckRow
          state="ok"
          title="USDG isn't paused, and this wallet isn't frozen"
          detail="Read from the USDG contract, Paxos's issuer controls"
        />
      )}
      {funds.usdg === undefined ? (
        <CheckRow state="wait" title="Reading your USDG balance…" />
      ) : (
        <CheckRow
          state={enough ? "ok" : "problem"}
          title={
            <>
              You have <span className="num">{fmtUsdg(funds.usdg)}</span> USDG
              {!enough && need != null ? (
                <>
                  ; {needWhat} needs <span className="num">{fmtUsdg(need)}</span>
                </>
              ) : null}
            </>
          }
          detail={
            !enough ? (
              <>
                <FaucetLinks need="usdg" />
                <JudgeDrip />
              </>
            ) : undefined
          }
        />
      )}
      {funds.eth === 0n ? <CheckRow state="problem" title="No ETH for gas" detail={<FaucetLinks need="eth" />} /> : null}
    </>
  );
}
