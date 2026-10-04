// Settle loop: walks every cover in both markets and settles any account whose loss has passed its limit at fresh
// prices. Anyone can call settle; this is our keeper doing it within seconds. Failed attempts back off per account.
import { parseEventLogs, type Address } from "viem";
import { bondlineCoverAbi, bondlineMarketAbi, COVER_STATUS } from "@bondline/shared";
import { MARKET_KEYS, nowSec } from "./config.ts";
import type { Ctx } from "./context.ts";
import { describeError } from "./log.ts";

const SETTLED = COVER_STATUS.indexOf("Settled");
const CLOSED = COVER_STATUS.indexOf("Closed");

export interface SettlerStats {
  sweeps: number;
  accounts: number;
  settled: number;
  failures: number;
}

export function createSettler(ctx: Ctx) {
  const accountsOf = new Map<Address, Address[]>(); // cover -> accounts seen so far (append-only on-chain)
  const done = new Set<string>(); // settled or closed: terminal
  const backoff = new Map<string, { until: number; delay: number }>();
  const stats: SettlerStats = { sweeps: 0, accounts: 0, settled: 0, failures: 0 };

  async function accounts(cover: Address): Promise<Address[]> {
    const list = accountsOf.get(cover) ?? [];
    const count = Number(await ctx.client.readContract({ address: cover, abi: bondlineCoverAbi, functionName: "accountCount" }));
    for (let i = list.length; i < count; i++) {
      list.push(
        await ctx.client.readContract({ address: cover, abi: bondlineCoverAbi, functionName: "accountAt", args: [BigInt(i)] }),
      );
    }
    accountsOf.set(cover, list);
    return list;
  }

  async function trySettle(market: string, cover: Address, account: Address): Promise<void> {
    const key = account.toLowerCase();
    const b = backoff.get(key);
    try {
      const sent = await ctx.queue.send(
        "settle",
        { address: cover, abi: bondlineCoverAbi, functionName: "settle", args: [account] },
        { market, cover, account },
      );
      if (!sent) return;
      if (!sent.ok) throw new Error(`settle transaction ${sent.hash} reverted`);
      const [ev] = parseEventLogs({ abi: bondlineCoverAbi, eventName: "Settled", logs: sent.receipt.logs });
      stats.settled++;
      done.add(key);
      backoff.delete(key);
      ctx.log.info("settled", {
        market,
        cover,
        account,
        user: ev?.args.user,
        value: ev?.args.value,
        loss: ev?.args.loss,
        limit: ev?.args.limit,
        payout: ev?.args.payout,
        tx: sent.hash,
        block: sent.receipt.blockNumber,
      });
    } catch (e) {
      stats.failures++;
      const delay = Math.min(b ? b.delay * 2 : 30, 1800);
      backoff.set(key, { until: nowSec() + delay, delay });
      ctx.log.warn("settle-failed", { market, cover, account, error: describeError(e), retryInSeconds: delay });
    }
  }

  async function settleTick(): Promise<void> {
    let checked = 0;
    for (const key of MARKET_KEYS) {
      const market = ctx.markets[key];
      let offers: readonly { cover: Address }[];
      try {
        offers = await ctx.client.readContract({ address: market.address, abi: bondlineMarketAbi, functionName: "offers" });
      } catch (e) {
        ctx.log.warn("settle-read-failed", { market: key, error: describeError(e) });
        continue;
      }
      for (const offer of offers) {
        let list: Address[];
        try {
          list = await accounts(offer.cover);
        } catch (e) {
          ctx.log.warn("settle-read-failed", { market: key, cover: offer.cover, error: describeError(e) });
          continue;
        }
        for (const account of list) {
          if (done.has(account.toLowerCase())) continue;
          checked++;
          try {
            const h = await ctx.client.readContract({
              address: offer.cover,
              abi: bondlineCoverAbi,
              functionName: "health",
              args: [account],
            });
            if (h.status === SETTLED || h.status === CLOSED) {
              done.add(account.toLowerCase());
              continue;
            }
            if (!h.settleable) continue;
            const b = backoff.get(account.toLowerCase());
            if (b && b.until > nowSec()) continue; // failed recently: wait out the backoff
            ctx.log.info("settleable", {
              market: key,
              cover: offer.cover,
              account,
              principal: h.principal,
              value: h.value,
              loss: h.loss,
              limit: h.limit,
              payoutNow: h.payoutNow,
            });
            await trySettle(key, offer.cover, account);
          } catch (e) {
            ctx.log.warn("settle-read-failed", { market: key, cover: offer.cover, account, error: describeError(e) });
          }
        }
      }
    }
    stats.sweeps++;
    stats.accounts = checked;
  }

  return { settleTick, stats };
}
