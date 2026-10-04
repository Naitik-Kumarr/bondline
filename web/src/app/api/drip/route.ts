// The judge drip: 5 test USDG from a team-operated wallet, once per wallet, while today's budget lasts.
// Checks, cheapest first. Before any wallet or RPC work (lib/drip/guard.ts): the body must be a JSON object with a
// string address, and a best-effort per-IP limit (one drip and five attempts per IP address per 24 hours) kept in this
// server instance's memory. Then from the chain, with no database: a wallet that ever received a drip is refused, and
// so is every request once the drip wallet has sent 30 USDG to outside wallets in the last 24 hours. Sends are
// serialized: one transaction at a time, with the nonce read fresh each time.
//
// None of these limits is shared between server instances, so requests spread over several instances at once can get
// past them (audit findings S-1 and S-2). The hard cap is the drip wallet's balance: fund it with at most one day's
// budget (30 USDG) at a time, so no mix of instances or requests can send more than that.
import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deployment, isTeamWallet, robinhoodTestnet, txUrl, USDG, usdgAbi } from "@bondline/shared";
import { addressFromBody, clientIp, IpLimiter } from "../../../lib/drip/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AMOUNT = 5_000_000n; // 5 USDG
const DAILY_CAP = 30_000_000n; // 30 USDG a day
const DAY_SECONDS = 86_400n;
const CHUNK = 50_000n;
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const client = createPublicClient({
  chain: robinhoodTestnet,
  transport: http(process.env.RH_TESTNET_RPC_URL || undefined, { retryCount: 2, timeout: 20_000 }),
});

/** Per IP address, in this instance only. Best effort; the drip wallet's balance is the hard cap (see the top). */
const perIp = new IpLimiter();

let tail: Promise<unknown> = Promise.resolve();
/** One drip at a time in this instance: the checks and the send run as one step. */
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.catch(() => undefined);
  return run;
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Every USDG transfer the drip wallet has sent since the markets were deployed, with block times. */
async function sentByDrip(drip: Address) {
  const from = BigInt(deployment.markets.live.deployBlock ?? 0);
  const latest = await client.getBlockNumber();
  const logs = [];
  for (let start = from; start <= latest; start += CHUNK) {
    const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
    logs.push(...(await client.getLogs({ address: USDG, event: transferEvent, args: { from: drip }, fromBlock: start, toBlock: end })));
  }
  return { logs, latest };
}

async function drip(to: Address, onSent: () => void) {
  const key = process.env.DRIP_PRIVATE_KEY as Hex | undefined;
  if (!key) return fail(503, "The judge drip isn't switched on here. Get test USDG from Paxos's faucet instead.");
  const account = privateKeyToAccount(key);

  const [paused, frozen, balance] = await Promise.all([
    client.readContract({ address: USDG, abi: usdgAbi, functionName: "paused" }),
    client.readContract({ address: USDG, abi: usdgAbi, functionName: "isFrozen", args: [to] }),
    client.readContract({ address: USDG, abi: usdgAbi, functionName: "balanceOf", args: [account.address] }),
  ]);
  if (paused) return fail(409, "USDG transfers are paused by its issuer, Paxos, so the drip can't send right now.");
  if (frozen) return fail(409, "This wallet is frozen by USDG's issuer, Paxos, so it can't receive USDG.");
  if (balance < AMOUNT) return fail(503, "The drip is empty for now. Get test USDG from Paxos's faucet instead.");

  const { logs, latest } = await sentByDrip(account.address);
  if (logs.some((l) => l.args.to?.toLowerCase() === to.toLowerCase())) {
    return fail(409, "This wallet already received its 5 test USDG from the drip (one per wallet).");
  }
  const now = (await client.getBlock({ blockNumber: latest })).timestamp;
  let today = 0n;
  for (const l of logs) {
    if (!l.args.to || isTeamWallet(l.args.to)) continue;
    const t = (await client.getBlock({ blockNumber: l.blockNumber })).timestamp;
    if (now - t < DAY_SECONDS) today += l.args.value ?? 0n;
  }
  if (today + AMOUNT > DAILY_CAP) {
    return fail(429, "Today's 30 test USDG from the drip are gone. Try again tomorrow, or use Paxos's faucet.");
  }

  const wallet = createWalletClient({
    account,
    chain: robinhoodTestnet,
    transport: http(process.env.RH_TESTNET_RPC_URL || undefined),
  });
  const send = async () => {
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    return wallet.writeContract({ address: USDG, abi: usdgAbi, functionName: "transfer", args: [to, AMOUNT], nonce });
  };
  let hash: Hex;
  try {
    hash = await send();
  } catch {
    hash = await send(); // a nonce race with another sender: read it again once
  }
  onSent();
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") return fail(502, "The drip transaction reverted; nothing was sent.");
  return NextResponse.json({ ok: true, amount: "5", hash, url: txUrl(hash) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Send a JSON body with your wallet address.");
  }
  const given = addressFromBody(body);
  if (!given.ok) return fail(400, given.error);
  if (!isAddress(given.value)) return fail(400, "That isn't a wallet address.");
  const to = getAddress(given.value);
  if (isTeamWallet(to)) return fail(403, "Team-operated wallets don't take from the judge drip.");

  const ip = clientIp(request.headers);
  const allowed = perIp.begin(ip);
  if (!allowed.ok) return fail(429, allowed.error);
  let sent = false;
  let paid = false;
  try {
    const response = await oneAtATime(() => drip(to, () => (sent = true)));
    paid = response.status === 200;
    return response;
  } catch {
    paid = sent; // sent but not confirmed: it may have paid, so it counts
    return fail(502, "The drip couldn't reach Robinhood Chain just now. Try again in a minute.");
  } finally {
    perIp.finish(ip, paid);
  }
}
