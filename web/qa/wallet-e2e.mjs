// End-to-end test of the wallet flows on the LOCAL FORK, driven through the site with Playwright as Anvil account #9.
//   underwrite with one signature -> buy cover (approve exactly, open) -> pause/resume -> withdraw -> close -> sweep
//   -> release free bond. Every step is checked on-chain afterwards.
//
// Needs: the fork at http://127.0.0.1:8545 (scripts/dev-fork.sh) and the site on :3102 started with
//   NEXT_PUBLIC_RH_RPC_URL=http://127.0.0.1:8545 RH_TESTNET_RPC_URL=http://127.0.0.1:8545
//   NEXT_PUBLIC_E2E_ACCOUNT=0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
// Usage: node qa/wallet-e2e.mjs [baseUrl]
// It refuses to run against anything but a localhost RPC: it never sends a transaction to a public chain.
import { chromium } from "playwright";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  toEventSelector,
  toFunctionSelector,
} from "viem";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3102";
const RPC = "http://127.0.0.1:8545";
const ME = getAddress("0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"); // Anvil #9, unlocked in the node
const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const HOLDER = "0x545FA0D7993929FEf64158F68799E6fAdfbEb983"; // a testnet USDG holder, impersonated on the fork only
const REPLAY = "0x734EdAa88537692002Fa89C090D916842e16DE7d";
const OUT = new URL(".", import.meta.url).pathname;
const CREATE_WITH_AUTH = toFunctionSelector(
  "createOfferWithAuthorization((address,uint16,uint16,uint16,uint16,string),uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
);
const APPROVAL_TOPIC = toEventSelector("Approval(address,address,uint256)");

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(RPC)) throw new Error("local fork only");
const chain = { id: 46630, name: "fork", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
if ((await pub.getChainId()) !== 46630) throw new Error("not the Robinhood Chain testnet fork");

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);
const marketAbi = parseAbi([
  "function offers() view returns ((address cover,address underwriter,address agent,bool listed)[])",
  "function balanceOf(address) view returns (uint256)",
]);
const coverAbi = parseAbi([
  "function bond() view returns (uint256)",
  "function reserved() view returns (uint256)",
  "function free() view returns (uint256)",
  "function premiums() view returns (uint256)",
  "function underwriter() view returns (address)",
  "function terms() view returns ((address agent,uint16 minLimitBps,uint16 maxLimitBps,uint16 feeBps,uint16 maxStockBps,string name))",
  "function position(address) view returns ((address user,uint16 limitBps,uint8 status,uint256 principal,uint256 reserve))",
]);
const accountAbi = parseAbi([
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function stopped() view returns (bool)",
  "function released() view returns (bool)",
]);

const results = [];
const step = (name, data) => {
  results.push({ step: name, ...data });
  console.log(`✓ ${name}`, JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};
const fail = (msg) => {
  throw new Error(msg);
};
const eq = (a, b, what) => (a === b ? true : fail(`${what}: expected ${b}, got ${a}`));

// 0. Fund #9 with USDG from a holder, on the fork only (as the brief says: impersonate, transfer).
const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const before = await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [ME] });
if (before < 3_000_000_000n) {
  await test.setBalance({ address: HOLDER, value: 10n ** 19n }); // gas, as scripts/dev-fork.sh does
  await test.impersonateAccount({ address: HOLDER });
  const holder = createWalletClient({ chain, transport: http(RPC), account: HOLDER });
  const hash = await holder.writeContract({ address: USDG, abi: erc20, functionName: "transfer", args: [ME, 5_000_000_000n] });
  await pub.waitForTransactionReceipt({ hash });
  await test.stopImpersonatingAccount({ address: HOLDER });
  step("fund #9 with 5,000 USDG (fork only)", { hash });
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: `${OUT}e2e-${name}.png`, fullPage: true });
const txHashOf = async (statusText) => {
  const status = page.getByRole("status").filter({ hasText: statusText }).last();
  await status.waitFor({ timeout: 60_000 });
  const href = await status.getByRole("link").getAttribute("href");
  return href?.split("/tx/")[1];
};

try {
  // 1. Underwrite with one signature.
  await page.goto(`${BASE}/underwrite`, { waitUntil: "load" });
  await page.getByRole("radio", { name: "Back Careful" }).click();
  await page.getByRole("radio", { name: "Replay market" }).click();
  await page.getByRole("button", { name: /Set terms for Careful/ }).click();
  await page.locator("#bond").fill("1000");
  await page.locator("#offer-name").fill("E2E Careful 1%");
  await page.getByRole("button", { name: /Review and sign/ }).click();
  const signButton = page.getByRole("button", { name: "Sign once and create the offer" });
  await signButton.waitFor();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Sign once and create the offer"));
    return b && !b.disabled;
  }, null, { timeout: 30_000 });
  await shot("underwrite-sign");
  const offersBefore = await pub.readContract({ address: REPLAY, abi: marketAbi, functionName: "offers" });
  await signButton.click();
  await page.getByRole("heading", { name: "Your offer is live." }).waitFor({ timeout: 90_000 });
  const createHash = await txHashOf("Created and funded in one transaction");
  await shot("underwrite-live");
  const offersAfter = await pub.readContract({ address: REPLAY, abi: marketAbi, functionName: "offers" });
  eq(offersAfter.length, offersBefore.length + 1, "offer count");
  const offerId = offersAfter.length - 1;
  const offer = offersAfter[offerId];
  eq(getAddress(offer.underwriter), ME, "underwriter");
  const bond = await pub.readContract({ address: offer.cover, abi: coverAbi, functionName: "bond" });
  eq(bond, 1_000_000_000n, "bond");
  const marketUsdg = await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [REPLAY] });
  eq(marketUsdg, 0n, "market keeps no USDG");
  const createTx = await pub.getTransaction({ hash: createHash });
  eq(createTx.input.slice(0, 10), CREATE_WITH_AUTH, "createOfferWithAuthorization was the one transaction");
  eq(getAddress(createTx.from), ME, "sent by the underwriter");
  const createReceipt = await pub.getTransactionReceipt({ hash: createHash });
  const myApprovals = createReceipt.logs.filter(
    (l) => getAddress(l.address) === getAddress(USDG) && l.topics[0] === APPROVAL_TOPIC && l.topics[1]?.endsWith(ME.slice(2).toLowerCase()),
  );
  eq(myApprovals.length, 0, "no approval from the underwriter");
  step("underwrite: one signature, one transaction", { hash: createHash, offerId, cover: offer.cover, bond });

  // 2. Buy cover: approve exactly the deposit, then open.
  await page.goto(`${BASE}/cover?market=replay&offer=${offerId}`, { waitUntil: "load" });
  await page.getByRole("heading", { name: "E2E Careful 1%" }).waitFor({ timeout: 30_000 });
  await page.locator("#deposit").fill("200");
  const approve = page.getByRole("button", { name: "Approve exactly 200.00 USDG" });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Approve exactly 200.00 USDG"));
    return b && !b.disabled;
  }, null, { timeout: 30_000 });
  await approve.click();
  const approveHash = await txHashOf("Approved");
  const allowance = await pub.readContract({ address: USDG, abi: erc20, functionName: "allowance", args: [ME, offer.cover] });
  eq(allowance, 200_000_000n, "approval is exactly the deposit");
  step("cover: approve exactly 200 USDG", { hash: approveHash, allowance });
  await page.getByRole("button", { name: "Open cover" }).click();
  await page.getByRole("heading", { name: "Your cover is open." }).waitFor({ timeout: 90_000 });
  const openHash = await txHashOf("Cover opened");
  const accountHref = await page.getByRole("link", { name: "Go to your account" }).getAttribute("href");
  const account = getAddress(accountHref.split("/account/")[1]);
  await shot("cover-open");
  const pos = await pub.readContract({ address: offer.cover, abi: coverAbi, functionName: "position", args: [account] });
  eq(getAddress(pos.user), ME, "cover user");
  eq(pos.status, 1, "status Active");
  eq(pos.principal, 198_000_000n, "principal = 200 - 1% premium");
  eq(pos.limitBps, 1000, "limit 10%");
  const leftover = await pub.readContract({ address: USDG, abi: erc20, functionName: "allowance", args: [ME, offer.cover] });
  eq(leftover, 0n, "no allowance left after open");
  step("cover: open", { hash: openHash, account, principal: pos.principal, reserve: pos.reserve });

  // 3. The account: pause, resume, withdraw, close, sweep.
  await page.goto(`${BASE}${accountHref}`, { waitUntil: "load" });
  await page.getByRole("heading", { name: /Traded by/ }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Pause the agent" }).click();
  const pauseHash = await txHashOf("Agent paused");
  eq(await pub.readContract({ address: account, abi: accountAbi, functionName: "paused" }), true, "paused");
  step("account: pause", { hash: pauseHash });
  await page.getByRole("button", { name: "Resume the agent" }).click();
  const resumeHash = await txHashOf("Agent resumed");
  eq(await pub.readContract({ address: account, abi: accountAbi, functionName: "paused" }), false, "resumed");
  step("account: resume", { hash: resumeHash });

  const posBefore = await pub.readContract({ address: offer.cover, abi: coverAbi, functionName: "position", args: [account] });
  await page.locator("#withdraw").fill("10");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  const withdrawHash = await txHashOf("Withdrawn to your wallet");
  const posAfter = await pub.readContract({ address: offer.cover, abi: coverAbi, functionName: "position", args: [account] });
  if (!(posAfter.principal < posBefore.principal)) fail("principal should shrink after a withdrawal");
  step("account: withdraw 10 USDG", { hash: withdrawHash, principalBefore: posBefore.principal, principalAfter: posAfter.principal });
  await shot("account-active");

  await page.getByRole("button", { name: "Close the cover" }).click();
  await page.getByRole("button", { name: "Yes, close the cover" }).click();
  const closeHash = await txHashOf("Cover closed");
  const closed = await pub.readContract({ address: offer.cover, abi: coverAbi, functionName: "position", args: [account] });
  eq(closed.status, 3, "status Closed");
  eq(closed.reserve, 0n, "reservation freed");
  eq(await pub.readContract({ address: account, abi: accountAbi, functionName: "released" }), true, "released");
  step("account: close (moves no tokens)", { hash: closeHash });

  const mineBefore = await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [ME] });
  const inAccount = await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [account] });
  await page.getByRole("button", { name: "Take everything out" }).click();
  const sweepHash = await txHashOf("Swept to your wallet");
  const mineAfter = await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [ME] });
  eq(await pub.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [account] }), 0n, "account emptied");
  eq(mineAfter - mineBefore, inAccount, "USDG swept to the owner");
  step("account: sweep", { hash: sweepHash, usdg: inAccount });
  await shot("account-closed");

  // 4. Release free bond from the dashboard.
  await page.goto(`${BASE}/underwrite#your-offers`, { waitUntil: "load" });
  const bondBefore = await pub.readContract({ address: offer.cover, abi: coverAbi, functionName: "bond" });
  const input = page.locator(`[id="release-${offer.cover}"]`);
  await input.waitFor({ timeout: 30_000 });
  await input.fill("50");
  await input.locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]").getByRole("button", { name: "Release" }).click();
  const releaseHash = await txHashOf("Released to your wallet");
  const bondAfter = await pub.readContract({ address: offer.cover, abi: coverAbi, functionName: "bond" });
  eq(bondBefore - bondAfter, 50_000_000n, "released 50 USDG");
  step("underwrite: release 50 USDG of free bond", { hash: releaseHash, bondBefore, bondAfter });
  await shot("dashboard");

  // 5. The same facts, read with cast.
  const cast = (...args) => execFileSync("cast", [...args, "--rpc-url", RPC], { encoding: "utf8" }).trim();
  const checks = {
    "offer underwriter": cast("call", REPLAY, "offer(uint256)((address,address,address,bool))", String(offerId)),
    "bond after release": cast("call", offer.cover, "bond()(uint256)"),
    "premiums": cast("call", offer.cover, "premiums()(uint256)"),
    "market USDG": cast("call", USDG, "balanceOf(address)(uint256)", REPLAY),
    "allowance left": cast("call", USDG, "allowance(address,address)(uint256)", ME, offer.cover),
    "position (user, limit, status 3 = Closed, principal, reserve)": cast(
      "call",
      offer.cover,
      "position(address)((address,uint16,uint8,uint256,uint256))",
      account,
    ),
    "account USDG after sweep": cast("call", USDG, "balanceOf(address)(uint256)", account),
    "account released": cast("call", account, "released()(bool)"),
    "create tx status": cast("receipt", createHash, "status"),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`cast · ${k}: ${v}`);
  results.push({ step: "cast checks", ...checks });
} catch (e) {
  await shot("failure").catch(() => undefined);
  console.error("✗", e.message);
  process.exitCode = 1;
} finally {
  await writeFile(`${OUT}wallet-e2e-results.json`, JSON.stringify({ results, errors }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  if (errors.length) console.log("page errors:\n" + errors.join("\n"));
  await browser.close();
}
