import { addressUrl, txUrl } from "@bondline/shared/chain";
import { CAP_BPS } from "@bondline/shared/constants";
import { deployment } from "@bondline/shared/deployment";
import { bpsPct, usdgToUsd } from "@/components/market/fmt";
import type { Metadata } from "next";
import { formatUnits } from "viem";
import { AutoRefresh } from "@/components/market/AutoRefresh";
import { readTour, type TourClaim } from "@/components/tour/data";
import { Tour, type TourStep } from "@/components/tour/Tour";
import {
  ClaimVisual,
  CoverVisual,
  OfferVisual,
  ProblemVisual,
  RealVisual,
  RulesVisual,
  Unavailable,
} from "@/components/tour/Visuals";

// Server-rendered from the chain, regenerated at most every minute (as /judge, whose on-chain moments it shares). While
// the claim is still to come, open tabs re-read it every 30 seconds, so it appears without a reload when it lands.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "The 2-minute tour",
  description:
    "Bondline in six steps: the risk AI traders leave with their users, an agent that can't place a trade that breaks its rules, an underwriter's bond, a cover, and a claim paid on Robinhood Chain testnet. Every number comes from the chain, our test reports or a linked source.",
};

type SettledClaim = Extract<TourClaim, { state: "settled" }>;

const usdgText = (units: bigint) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(usdgToUsd(units));

/**
 * Step 5's sentence for the scripted gap's claim, every number from the Settled event and the keeper's record: the
 * account's value at the scripted Friday close and at the settle, the loss and the limit as shares of the principal,
 * the exact payout, and how soon after the Monday-open prices it was paid. Null when the record isn't there.
 */
function claimSentence(s: SettledClaim): string | null {
  const c = s.claim;
  const g = s.gap;
  if (!s.scripted || !g || c.principal <= 0n) return null;
  const friday = (c.principal * BigInt(10_000 - g.fridayDrawdownBps)) / 10_000n;
  const lossBps = Number((c.loss * 10_000n) / c.principal);
  const delay = s.mondayAt != null && c.timestamp != null ? c.timestamp - s.mondayAt : null;
  const when =
    delay == null || delay < 0
      ? ""
      : delay < 60
        ? " seconds after the Monday-open price landed"
        : delay < 3600
          ? " minutes after the Monday-open price landed"
          : "";
  return (
    `The account fell from ${usdgText(friday)} to ${usdgText(c.value)} USDG (${bpsPct(lossBps)} loss) against a ` +
    `${bpsPct(g.limitBps)} limit; the bond paid ${formatUnits(c.payout, 6)} USDG${when}.`
  );
}

export default async function TourPage() {
  const t = await readTour();
  // A failed chain read while the running site regenerates the page: throw, so the last good page keeps being served
  // (and the next request retries) instead of caching one that says "couldn't read". At build time and in development
  // the page renders, with steps 2 to 5 saying the chain couldn't be read.
  if (!t.ok && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error(`The tour couldn't read the chain: ${t.error}`);
  }
  const w = deployment.wallets;
  const replay = deployment.markets.replay.address ?? deployment.markets.live.address;

  // Step 1's on-chain link: the wallet of the agent behind the latest AI trade (Careful's if there's none yet).
  const trader = (t.ok ? t.tradeAgent : null) ?? { name: "Careful", address: w.careful };

  const settled = t.ok && t.claim.state === "settled" ? t.claim : null;
  const claimed = settled?.claim ?? null;

  const steps: TourStep[] = [
    {
      id: "problem",
      label: "The problem",
      headline: "AI agents trade. You carry the risk.",
      sentence:
        "More than 150,000 Robinhood customers have opened agentic trading accounts, and they assume all the risk, including a price that gaps straight past a stop-loss.",
      visual: <ProblemVisual />,
      chain: {
        href: addressUrl(trader.address),
        hint: `${trader.name}, our team-operated AI agent, trading on Robinhood Chain testnet`,
      },
    },
    {
      id: "rules",
      label: "The rules",
      headline: "The agent can't place a rule-breaking trade.",
      sentence:
        "Careful and Bold are Claude agents whose limits live in the contract: every submitted trade and rule refusal leaves an on-chain receipt.",
      visual: t.ok ? (
        <RulesVisual
          agents={t.agents}
          trade={t.trade}
          tradeAgent={t.tradeAgent}
          refusal={t.refusal}
          refusalAgent={t.refusalAgent}
        />
      ) : (
        <Unavailable what="the agents' rules and decisions" />
      ),
      chain:
        t.ok && t.refusal
          ? { href: txUrl(t.refusal.txHash), hint: "The refusal and its Blocked event, on the explorer" }
          : t.ok && t.trade
            ? { href: txUrl(t.trade.txHash), hint: "This decision's transaction, with the reasoning in its input" }
            : { href: addressUrl(w.careful), hint: "Careful's transactions on the explorer" },
    },
    {
      id: "underwriter",
      label: "The underwriter",
      headline: "An underwriter backs the agent.",
      sentence:
        t.ok && t.offer && !t.offer.withSignature
          ? "One transaction creates and funds an offer: a bond behind an agent, a premium, and the loss limits buyers can pick."
          : "One USDG signature and one transaction create and fund an offer: a bond behind an agent, a premium, and the loss limits buyers can pick.",
      visual: t.ok && t.offer ? <OfferVisual data={t.offer} /> : <Unavailable what="the Careful offer" />,
      chain:
        t.ok && t.offer?.txHash
          ? {
              href: txUrl(t.offer.txHash),
              hint: t.offer.withSignature ? "The offer's one-signature transaction" : "The offer's transaction",
            }
          : replay
            ? { href: addressUrl(replay), hint: "The market contract on the explorer" }
            : null,
    },
    {
      id: "cover",
      label: "The cover",
      headline: "A user buys cover.",
      sentence:
        "The buyer picks a loss limit and deposits USDG; the premium goes to the bond, which reserves this cover's worst case first.",
      visual: t.ok && t.cover ? <CoverVisual data={t.cover} /> : <Unavailable what="a cover" />,
      chain:
        t.ok && t.cover
          ? { href: txUrl(t.cover.txHash), hint: "The purchase: Opened and Deposited in one transaction" }
          : replay
            ? { href: addressUrl(replay), hint: "The market contract on the explorer" }
            : null,
    },
    {
      id: "claim",
      label: "The claim",
      headline: "The market gaps, the bond pays.",
      sentence: settled
        ? (claimSentence(settled) ??
          (settled.scripted
            ? "A scripted Monday open takes this account through its limit; anyone can call settle, the agent stops, and the bond pays the loss beyond it."
            : "Prices gapped through this account's limit; anyone could call settle, the agent stopped, and the bond paid the loss beyond it."))
        : `When prices gap through a cover's limit, anyone can call settle: the agent stops and the bond pays the excess, up to a ${bpsPct(CAP_BPS)} drop.`,
      visual: t.ok ? <ClaimVisual data={t.claim} stopped={t.claimStopped} /> : <Unavailable what="the claim" />,
      chain: claimed
        ? { href: txUrl(claimed.txHash), hint: "The settle transaction and its Settled event" }
        : { href: addressUrl(w.keeper), hint: "Our keeper's wallet: the settle appears here when it lands" },
    },
    {
      id: "real",
      label: "What's real",
      headline: "What's real.",
      sentence:
        "Every number here comes from Robinhood Chain testnet, our test reports or a linked source; the replay market, scripted gap and team wallets are labelled.",
      visual: <RealVisual real={t.real} decisionTx={t.ok && t.trade ? t.trade.txHash : null} />,
      chain: { href: addressUrl(w.deployer), hint: "Our deployer's wallet: every contract it created" },
    },
  ];

  return (
    <>
      <Tour steps={steps} />
      {/* Re-read the chain in open tabs only while something the tour waits for can still change: the claim (step 5),
          or a read that failed. Otherwise a redeploy would reload every open tour back to step 1. */}
      {!t.ok || t.claim.state === "pending" ? <AutoRefresh every={30_000} /> : null}
    </>
  );
}
