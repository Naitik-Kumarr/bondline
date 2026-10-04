// Sets up Bondline's team-operated test book on Robinhood Chain testnet, after the contracts are deployed.
// Keys come from ./.env and are never printed. Every transaction hash is logged and saved.
//
//   npx tsx scripts/testnet-setup.ts balances      # what each project wallet holds
//   npx tsx scripts/testnet-setup.ts plan          # the book this USDG can fund, in priority order (no transactions)
//   npx tsx scripts/testnet-setup.ts consolidate   # team wallets send surplus USDG where the plan needs it, stocks to the deployer
//   npx tsx scripts/testnet-setup.ts stock         # deployer stocks both demo exchanges (stocks 70/30 replay/live, USDG per plan)
//   npx tsx scripts/testnet-setup.ts offers        # underwriter: one-signature offers, bonds per plan
//   npx tsx scripts/testnet-setup.ts covers        # buyer: covers per plan (exact approvals); writes deployments/team-book.json
//   npx tsx scripts/testnet-setup.ts inventory     # checks each exchange can fill every account's largest possible buys
//   npx tsx scripts/testnet-setup.ts gas           # deployer tops up service wallets with ETH
//
// USDG comes from Paxos's faucet, 100 per wallet per day, so the book is small and sized to what the wallets hold.
// The gap demo is a cover behind Bold on the Replay market with a principal of exactly 100 USDG (104.166666 deposited
// at Bold's 4% premium): at a 10% limit and a 25% gap, the user loses 10 and the bond pays 15.
import { config } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  parseSignature,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  bondlineCoverAbi,
  bondlineMarketAbi,
  deployment,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  robinhoodTestnet,
  STOCKS,
  txUrl,
  USDG,
  USDG_DOMAIN,
  type MarketKey,
} from "@bondline/shared";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env"), quiet: true });

// RH_RPC_URL points the script at a local fork of the testnet (scripts/dev-fork.sh) instead of the real chain.
const rpc = process.env.RH_RPC_URL || undefined;
const fork = Boolean(rpc);
const LOG = join(root, "deployments", fork ? "setup-log-fork.json" : "setup-log.json");
const BOOK = join(root, "deployments", fork ? "team-book-fork.json" : "team-book.json");
const log: Record<string, unknown>[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : [];
const record = (entry: Record<string, unknown>) => {
  log.push({ at: new Date().toISOString(), ...entry });
  writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
};

const publicClient = createPublicClient({ chain: robinhoodTestnet, transport: http(rpc) });
type Role = "DEPLOYER" | "KEEPER" | "CAREFUL" | "BOLD" | "UNDERWRITER" | "BUYER";
const ROLES: Role[] = ["DEPLOYER", "KEEPER", "CAREFUL", "BOLD", "UNDERWRITER", "BUYER"];
const wallet = (name: Role) => {
  const key = process.env[`${name}_PRIVATE_KEY`] as Hex | undefined;
  if (!key) throw new Error(`${name}_PRIVATE_KEY is not set in .env`);
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain: robinhoodTestnet, transport: http(rpc) }) };
};
const addressOf = (role: Role) => deployment.wallets[role.toLowerCase() as keyof typeof deployment.wallets];

const U = 1_000_000n;
const usd = (n: bigint) => `${formatUnits(n, 6)} USDG`;
const MIN_GAS = parseEther("0.0002");

async function send(label: string, write: () => Promise<Hex>) {
  const hash = await write();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${txUrl(hash)}`);
  console.log(`✓ ${label}  ${fork ? `(fork) ${hash}` : txUrl(hash)}`);
  record({ label, hash, block: Number(receipt.blockNumber) });
  return receipt;
}

const balance = (token: Address, who: Address) =>
  publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

function requireDeployed() {
  if (deployment.status !== "deployed") throw new Error("Contracts are not deployed yet (deployments/rhTestnet.json).");
}

// ------------------------------------------------------------------ the plan

type Persona = "careful" | "bold";

const TERMS: Record<Persona, { minLimitBps: number; maxLimitBps: number; feeBps: number; maxStockBps: number; name: string }> = {
  careful: { minLimitBps: 500, maxLimitBps: 2000, feeBps: 100, maxStockBps: 3000, name: "Careful 1%" },
  bold: { minLimitBps: 500, maxLimitBps: 2000, feeBps: 400, maxStockBps: 8000, name: "Bold 4%" },
};

function rulesFor(persona: Persona, market: MarketKey) {
  const maxAge = deployment.markets[market].maxPriceAge;
  return {
    assetMask: 3,
    maxStockBps: persona === "careful" ? 3000 : 8000,
    maxTradeBps: persona === "careful" ? 1000 : 4000,
    maxDailyBps: persona === "careful" ? 20_000 : 60_000,
    maxSlippageBps: 50,
    // The live market accepts prices up to Chainlink's 24h heartbeat (+1h) for settling; the accounts' own rule is
    // stricter, so agents only trade on prices from the last 4 hours and wait out weekends.
    maxPriceAge: Math.min(maxAge, 4 * 3600),
  };
}

interface Step {
  what: string;
  market: MarketKey;
  persona?: Persona;
  bond?: bigint; // underwriter
  deposit?: bigint; // buyer; principal = deposit − premium
  venueUsdg?: bigint; // deployer → that market's demo exchange
  gapDemo?: boolean;
}

/** In priority order: if the team holds less USDG, the plan stops before the first step it can't fund. */
const STEPS: Step[] = [
  // 104.166666 at Bold's 4%: premium 4.166666 joins the bond, principal is exactly 100.000000.
  { what: "Replay · Bold offer + the gap-demo cover", market: "replay", persona: "bold", bond: 40n * U, deposit: 104_166_666n, gapDemo: true },
  { what: "Replay · demo exchange cash", market: "replay", venueUsdg: 40n * U },
  { what: "Replay · Careful offer + cover", market: "replay", persona: "careful", bond: 25n * U, deposit: 50n * U },
  { what: "Live · Careful offer", market: "live", persona: "careful", bond: 25n * U },
  { what: "Live · Bold offer", market: "live", persona: "bold", bond: 25n * U },
  { what: "Live · Careful cover", market: "live", persona: "careful", deposit: 30n * U },
  { what: "Live · Bold cover", market: "live", persona: "bold", deposit: 31_250_000n }, // principal 30.000000
  { what: "Live · demo exchange cash", market: "live", venueUsdg: 30n * U },
];

const cost = (s: Step) => (s.bond ?? 0n) + (s.deposit ?? 0n) + (s.venueUsdg ?? 0n);

async function teamUsdg() {
  const held = await Promise.all(ROLES.map((r) => balance(USDG, addressOf(r))));
  return { held: Object.fromEntries(ROLES.map((r, i) => [r, held[i]])) as Record<Role, bigint>, total: held.reduce((a, b) => a + b, 0n) };
}

// The plan is fixed the first time it's computed: later commands spend the USDG it counted, so recomputing from
// what's left would wrongly drop steps.
const PLAN = join(root, "deployments", fork ? "team-plan-fork.json" : "team-plan.json");

async function makePlan() {
  const { held, total } = await teamUsdg();
  let steps: Step[];
  let spent = 0n;
  if (existsSync(PLAN)) {
    const saved: string[] = JSON.parse(readFileSync(PLAN, "utf8")).steps;
    steps = STEPS.filter((s) => saved.includes(s.what));
    for (const s of steps) spent += cost(s);
  } else {
    steps = [];
    for (const s of STEPS) {
      if (spent + cost(s) > total) break;
      steps.push(s);
      spent += cost(s);
    }
    writeFileSync(PLAN, JSON.stringify({ at: new Date().toISOString(), totalUsdg: total.toString(), steps: steps.map((s) => s.what) }, null, 2) + "\n");
  }
  const need: Record<Role, bigint> = { DEPLOYER: 0n, KEEPER: 0n, CAREFUL: 0n, BOLD: 0n, UNDERWRITER: 0n, BUYER: 0n };
  for (const s of steps) {
    need.UNDERWRITER += s.bond ?? 0n;
    need.BUYER += s.deposit ?? 0n;
    need.DEPLOYER += s.venueUsdg ?? 0n;
  }
  return { steps, spent, total, held, need };
}

async function plan() {
  const p = await makePlan();
  console.log(`Team USDG: ${usd(p.total)}. The plan uses ${usd(p.spent)}:`);
  for (const s of STEPS) {
    const included = p.steps.includes(s);
    const parts = [s.bond && `bond ${usd(s.bond)}`, s.deposit && `cover ${usd(s.deposit)}`, s.venueUsdg && `cash ${usd(s.venueUsdg)}`]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${included ? "✓" : "·"} ${s.what}: ${parts}${s.gapDemo ? " (principal 100: lose 10, bond pays 15)" : ""}`);
  }
  for (const r of ROLES) console.log(`  ${r.padEnd(12)} holds ${usd(p.held[r]).padEnd(16)} needs ${usd(p.need[r])}`);
  if (!p.steps.some((s) => s.gapDemo)) console.log("  ! not enough USDG for the gap demo yet (needs 144.166666)");
}

// ------------------------------------------------------------------ commands

async function balances() {
  for (const role of ROLES) {
    const address = addressOf(role);
    const [eth, usdg, tsla, amzn] = await Promise.all([
      publicClient.getBalance({ address }),
      balance(USDG, address),
      balance(STOCKS.TSLA.address, address),
      balance(STOCKS.AMZN.address, address),
    ]);
    console.log(
      `${role.padEnd(12)} ${address}  ETH ${formatEther(eth).padEnd(12)} USDG ${formatUnits(usdg, 6).padEnd(10)} ` +
        `TSLA ${formatUnits(tsla, 18).padEnd(8)} AMZN ${formatUnits(amzn, 18)}`,
    );
  }
}

/** Team wallets send surplus USDG to the wallets the plan needs it in, and every stock token to the deployer. */
async function consolidate() {
  requireDeployed();
  const p = await makePlan();
  const surplus = ROLES.map((r) => ({ r, amount: p.held[r] > p.need[r] ? p.held[r] - p.need[r] : 0n })).filter((x) => x.amount > 0n);
  const deficit = ROLES.map((r) => ({ r, amount: p.need[r] > p.held[r] ? p.need[r] - p.held[r] : 0n })).filter((x) => x.amount > 0n);
  for (const d of deficit) {
    for (const s of surplus) {
      if (d.amount === 0n) break;
      if (s.amount === 0n) continue;
      const amount = s.amount < d.amount ? s.amount : d.amount;
      const { client, account } = wallet(s.r);
      if ((await publicClient.getBalance({ address: account.address })) < MIN_GAS) {
        console.log(`  · ${s.r} has no gas; skipping its ${usd(amount)}`);
        s.amount = 0n;
        continue;
      }
      await send(`${usd(amount)}: ${s.r} → ${d.r}`, () =>
        client.writeContract({ address: USDG, abi: erc20Abi, functionName: "transfer", args: [addressOf(d.r), amount] }),
      );
      s.amount -= amount;
      d.amount -= amount;
    }
    if (d.amount > 0n) console.log(`  ! ${d.r} is still ${usd(d.amount)} short`);
  }
  for (const r of ROLES.filter((x) => x !== "DEPLOYER")) {
    for (const [symbol, s] of Object.entries(STOCKS)) {
      const held = await balance(s.address, addressOf(r));
      if (held === 0n) continue;
      const { client, account } = wallet(r);
      if ((await publicClient.getBalance({ address: account.address })) < MIN_GAS) continue;
      await send(`${formatUnits(held, 18)} ${symbol}: ${r} → DEPLOYER`, () =>
        client.writeContract({ address: s.address, abi: erc20Abi, functionName: "transfer", args: [addressOf("DEPLOYER"), held] }),
      );
    }
  }
}

/** The deployer stocks both demo exchanges: stocks 70% to Replay (where the agents trade now), 30% to Live. */
async function stock() {
  requireDeployed();
  const { client, account } = wallet("DEPLOYER");
  const p = await makePlan();
  const venues: Record<MarketKey, Address> = { replay: deployment.markets.replay.venue!, live: deployment.markets.live.venue! };
  for (const [symbol, s] of Object.entries(STOCKS)) {
    const held = await balance(s.address, account.address);
    if (held === 0n) continue;
    const replayShare = (held * 7n) / 10n;
    for (const [market, amount] of [["replay", replayShare], ["live", held - replayShare]] as const) {
      if (amount === 0n) continue;
      await send(`stock ${formatUnits(amount, 18)} ${symbol} → ${market} exchange`, () =>
        client.writeContract({ address: s.address, abi: erc20Abi, functionName: "transfer", args: [venues[market], amount] }),
      );
    }
  }
  for (const s of p.steps.filter((x) => x.venueUsdg)) {
    await send(`stock ${usd(s.venueUsdg!)} → ${s.market} exchange`, () =>
      client.writeContract({ address: USDG, abi: erc20Abi, functionName: "transfer", args: [venues[s.market], s.venueUsdg!] }),
    );
  }
}

/** One USDG signature per offer: the underwriter signs ReceiveWithAuthorization; the market creates and funds it. */
async function offers() {
  requireDeployed();
  const { client, account } = wallet("UNDERWRITER");
  const p = await makePlan();
  for (const s of p.steps.filter((x) => x.bond)) {
    const market = deployment.markets[s.market].address!;
    const existing = await publicClient.readContract({ address: market, abi: bondlineMarketAbi, functionName: "offers" });
    const agent = deployment.wallets[s.persona!];
    if (existing.some((o) => o.agent.toLowerCase() === agent.toLowerCase() && o.underwriter.toLowerCase() === account.address.toLowerCase())) {
      console.log(`  · ${s.market}: ${TERMS[s.persona!].name} offer already exists`);
      continue;
    }
    const nonce = keccak256(toHex(`bondline-offer-${s.market}-${s.persona}-${Date.now()}`));
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await client.signTypedData({
      domain: USDG_DOMAIN,
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message: { from: account.address, to: market, value: s.bond!, validAfter: 0n, validBefore, nonce },
    });
    const { r, s: sig, v, yParity } = parseSignature(signature);
    await send(`${s.market}: ${TERMS[s.persona!].name} offer, ${usd(s.bond!)} bond, one signature`, () =>
      client.writeContract({
        address: market,
        abi: bondlineMarketAbi,
        functionName: "createOfferWithAuthorization",
        args: [{ agent, ...TERMS[s.persona!] }, s.bond!, 0n, validBefore, nonce, v !== undefined ? Number(v) : yParity + 27, r, sig],
      }),
    );
  }
}

/** The team's test buyer opens the planned covers (10% limit, exact approvals) and records the accounts. */
async function covers() {
  requireDeployed();
  const { client, account } = wallet("BUYER");
  const p = await makePlan();
  const book: Record<string, unknown>[] = existsSync(BOOK) ? JSON.parse(readFileSync(BOOK, "utf8")) : [];
  for (const s of p.steps.filter((x) => x.deposit)) {
    const market = deployment.markets[s.market].address!;
    const all = await publicClient.readContract({ address: market, abi: bondlineMarketAbi, functionName: "offers" });
    const agent = deployment.wallets[s.persona!].toLowerCase();
    const offer = all.find((o) => o.listed && o.agent.toLowerCase() === agent);
    if (!offer) throw new Error(`no ${s.persona} offer on ${s.market}; run offers first`);
    if (book.some((b) => b.market === s.market && b.persona === s.persona)) {
      console.log(`  · ${s.market}: ${s.persona} cover already opened`);
      continue;
    }
    await send(`${s.market}: approve exactly ${usd(s.deposit!)}`, () =>
      client.writeContract({ address: USDG, abi: erc20Abi, functionName: "approve", args: [offer.cover, s.deposit!] }),
    );
    const receipt = await send(`${s.market}: cover behind ${TERMS[s.persona!].name}, 10% limit, ${usd(s.deposit!)}`, () =>
      client.writeContract({
        address: offer.cover,
        abi: bondlineCoverAbi,
        functionName: "open",
        args: [1000, rulesFor(s.persona!, s.market), s.deposit!],
      }),
    );
    const [opened] = parseEventLogs({ abi: bondlineCoverAbi, eventName: "Opened", logs: receipt.logs });
    const position = await publicClient.readContract({
      address: offer.cover,
      abi: bondlineCoverAbi,
      functionName: "position",
      args: [opened.args.account],
    });
    book.push({
      market: s.market,
      persona: s.persona,
      cover: offer.cover,
      account: opened.args.account,
      principal: position.principal.toString(),
      limitBps: 1000,
      gapDemo: Boolean(s.gapDemo),
      tx: receipt.transactionHash,
      user: account.address,
    });
    writeFileSync(BOOK, JSON.stringify(book, null, 2) + "\n");
  }
}

/**
 * Each exchange must be able to fill every covered account's largest possible buys: an account can put up to its
 * rules' stock share of its value into either stock, so the worst case is every account buying the same stock.
 * Priced at the lowest replay price less 40% (the scripted gap), which needs the most tokens.
 */
async function inventory() {
  requireDeployed();
  const rounds = JSON.parse(readFileSync(join(root, "keeper", "data", "replay-rounds.json"), "utf8"));
  const low: Record<string, number> = {};
  for (const symbol of Object.keys(STOCKS)) {
    const answers = rounds[symbol].rounds.map((r: { answer: string }) => Number(r.answer) / 1e8);
    low[symbol] = Math.min(...answers) * 0.6;
  }
  let ok = true;
  for (const key of ["replay", "live"] as const) {
    const m = deployment.markets[key];
    const all = await publicClient.readContract({ address: m.address!, abi: bondlineMarketAbi, functionName: "offers" });
    let maxBuyUsd = 0;
    for (const offer of all) {
      const n = await publicClient.readContract({ address: offer.cover, abi: bondlineCoverAbi, functionName: "accountCount" });
      const share = offer.agent.toLowerCase() === deployment.wallets.careful.toLowerCase() ? 0.3 : 0.8;
      for (let i = 0n; i < n; i++) {
        const a = await publicClient.readContract({ address: offer.cover, abi: bondlineCoverAbi, functionName: "accountAt", args: [i] });
        const h = await publicClient.readContract({ address: offer.cover, abi: bondlineCoverAbi, functionName: "health", args: [a] });
        if (h.status === 1) maxBuyUsd += (Number(h.principal) / 1e6) * share * 1.1; // 10% headroom for gains
      }
    }
    for (const [symbol, s] of Object.entries(STOCKS)) {
      const held = Number(formatUnits(await balance(s.address, m.venue!), 18));
      const needed = maxBuyUsd / low[symbol];
      const pass = held >= needed;
      ok &&= pass;
      console.log(
        `${pass ? "✓" : "✗"} ${key} exchange ${symbol}: holds ${held.toFixed(4)}, worst case needs ${needed.toFixed(4)} ` +
          `(all accounts buy $${maxBuyUsd.toFixed(2)} of ${symbol} at $${low[symbol].toFixed(2)})`,
      );
    }
    const cash = await balance(USDG, m.venue!);
    console.log(`  ${key} exchange cash: ${usd(cash)} (pays agents' sells; grows with their buys)`);
  }
  if (!ok) {
    console.log("✗ Not enough stock in an exchange: get more TSLA/AMZN from the faucet into the deployer, then run stock.");
    process.exitCode = 1;
  } else console.log("✓ Both exchanges can fill every account's largest possible buys.");
}

/**
 * Two covers behind Bold on the Live market with a tight 5% limit, opened by the team's test buyer, meant to stay
 * open through judging: if real prices fall enough once markets reopen, they settle on real Chainlink prices.
 * USDG comes from the team's spare (Bold's wallet holds the plan's leftover). LIVE_COVER_DEPOSIT sets each deposit.
 */
async function liveCovers() {
  requireDeployed();
  const deposit = BigInt(process.env.LIVE_COVER_DEPOSIT ?? "15625000"); // 15.625 USDG: principal 15 at Bold's 4%
  const { client, account } = wallet("BUYER");
  const need = deposit * 2n;
  const held = await balance(USDG, account.address);
  if (held < need) {
    const spare = wallet("BOLD");
    const amount = need - held;
    await send(`${usd(amount)}: BOLD (spare) → BUYER for the live 5% covers`, () =>
      spare.client.writeContract({ address: USDG, abi: erc20Abi, functionName: "transfer", args: [account.address, amount] }),
    );
  }
  const market = deployment.markets.live.address!;
  const all = await publicClient.readContract({ address: market, abi: bondlineMarketAbi, functionName: "offers" });
  const offer = all.find((o) => o.listed && o.agent.toLowerCase() === deployment.wallets.bold.toLowerCase());
  if (!offer) throw new Error("no Bold offer on the live market");
  const book: Record<string, unknown>[] = existsSync(BOOK) ? JSON.parse(readFileSync(BOOK, "utf8")) : [];
  const already = book.filter((b) => b.market === "live" && b.persona === "bold" && b.limitBps === 500).length;
  for (let i = already; i < 2; i++) {
    await send(`live: approve exactly ${usd(deposit)}`, () =>
      client.writeContract({ address: USDG, abi: erc20Abi, functionName: "approve", args: [offer.cover, deposit] }),
    );
    const receipt = await send(`live: cover ${i + 1} behind Bold 4%, 5% limit, ${usd(deposit)}`, () =>
      client.writeContract({
        address: offer.cover,
        abi: bondlineCoverAbi,
        functionName: "open",
        args: [500, rulesFor("bold", "live"), deposit],
      }),
    );
    const [opened] = parseEventLogs({ abi: bondlineCoverAbi, eventName: "Opened", logs: receipt.logs });
    book.push({
      market: "live",
      persona: "bold",
      cover: offer.cover,
      account: opened.args.account,
      limitBps: 500,
      purpose: "open through judging; settles on real prices if markets fall far enough",
      tx: receipt.transactionHash,
      user: account.address,
    });
    writeFileSync(BOOK, JSON.stringify(book, null, 2) + "\n");
  }
}

/**
 * The Gap Party's target: a fresh team cover behind Bold on the Replay market (10% limit), opened before the second
 * replay session so Bold invests it. The scripted gap is sized against this account. PARTY_COVER_DEPOSIT sets it.
 */
async function partyCover() {
  requireDeployed();
  const deposit = BigInt(process.env.PARTY_COVER_DEPOSIT ?? "20833333"); // principal 20 at Bold's 4%
  const { client, account } = wallet("BUYER");
  const held = await balance(USDG, account.address);
  if (held < deposit) {
    const spare = wallet("BOLD");
    const amount = deposit - held;
    await send(`${usd(amount)}: BOLD (spare) → BUYER for the party cover`, () =>
      spare.client.writeContract({ address: USDG, abi: erc20Abi, functionName: "transfer", args: [account.address, amount] }),
    );
  }
  const book: Record<string, unknown>[] = existsSync(BOOK) ? JSON.parse(readFileSync(BOOK, "utf8")) : [];
  if (book.some((b) => b.partyTarget)) {
    console.log("  · the party cover already exists");
    return;
  }
  const market = deployment.markets.replay.address!;
  const all = await publicClient.readContract({ address: market, abi: bondlineMarketAbi, functionName: "offers" });
  const offer = all.find((o) => o.listed && o.agent.toLowerCase() === deployment.wallets.bold.toLowerCase());
  if (!offer) throw new Error("no Bold offer on the replay market");
  await send(`replay: approve exactly ${usd(deposit)}`, () =>
    client.writeContract({ address: USDG, abi: erc20Abi, functionName: "approve", args: [offer.cover, deposit] }),
  );
  const receipt = await send(`replay: party cover behind Bold 4%, 10% limit, ${usd(deposit)}`, () =>
    client.writeContract({
      address: offer.cover,
      abi: bondlineCoverAbi,
      functionName: "open",
      args: [1000, rulesFor("bold", "replay"), deposit],
    }),
  );
  const [opened] = parseEventLogs({ abi: bondlineCoverAbi, eventName: "Opened", logs: receipt.logs });
  book.push({
    market: "replay",
    persona: "bold",
    cover: offer.cover,
    account: opened.args.account,
    limitBps: 1000,
    partyTarget: true,
    purpose: "the Gap Party's target account (team-operated)",
    tx: receipt.transactionHash,
    user: account.address,
  });
  writeFileSync(BOOK, JSON.stringify(book, null, 2) + "\n");
}

/** The deployer sends each service wallet some ETH for gas, if it has little. */
async function gas() {
  const { client } = wallet("DEPLOYER");
  const each = parseEther(process.env.GAS_TOPUP_ETH ?? "0.002");
  for (const role of ROLES.filter((r) => r !== "DEPLOYER")) {
    const to = addressOf(role);
    const has = await publicClient.getBalance({ address: to });
    if (has >= each / 2n) continue;
    await send(`gas ${formatEther(each)} ETH → ${role}`, () => client.sendTransaction({ to, value: each }));
  }
}

const commands: Record<string, () => Promise<void>> = {
  balances,
  plan,
  consolidate,
  stock,
  offers,
  covers,
  inventory,
  gas,
  "live-covers": liveCovers,
  "party-cover": partyCover,
};
const command = process.argv[2] ?? "balances";
if (!commands[command]) {
  console.error(`unknown command ${command}; use one of ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
await commands[command]();
