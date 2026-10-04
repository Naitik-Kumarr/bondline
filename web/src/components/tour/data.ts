// Server-side data for /tour: every number on it comes from the readers /judge, /market, /agent and /party already use
// (the book, the on-chain moments, each account's rules, the party plan) or from the existing records (the gap record,
// the reports). The tour adds three small reads: the Careful offer's creating transaction, the purchase of the cover
// that was claimed, and the block times of both.
import "server-only";
import { decodeFunctionData, getAddress, parseAbiItem, parseEventLogs, type Address, type Hex } from "viem";
import { bondlineMarketAbi, deployment, type MarketKey } from "@bondline/shared";
import { readAccountRules, type AccountRules } from "@/components/agent/data";
import { deployedContracts, verifiedOnExplorer } from "@/components/judge/contracts";
import { readGapDemo, type GapRecord } from "@/components/judge/gap";
import { readMoments, type ClaimMoment, type DecisionMoment } from "@/components/judge/moments";
import { readReports } from "@/components/judge/reports";
import type { GapDemo } from "@/components/hero/gap-geometry";
import { readParty, readPartyRecord, type Party } from "@/components/live/party";
import { agentName, errorMessage, getBook } from "@/components/market/data";
import { readRepoJson, readRepoText } from "@/lib/external/files";
import { usdgToUsd } from "@/components/market/fmt";
import gapDemo from "@/data/gap-demo.json";
import { publicClient, type OfferView } from "@/lib/bondline/book";

const ev = {
  offerCreated: parseAbiItem(
    "event OfferCreated(uint256 indexed id, address indexed cover, address indexed underwriter, address agent, (address agent, uint16 minLimitBps, uint16 maxLimitBps, uint16 feeBps, uint16 maxStockBps, string name) terms)",
  ),
  offerFunded: parseAbiItem("event OfferFunded(uint256 indexed id, address indexed underwriter, uint256 bond)"),
  opened: parseAbiItem(
    "event Opened(address indexed account, address indexed user, uint16 limitBps, (uint8 assetMask, uint16 maxStockBps, uint16 maxTradeBps, uint32 maxDailyBps, uint16 maxSlippageBps, uint32 maxPriceAge) rules)",
  ),
  deposited: parseAbiItem(
    "event Deposited(address indexed account, address indexed from, uint256 amount, uint256 fee, uint256 net, uint256 reserveAdded)",
  ),
};

const CHUNK = 50_000n;

/** The first log a query finds, scanning 50k-block windows from the deploy block. Offers and covers are found early. */
async function firstLog<T>(fetch: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T | null> {
  for (let s = from; s <= to; s += CHUNK) {
    const logs = await fetch(s, s + CHUNK - 1n > to ? to : s + CHUNK - 1n);
    if (logs.length > 0) return logs[0];
  }
  return null;
}

const blockTime = async (blockNumber: bigint) => Number((await publicClient.getBlock({ blockNumber })).timestamp);

// ------------------------------------------------------------------ the agents and their rules

export interface TourAgentRef {
  name: string;
  address: Address;
}

export interface TourAgent {
  role: "careful" | "bold";
  address: Address;
  name: string;
  /** One covered account's rules (a replay-market account when there is one), read from the account contract. */
  rules: AccountRules | null;
  /** Its offers' maxStockBps, if no account could be read. */
  maxStockBps: number | null;
}

// ------------------------------------------------------------------ the Careful offer

export interface TourOffer {
  offer: OfferView;
  agentName: string;
  /** The transaction that created (and funded) the offer. */
  txHash: Hex | null;
  timestamp: number | null;
  /** The bond pulled in that same transaction (OfferFunded). */
  fundedBond: bigint | null;
  /** The transaction called createOfferWithAuthorization: one USDG signature, one transaction. */
  withSignature: boolean;
}

// ------------------------------------------------------------------ the cover

export interface TourCover {
  account: Address;
  user: Address;
  market: MarketKey | null;
  limitBps: number;
  amount: bigint;
  fee: bigint;
  net: bigint;
  reserveAdded: bigint;
  txHash: Hex;
  timestamp: number | null;
  offerName: string | null;
  agentName: string | null;
  feeBps: number | null;
  /** This is the account the claim (step 5) settled. */
  claimed: boolean;
}

// ------------------------------------------------------------------ the claim

export type TourClaim =
  | {
      state: "settled";
      claim: ClaimMoment;
      /** The scripted gap's settle (labelled as such); see isScripted. */
      scripted: boolean;
      /** The gap replay's input, built from the Settled event; null if the scripted Friday close isn't on record. */
      gap: GapDemo | null;
      /** When the scripted Monday-open prices landed, from the keeper's record; null if not on record. */
      mondayAt: number | null;
      agentName: string | null;
    }
  | { state: "pending"; party: Party | null };

// ------------------------------------------------------------------ what's real

export interface TourReal {
  contracts: { total: number; verified: number; known: number; first: Address | null };
  tests: { total: number; passed: number | null; failed: number | null } | null;
}

export type Tour =
  | {
      ok: true;
      agents: TourAgent[];
      /** The latest AI trade and the latest refusal (as on /judge), with the agent behind each. */
      trade: DecisionMoment | null;
      tradeAgent: TourAgentRef | null;
      refusal: DecisionMoment | null;
      refusalAgent: TourAgentRef | null;
      offer: TourOffer | null;
      cover: TourCover | null;
      claim: TourClaim;
      /** The claimed account's `stopped()`, read from its contract; null before a claim or if unread. */
      claimStopped: boolean | null;
      real: TourReal;
    }
  | { ok: false; error: string; real: TourReal };

const bps = (part: bigint, whole: bigint) => (whole > 0n ? Number((part * 10_000n) / whole) : 0);

/**
 * The keeper's records of a scripted gap: bundled when the site was built and, on a running server, read again from
 * disk, so a claim that lands after the build still finds its record.
 */
async function gapRecords(): Promise<GapRecord[]> {
  return [await readGapDemo(), readRepoJson<GapRecord>("deployments/gap-demo.json"), readPartyRecord()].filter(
    (r): r is GapRecord => r != null && typeof r === "object",
  );
}

const recordTx = (r: GapRecord) => (r.settle?.tx ?? r.summary?.settleTx)?.toLowerCase() ?? null;

/** The scripted Friday close for this settle, from whichever record names it: the hero's data, the keeper's records. */
function fridayBpsFor(claim: ClaimMoment, records: GapRecord[]): number | null {
  const tx = claim.txHash.toLowerCase();
  const hero = gapDemo as GapDemo;
  if (hero.status === "real" && hero.settleTx?.toLowerCase() === tx) return hero.fridayDrawdownBps;
  if (claim.story?.fridayDrawdownBps != null) return claim.story.fridayDrawdownBps;
  for (const r of records) {
    const friday = r.friday?.lossBps ?? r.friday?.drawdownBps;
    if (recordTx(r) === tx && friday != null) return friday;
  }
  return null;
}

/**
 * Whether this settle is the scripted gap: a record names its transaction, or it settled on the gap party's market
 * after the party's session started (the party's prices are scripted). When unsure, the label stays on.
 */
function isScripted(claim: ClaimMoment, records: GapRecord[], party: Party | null): boolean {
  if (claim.scripted) return true;
  const tx = claim.txHash.toLowerCase();
  const hero = gapDemo as GapDemo;
  if (hero.status === "real" && hero.settleTx?.toLowerCase() === tx) return true;
  if (records.some((r) => recordTx(r) === tx)) return true;
  return Boolean(party && claim.market === party.market && claim.timestamp != null && claim.timestamp >= party.sessionStartsAt);
}

/** When the scripted Monday-open prices landed (the last push on record for this settle), in unix seconds. */
function mondayAtFor(claim: ClaimMoment, records: GapRecord[]): number | null {
  const tx = claim.txHash.toLowerCase();
  const pushes = (records.find((r) => recordTx(r) === tx)?.monday?.pushes ?? []) as { updatedAt?: string }[];
  const times = pushes.map((p) => Date.parse(p.updatedAt ?? "")).filter(Number.isFinite);
  return times.length ? Math.floor(Math.max(...times) / 1000) : null;
}

/** The gap replay driven by the Settled event: principal, limit, loss and payout from the chain. */
function gapOf(claim: ClaimMoment, records: GapRecord[]): GapDemo | null {
  const friday = fridayBpsFor(claim, records);
  if (friday == null || claim.principal <= 0n) return null;
  return {
    status: "real",
    accountUsd: usdgToUsd(claim.principal),
    limitBps: Math.round(bps(claim.limit, claim.principal) / 10) * 10,
    fridayDrawdownBps: friday,
    mondayDrawdownBps: bps(claim.loss, claim.principal),
    userLossUsd: usdgToUsd(claim.loss - claim.payout),
    bondPaysUsd: usdgToUsd(claim.payout),
    settleTx: claim.txHash,
    market: claim.market ?? "replay",
  };
}

/**
 * The last full test run, from contracts/reports/tests.txt (forge's summary line). Read directly because that file
 * ships with the server function (next.config.ts), while contracts/test, which /judge counts, exists only at build.
 */
function testRun(): { passed: number; failed: number } | null {
  const m = readRepoText("contracts/reports/tests.txt")?.match(/(\d+)\s+tests?\s+passed,\s+(\d+)\s+failed/);
  return m ? { passed: Number(m[1]), failed: Number(m[2]) } : null;
}

/** Explorer verification and the test report: on /judge too. Never throws. */
async function readReal(): Promise<TourReal> {
  const contracts = deployedContracts();
  const verified = await verifiedOnExplorer(contracts.map((c) => c.address)).catch(() => new Map<string, boolean | null>());
  const known = [...verified.values()].filter((v) => v !== null);
  const run = testRun();
  const t = readReports().tests;
  return {
    contracts: {
      total: contracts.length,
      verified: known.filter(Boolean).length,
      known: known.length,
      first: contracts[0]?.address ?? null,
    },
    tests: run
      ? { total: run.passed + run.failed, passed: run.passed, failed: run.failed }
      : t
        ? { total: t.suite + t.fork, passed: t.result?.passed ?? null, failed: t.result?.failed ?? null }
        : null,
  };
}

export async function readTour(): Promise<Tour> {
  const [read, moments, real] = await Promise.all([getBook(), readMoments(), readReal()]);
  if (!read.ok) return { ok: false, error: read.error, real };
  if (!moments.ok) return { ok: false, error: moments.error, real };
  const { book, block } = read;

  try {
    const from = BigInt(
      Math.min(...(["live", "replay"] as const).map((m) => deployment.markets[m].deployBlock ?? Number.MAX_SAFE_INTEGER)),
    );
    const to = block.number;
    const offerOfAccount = (account: string) =>
      book.offers.find((o) => o.accounts.some((a) => a.address.toLowerCase() === account.toLowerCase())) ?? null;
    // The replay market first: the agents trade there and the scripted gap settles there.
    const byMarket = (a: OfferView, b: OfferView) => Number(a.market !== "replay") - Number(b.market !== "replay") || a.id - b.id;

    // Step 2: Careful and Bold, each with the rules of one of its covered accounts; and whether the claimed account
    // (step 5) is stopped. One multicall.
    const picks = (["careful", "bold"] as const).map((role) => {
      const address = deployment.wallets[role];
      const offers = book.offers.filter((o) => o.agent.toLowerCase() === address.toLowerCase()).sort(byMarket);
      return { role, address, offers, account: offers.flatMap((o) => o.accounts)[0] ?? null };
    });
    const withAccount = picks.filter((p) => p.account);
    const claimedAt = moments.claim ? offerOfAccount(moments.claim.account)?.market : undefined;
    const rules = await readAccountRules([
      ...withAccount.map((p) => ({ address: p.account!.address, market: p.account!.market })),
      ...(moments.claim && claimedAt ? [{ address: moments.claim.account, market: claimedAt }] : []),
    ]);
    const claimStopped = moments.claim && claimedAt && rules ? (rules[withAccount.length]?.stopped ?? null) : null;
    const agents: TourAgent[] = picks.map((p) => ({
      role: p.role,
      address: getAddress(p.address),
      name: agentName(p.address, p.offers),
      rules: p.account ? (rules?.[withAccount.indexOf(p)] ?? null) : null,
      maxStockBps: p.offers.length ? Math.max(...p.offers.map((o) => o.terms.maxStockBps)) : null,
    }));
    const agentOf = (account: string | undefined): TourAgentRef | null => {
      const o = account ? offerOfAccount(account) : null;
      return o ? { name: agentName(o.agent, [o]), address: getAddress(o.agent) } : null;
    };

    // Step 3: the Careful offer, and the transaction that created and funded it.
    const careful = deployment.wallets.careful.toLowerCase();
    const carefulOffer = book.offers.filter((o) => o.agent.toLowerCase() === careful).sort(byMarket)[0] ?? null;
    let offer: TourOffer | null = null;
    if (carefulOffer) {
      const market = deployment.markets[carefulOffer.market].address;
      const created = market
        ? await firstLog(
            (fromBlock, toBlock) =>
              publicClient.getLogs({ address: market, event: ev.offerCreated, args: { cover: carefulOffer.cover }, fromBlock, toBlock }),
            from,
            to,
          )
        : null;
      let withSignature = false;
      let fundedBond: bigint | null = null;
      let timestamp: number | null = null;
      if (created) {
        const [tx, receipt, time] = await Promise.all([
          publicClient.getTransaction({ hash: created.transactionHash }),
          publicClient.getTransactionReceipt({ hash: created.transactionHash }),
          blockTime(created.blockNumber),
        ]);
        try {
          withSignature =
            decodeFunctionData({ abi: bondlineMarketAbi, data: tx.input }).functionName === "createOfferWithAuthorization";
        } catch {
          withSignature = false;
        }
        const funded = parseEventLogs({ abi: [ev.offerFunded], logs: receipt.logs }).find(
          (l) => l.address.toLowerCase() === market!.toLowerCase(),
        );
        fundedBond = funded?.args.bond ?? null;
        timestamp = time;
      }
      offer = {
        offer: carefulOffer,
        agentName: agentName(carefulOffer.agent, [carefulOffer]),
        txHash: created?.transactionHash ?? null,
        timestamp,
        fundedBond,
        withSignature,
      };
    }

    // Step 5: the claim (the scripted gap's settle when it has happened, as on /judge).
    let claim: TourClaim;
    const party = readParty();
    if (moments.claim) {
      const claimOffer = offerOfAccount(moments.claim.account);
      const records = await gapRecords();
      claim = {
        state: "settled",
        claim: moments.claim,
        scripted: isScripted(moments.claim, records, party),
        gap: gapOf(moments.claim, records),
        mondayAt: mondayAtFor(moments.claim, records),
        agentName: claimOffer ? agentName(claimOffer.agent, [claimOffer]) : null,
      };
    } else {
      claim = { state: "pending", party };
    }

    // Step 4: the purchase of the cover that was claimed, so steps 4 and 5 follow one account. Before any claim, the
    // first cover bought (as on /judge).
    let cover: TourCover | null = null;
    const claimedAccount = claim.state === "settled" ? claim.claim.account : null;
    const claimedOffer = claimedAccount ? offerOfAccount(claimedAccount) : null;
    if (claimedAccount && claimedOffer) {
      const open = await firstLog(
        (fromBlock, toBlock) =>
          publicClient.getLogs({ address: claimedOffer.cover, event: ev.opened, args: { account: claimedAccount }, fromBlock, toBlock }),
        from,
        to,
      );
      if (open) {
        const [receipt, time] = await Promise.all([
          publicClient.getTransactionReceipt({ hash: open.transactionHash }),
          blockTime(open.blockNumber),
        ]);
        const dep = parseEventLogs({ abi: [ev.deposited], logs: receipt.logs }).find(
          (l) => l.args.account.toLowerCase() === claimedAccount.toLowerCase(),
        );
        cover = {
          account: getAddress(open.args.account!),
          user: getAddress(open.args.user!),
          market: claimedOffer.market,
          limitBps: Number(open.args.limitBps),
          amount: dep?.args.amount ?? 0n,
          fee: dep?.args.fee ?? 0n,
          net: dep?.args.net ?? 0n,
          reserveAdded: dep?.args.reserveAdded ?? 0n,
          txHash: open.transactionHash,
          timestamp: time,
          offerName: claimedOffer.terms.name?.trim() || null,
          agentName: agentName(claimedOffer.agent, [claimedOffer]),
          feeBps: claimedOffer.terms.feeBps,
          claimed: true,
        };
      }
    }
    if (!cover && moments.cover) {
      const c = moments.cover;
      const o = offerOfAccount(c.account);
      cover = {
        account: c.account,
        user: c.user,
        market: c.market,
        limitBps: c.limitBps,
        amount: c.amount,
        fee: c.fee,
        net: c.net,
        reserveAdded: c.reserveAdded,
        txHash: c.txHash,
        timestamp: c.timestamp,
        offerName: o?.terms.name?.trim() || null,
        agentName: o ? agentName(o.agent, [o]) : null,
        feeBps: o?.terms.feeBps ?? null,
        claimed: claimedAccount != null && c.account.toLowerCase() === claimedAccount.toLowerCase(),
      };
    }

    return {
      ok: true,
      agents,
      trade: moments.trade,
      tradeAgent: agentOf(moments.trade?.account),
      refusal: moments.refusal,
      refusalAgent: agentOf(moments.refusal?.account),
      offer,
      cover,
      claim,
      claimStopped,
      real,
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e), real };
  }
}
