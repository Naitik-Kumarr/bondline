// Claim-letter worker. Not the keeper: it never sends a transaction and holds no private key.
//
// It watches the Settled event of every cover of both Bondline markets on Robinhood Chain testnet and, for each
// settle, asks Claude Haiku 4.5 for a short plain-English letter to the user, using ONLY the numbers and links this
// script gives it. Each letter is written to deployments/letters/<settleTx>.json with its keccak256 hash.
//
//   npx tsx --env-file=.env scripts/claim-letters.ts              # backfill from the markets' deploy block, then watch
//   npx tsx --env-file=.env scripts/claim-letters.ts --once       # backfill, write what is missing, exit
//   npx tsx scripts/claim-letters.ts --dry-run [--once]           # template letters, no model, temp directory only
//   npx tsx scripts/claim-letters.ts --from-block <n> --poll <seconds> --out-dir <dir>
//   npx tsx scripts/claim-letters.ts --fixture events.json --dry-run --once    # offline: events from a file
//
// Rules this file keeps:
//  - The only secret it reads is ANTHROPIC_API_KEY from the environment. It is never printed or written. (--env-file
//    is Node's flag: it loads the file into the environment; this script does not open any .env file itself.)
//  - No model, no letter. If the API key is missing or Anthropic rejects it (HTTP 401/403), the worker says so and
//    exits with code 2 without writing a letter. A letter that fails its checks (a number that was not given to the
//    model, too long, empty) is not written either.
//  - --dry-run writes a template letter labelled "template, no model" to a temp directory, never to deployments/letters.
//  - A settle tx names its letter's file, so only a canonical transaction hash (0x + 64 hex) gets a letter, from a
//    fixture or from the chain, and the letter's path must resolve inside the output folder. Anything else is skipped.
//  - A letter is labelled "scripted gap" when its settle tx is one in deployments/gap-demo.json or gap-party.json, or
//    when it settled on the Replay market outside every replay session (between sessions the replay feeds move only
//    in a scripted gap). Both are re-read for every settle, so records written after the worker started count.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createPublicClient, formatUnits, getAbiItem, http, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { addressUrl, bondlineCoverAbi, bondlineMarketAbi, deployment, robinhoodTestnet, txUrl, USDG_DECIMALS } from "../shared/src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LETTERS_DIR = join(ROOT, "deployments", "letters");
const MODEL = "claude-haiku-4-5-20251001";
const RPC = process.env.BONDLINE_RPC ?? "https://rpc.testnet.chain.robinhood.com";
const MAX_WORDS = 220; // the prompt asks for at most 200; a few more are tolerated, more is rejected
const MAX_ATTEMPTS = 2;

// ------------------------------------------------------------------ arguments

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const ONCE = flag("--once");
const POLL_S = Number(opt("--poll") ?? 20);
const FROM_BLOCK = opt("--from-block");
const FIXTURE = opt("--fixture");

// A fixture's settles are made up, so its letters may only ever be templates in a scratch folder.
if (FIXTURE && !DRY_RUN) {
  console.error("--fixture is for testing and needs --dry-run: letters for made-up settles must never reach deployments/letters.");
  process.exit(1);
}

/**
 * The path with symlinks resolved for the parts that exist, in the filesystem's own spelling, lower-cased: so neither a
 * link nor a different case (macOS volumes are case-insensitive) can smuggle a write into a protected folder.
 */
function realPath(path: string): string {
  let head = resolve(path);
  const tail: string[] = [];
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) break;
    tail.unshift(basename(head));
    head = parent;
  }
  return join(realpathSync.native(head), ...tail).toLowerCase();
}

/** A canonical transaction hash, any case. */
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** The settle tx as a lower-case canonical hash (0x + 64 hex), or null for anything else. */
export function canonicalTx(tx: unknown): Hex | null {
  return typeof tx === "string" && TX_HASH.test(tx) ? (tx.toLowerCase() as Hex) : null;
}

/**
 * Where the letter for one settle goes: <dir>/<tx>.json, lower-case. Null when the tx isn't a canonical hash or the
 * resolved path would leave `dir`, so a malformed tx (e.g. "../x" in a fixture) never reaches the filesystem.
 */
export function letterPathFor(dir: string, tx: unknown): string | null {
  const hash = canonicalTx(tx);
  if (!hash) return null;
  const root = resolve(dir);
  const path = resolve(root, `${hash}.json`);
  return dirname(path) === root ? path : null;
}

/** Events whose settle tx is a canonical hash, lower-cased; the rest are reported and skipped. */
function withCanonicalTx(events: SettleEvent[], source: string): SettleEvent[] {
  const kept: SettleEvent[] = [];
  for (const e of events) {
    const tx = canonicalTx(e.settleTx);
    if (tx) kept.push({ ...e, settleTx: tx });
    else console.error(`  skipped a settle from ${source}: its tx ${JSON.stringify(String(e.settleTx)).slice(0, 80)} is not 0x + 64 hex`);
  }
  return kept;
}

const outDir = (() => {
  const given = opt("--out-dir");
  if (DRY_RUN) {
    const dir = given ? resolve(given) : mkdtempSync(join(tmpdir(), "bondline-letters-"));
    // Not the letters folder, and nothing else under deployments/ either.
    const [real, deploymentsDir] = [realPath(dir), realPath(dirname(LETTERS_DIR))];
    if (real === deploymentsDir || real.startsWith(deploymentsDir + sep)) {
      console.error("--dry-run never writes to deployments/ (where the real letters live). Choose another --out-dir.");
      process.exit(1);
    }
    return dir;
  }
  return given ? resolve(given) : LETTERS_DIR;
})();

// ------------------------------------------------------------------ the scripted-gap tx hashes

/** Every settle transaction named in the scripted-gap records (deployments/gap-demo.json, gap-party.json). */
function scriptedSettleTxs(): Set<string> {
  const found = new Set<string>();
  const isTx = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
  const walk = (node: unknown, key = "", parentKey = "") => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, key, parentKey));
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, k, key);
      return;
    }
    if (!isTx(node)) return;
    if (key === "settleTx" || key === "settleTxHash" || (parentKey === "settle" && (key === "tx" || key === "hash"))) {
      found.add(node.toLowerCase());
    }
  };
  for (const file of ["gap-demo.json", "gap-party.json"]) {
    const path = join(ROOT, "deployments", file);
    if (!existsSync(path)) continue;
    try {
      walk(JSON.parse(readFileSync(path, "utf8")));
    } catch (e) {
      console.warn(`could not read ${file}: ${(e as Error).message}`);
    }
  }
  return found;
}

/**
 * The replay sessions in the deployment record, as [start, end] in unix seconds: a session ends when its replayed
 * window does (window ÷ speed after its start); aborted attempts end when they were stopped. No grace after the end:
 * the keeper's scripted gap starts pushing as soon as the window ends, and its settles must be labelled. The cost is
 * that a settle on the replay's own last prices in the few seconds after the end is labelled scripted too.
 */
export function replaySessions(): [number, number][] {
  try {
    const r = JSON.parse(readFileSync(join(ROOT, "deployments", "rhTestnet.json"), "utf8")).replay ?? {};
    const span = Number(r.windowEnd) - Number(r.windowStart);
    const runs: { startsAt?: number; speed?: number }[] = [...(r.sessions ?? []), ...(r.startsAt ? [{ startsAt: r.startsAt, speed: r.speed }] : [])];
    const out: [number, number][] = runs
      .filter((x) => Number(x.startsAt) > 0 && Number(x.speed) > 0)
      .map((x) => [Number(x.startsAt), Number(x.startsAt) + span / Number(x.speed)]);
    for (const a of (r.attempts ?? []) as { startsAt?: number; stoppedAt?: number }[]) {
      if (a.startsAt && a.stoppedAt) out.push([a.startsAt, a.stoppedAt]);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Was this settle caused by a scripted gap? Yes when a scripted-gap record names its tx, or when it settled on the
 * Replay market outside every replay session. Null when that can't be decided yet (no block time for a Replay settle).
 */
export function isScripted(e: SettleEvent, settledAtIso: string | null): boolean | null {
  if (scriptedSettleTxs().has(e.settleTx.toLowerCase())) return true;
  if (e.market.toLowerCase() !== deployment.markets.replay.address?.toLowerCase()) return false;
  if (!settledAtIso) return FIXTURE ? false : null;
  const t = Date.parse(settledAtIso) / 1000;
  return !replaySessions().some(([from, to]) => t >= from && t <= to);
}

// ------------------------------------------------------------------ the facts a letter may use

export interface SettleEvent {
  settleTx: Hex;
  blockNumber: number;
  market: Address;
  marketLabel: string;
  cover: Address;
  account: Address;
  user: Address;
  /** USDG units (6 decimals). */
  value: bigint;
  loss: bigint;
  limit: bigint;
  payout: bigint;
}

const usdg = (x: bigint) => Number(formatUnits(x, USDG_DECIMALS)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Exact decimal USDG for the record (no thousands separators). */
const exact = (x: bigint) => formatUnits(x, USDG_DECIMALS);

function factsOf(e: SettleEvent, scripted: boolean, settledAt: string | null) {
  const principal = e.value + e.loss; // loss = principal - value, exactly, in the cover's math
  return {
    scripted_gap: scripted,
    market: `${e.marketLabel} market`,
    account_value_at_settle_usdg: usdg(e.value),
    starting_principal_usdg: usdg(principal),
    loss_usdg: usdg(e.loss),
    loss_limit_usdg: usdg(e.limit),
    payout_usdg: usdg(e.payout),
    user_keeps_loss_usdg: usdg(e.loss - e.payout),
    settled_at_utc: settledAt,
    user_address: e.user,
    account_address: e.account,
    cover_address: e.cover,
    settle_tx: e.settleTx,
    links: {
      settle_transaction: txUrl(e.settleTx),
      account: addressUrl(e.account),
      user: addressUrl(e.user),
      cover: addressUrl(e.cover),
    },
  };
}
type Facts = ReturnType<typeof factsOf>;

const SYSTEM = `You write short claim letters for Bondline, a protection bond on Robinhood Chain testnet. A user's AI-traded account lost more than its loss limit, anyone settled it on-chain, and the underwriter's bond paid the loss beyond the limit.

Write one plain-English letter from "Bondline" to the user, at most 200 words, in a calm and factual tone.

Rules:
- Use ONLY the facts in the user's message. Every number you write must be copied exactly as given (for example "100.00 USDG"). Do not calculate, round, convert or add any number, percentage, date or count that is not given.
- Include the settle transaction link and the account link exactly as given.
- Say what happened (the account's loss passed its limit and was settled), what the bond paid, and what the user kept bearing (the limit part of the loss).
- If scripted_gap is true, say plainly in the first sentence that this was a "scripted gap": a test event staged by the Bondline team on testnet with scripted prices, not a real market move.
- Never promise anything beyond the facts. No investment, legal or tax advice. Say nothing about the future. This is testnet with test funds; say so once.
- Output the letter text only: no subject line, no markdown, no preamble.`;

// ------------------------------------------------------------------ checks and the letter itself

const stripLinks = (s: string) => s.replace(/https?:\/\/\S+/g, " ").replace(/0x[0-9a-fA-F]+/g, " ");
const numbersIn = (s: string) =>
  (stripLinks(s).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.$/, ""));

/** Why a letter must be refused, or null if it passes. */
export function problemWith(letter: string, facts: Facts): string | null {
  const text = letter.trim();
  if (!text) return "empty letter";
  const words = text.split(/\s+/).length;
  if (words > MAX_WORDS) return `${words} words (limit ${MAX_WORDS})`;
  const allowed = new Set(numbersIn(JSON.stringify({ ...facts, links: undefined, user_address: "", account_address: "", cover_address: "", settle_tx: "" })));
  const stray = numbersIn(text).filter((n) => !allowed.has(n));
  if (stray.length) return `numbers that were not given to the model: ${[...new Set(stray)].join(", ")}`;
  if (!text.includes(facts.links.settle_transaction)) return "missing the settle transaction link";
  if (!text.includes(facts.links.account)) return "missing the account link";
  if (facts.scripted_gap && !/scripted gap/i.test(text)) return 'missing the label "scripted gap"';
  return null;
}

function templateLetter(facts: Facts): string {
  return [
    "template, no model",
    "",
    `${facts.scripted_gap ? "Scripted gap. " : ""}Your Bondline account on the ${facts.market} lost ${facts.loss_usdg} USDG against a loss limit of ${facts.loss_limit_usdg} USDG, so it was settled on-chain. The bond paid ${facts.payout_usdg} USDG; you bore ${facts.user_keeps_loss_usdg} USDG.`,
    `Settle transaction: ${facts.links.settle_transaction}`,
    `Account: ${facts.links.account}`,
    "This is a placeholder produced without a model (--dry-run); it is not a Bondline claim letter.",
  ].join("\n");
}

class AuthProblem extends Error {}

let anthropic: Anthropic | undefined;

async function writeWithModel(facts: Facts): Promise<{ letter: string; model: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AuthProblem("ANTHROPIC_API_KEY is not set in the environment (run with --env-file=.env or export it).");
  }
  anthropic ??= new Anthropic();
  let feedback = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 700,
        temperature: 0.2,
        system: SYSTEM,
        messages: [{ role: "user", content: `Facts (JSON):\n${JSON.stringify(facts, null, 2)}${feedback}` }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        throw new AuthProblem(`Anthropic rejected the API key (HTTP ${e.status}). Replace ANTHROPIC_API_KEY and run again.`);
      }
      throw e;
    }
    const letter = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const problem = response.stop_reason === "max_tokens" ? "the reply was cut off" : problemWith(letter, facts);
    if (!problem) return { letter, model: response.model };
    console.warn(`  attempt ${attempt}: letter refused (${problem})`);
    feedback = `\n\nYour previous letter was refused: ${problem}. Write it again, following every rule.`;
  }
  throw new Error("the model's letters failed the checks; nothing written");
}

// ------------------------------------------------------------------ chain

const client = createPublicClient({ chain: robinhoodTestnet, transport: http(RPC, { retryCount: 5, retryDelay: 1000, timeout: 30_000 }) });
const settledEvent = getAbiItem({ abi: bondlineCoverAbi, name: "Settled" });
const MARKETS = (["live", "replay"] as const).flatMap((key) => {
  const m = deployment.markets[key];
  return m.address ? [{ key, label: m.label, address: m.address, deployBlock: m.deployBlock ?? 0 }] : [];
});

async function allCovers(): Promise<Map<string, { market: (typeof MARKETS)[number] }>> {
  const covers = new Map<string, { market: (typeof MARKETS)[number] }>();
  for (const market of MARKETS) {
    const offers = await client.readContract({ address: market.address, abi: bondlineMarketAbi, functionName: "offers" });
    for (const o of offers) covers.set(o.cover.toLowerCase(), { market });
  }
  return covers;
}

async function logsBetween(covers: Address[], from: bigint, to: bigint) {
  let span = 50_000n;
  const out = [];
  for (let start = from; start <= to; ) {
    const end = start + span - 1n > to ? to : start + span - 1n;
    try {
      out.push(...(await client.getLogs({ address: covers, event: settledEvent, fromBlock: start, toBlock: end })));
      start = end + 1n;
    } catch (e) {
      if (span <= 500n) throw e;
      span /= 2n; // the RPC refused this range: halve it
    }
  }
  return out;
}

async function fetchEvents(from: bigint, to: bigint): Promise<SettleEvent[]> {
  const covers = await allCovers();
  if (covers.size === 0) return [];
  const logs = await logsBetween([...covers.keys()] as Address[], from, to);
  const events = logs.map((l) => {
    const market = covers.get(l.address.toLowerCase())!.market;
    const a = l.args as { account: Address; user: Address; value: bigint; loss: bigint; limit: bigint; payout: bigint };
    return {
      settleTx: l.transactionHash,
      blockNumber: Number(l.blockNumber),
      market: market.address,
      marketLabel: market.label,
      cover: l.address,
      account: a.account,
      user: a.user,
      value: a.value,
      loss: a.loss,
      limit: a.limit,
      payout: a.payout,
    };
  });
  return withCanonicalTx(events, "the chain");
}

function fixtureEvents(path: string): SettleEvent[] {
  const rows = JSON.parse(readFileSync(path, "utf8")) as Record<string, string | number>[];
  const events = rows.map((r) => ({
    settleTx: r.settleTx as Hex,
    blockNumber: Number(r.blockNumber ?? 0),
    market: r.market as Address,
    marketLabel: String(r.marketLabel ?? "Replay"),
    cover: r.cover as Address,
    account: r.account as Address,
    user: r.user as Address,
    value: BigInt(r.value),
    loss: BigInt(r.loss),
    limit: BigInt(r.limit),
    payout: BigInt(r.payout),
  }));
  return withCanonicalTx(events, "the fixture");
}

async function settledAt(e: SettleEvent): Promise<string | null> {
  if (FIXTURE) return null;
  try {
    const block = await client.getBlock({ blockNumber: BigInt(e.blockNumber) });
    return new Date(Number(block.timestamp) * 1000).toISOString().replace(".000Z", "Z");
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ one settle -> one letter file

async function handle(e: SettleEvent): Promise<"written" | "exists" | "failed"> {
  const path = letterPathFor(outDir, e.settleTx);
  if (!path) {
    console.error(`  no letter: the settle tx is not 0x + 64 hex, or its letter would land outside ${outDir}`);
    return "failed";
  }
  if (existsSync(path)) return "exists";
  const at = await settledAt(e);
  const scripted = isScripted(e, at);
  if (scripted === null) {
    console.error(`  ${e.settleTx}: no letter yet (could not read the block time to tell a replay settle from a scripted gap)`);
    return "failed";
  }
  const facts = factsOf(e, scripted, at);
  let letter: string;
  let model: string;
  if (DRY_RUN) {
    letter = templateLetter(facts);
    model = "template, no model";
  } else {
    try {
      ({ letter, model } = await writeWithModel(facts));
    } catch (err) {
      if (err instanceof AuthProblem) throw err;
      console.error(`  ${e.settleTx}: no letter written (${(err as Error).message})`);
      return "failed";
    }
  }
  const record = {
    settleTx: e.settleTx,
    account: e.account,
    cover: e.cover,
    market: e.market,
    user: e.user,
    payout: exact(e.payout),
    loss: exact(e.loss),
    limit: exact(e.limit),
    letter,
    hash: keccak256(stringToBytes(letter)),
    model,
    createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    scripted,
    // extras, for readers and the site
    unit: "USDG",
    marketLabel: e.marketLabel,
    value: exact(e.value),
    blockNumber: e.blockNumber,
    settledAt: facts.settled_at_utc,
    ...(DRY_RUN ? { dryRun: true } : {}),
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n");
  console.log(`  ${DRY_RUN ? "template" : "letter"} written: ${relative(ROOT, path)}${scripted ? " (scripted gap)" : ""}`);
  return "written";
}

// ------------------------------------------------------------------ main

async function main() {
  console.log(
    `claim-letters: ${DRY_RUN ? "DRY RUN (template letters, no model) -> " + outDir : "model " + MODEL + " -> " + relative(ROOT, outDir)}; ` +
      `${FIXTURE ? "events from " + FIXTURE : "Robinhood Chain testnet " + MARKETS.map((m) => m.label).join(" + ")}`,
  );
  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) throw new AuthProblem("ANTHROPIC_API_KEY is not set in the environment (run with --env-file=.env or export it).");

  if (existsSync(outDir)) console.log(`${readdirSync(outDir).filter((f) => f.endsWith(".json")).length} letters already in ${relative(ROOT, outDir)}`);
  let cursor = BigInt(FROM_BLOCK ?? Math.min(...MARKETS.map((m) => m.deployBlock)));

  const retry = new Map<string, SettleEvent>(); // settles whose letter failed: tried again on the next pass
  for (;;) {
    const head = FIXTURE ? 0n : await client.getBlockNumber();
    const fresh = FIXTURE ? fixtureEvents(FIXTURE) : await fetchEvents(cursor, head);
    if (!FIXTURE) cursor = head + 1n;
    const events = [...retry.values(), ...fresh.filter((e) => !retry.has(e.settleTx))];
    retry.clear();
    const tally = { written: 0, exists: 0, failed: 0 };
    for (const e of events) {
      const r = await handle(e);
      tally[r]++;
      if (r === "failed") retry.set(e.settleTx, e);
    }
    console.log(`${events.length} settles seen: ${tally.written} written, ${tally.exists} already had a letter, ${tally.failed} failed`);
    if (ONCE || FIXTURE) return;
    await new Promise((r) => setTimeout(r, POLL_S * 1000));
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("claim-letters.ts")) {
  main().catch((e) => {
    if (e instanceof AuthProblem) {
      console.error(`\nNo letter written. ${e.message}`);
      process.exit(2);
    }
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
