// Visual QA for the wallet flows: /underwrite (each step), /cover, /account/[address], at 375px and 1440px.
// Usage: node qa/wallet-shots.mjs [baseUrl] [account] [suffix]   (a dev or prod server; e2e wallet optional)
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3102";
const account = process.argv[3] ?? "0xB792735F30906101a95Bc4e9dca4fd0f1193eBEa";
const suffix = process.argv[4] ? `-${process.argv[4]}` : "";
const out = new URL(".", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function settle(page) {
  // Let reveals run and chain reads land, then return to the top so the sticky header sits where it belongs.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await sleep(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(900);
}

const browser = await chromium.launch();
for (const [name, width, height] of [
  ["375", 375, 812],
  ["1440", 1440, 900],
]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${name}] ${page.url()} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${name}] ${page.url()} console: ${m.text().slice(0, 200)}`));
  const shoot = async (slug) => {
    await settle(page);
    await page.screenshot({ path: `${out}${slug}${suffix}-${name}.png`, fullPage: true, animations: "disabled" });
  };

  await page.goto(`${base}/underwrite`, { waitUntil: "load" });
  await sleep(2500);
  await shoot("underwrite-1-agent");
  await page.getByRole("radio", { name: "Back Bold" }).click();
  await page.getByRole("button", { name: /Set terms for Bold/ }).click();
  await sleep(1500);
  await shoot("underwrite-2-terms");
  await page.getByRole("button", { name: /Review and sign/ }).click();
  await sleep(2500);
  await shoot("underwrite-3-sign");

  await page.goto(`${base}/cover`, { waitUntil: "load" });
  await sleep(4000);
  await shoot("cover");
  await page.goto(`${base}/cover?market=live&offer=0`, { waitUntil: "load" });
  await sleep(3000);
  await page.getByRole("button", { name: "Tighten the rules" }).click();
  await sleep(500);
  await shoot("cover-live-rules");

  await page.goto(`${base}/account/${account}`, { waitUntil: "load" });
  await sleep(6000);
  await shoot("account");
  await page.goto(`${base}/account/0x000000000000000000000000000000000000dEaD`, { waitUntil: "load" });
  await sleep(4000);
  await shoot("account-not-found");
  await ctx.close();
}
await browser.close();
console.log(errors.length ? errors.join("\n") : "no page errors");
