// Visual QA: full-page screenshots at phone and desktop widths, reduced motion, and frames of the gap replay.
// Usage: node qa/shoot.mjs [baseUrl] [path]   (run `next build && next start -p <port>` first)
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:3107";
const path = process.argv[3] ?? "/";
const out = new URL(".", import.meta.url).pathname;
const slug = path === "/" ? "home" : path.replace(/\//g, "-").replace(/^-/, "");
await mkdir(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Step through the page so every scroll reveal fires, then return to the top.
async function scrollThrough(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 350) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await sleep(140);
  }
  await sleep(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
}

const browser = await chromium.launch();
const errors = [];
for (const [name, width, height] of [
  ["375", 375, 812],
  ["1440", 1440, 900],
]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${name}] console: ${m.text()}`));
  await page.goto(base + path, { waitUntil: "load" });
  await sleep(600);

  // Frames of the replay: scroll it into view and capture as it plays.
  const card = page.locator(".gr").first();
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded();
    const t0 = Date.now();
    for (const t of [700, 1800, 2700, 3300, 5200]) {
      await sleep(Math.max(0, t - (Date.now() - t0)));
      await card.screenshot({ path: `${out}${slug}-${name}-replay-${String(t).padStart(4, "0")}ms.png` });
    }
  }
  await scrollThrough(page);
  // Chromium's full-page capture restarts CSS animations on SVG; pin the replay to its final frame for this image.
  await page.addStyleTag({ content: ".gr [data-gr]{animation:none!important;opacity:1!important;transform:none!important}" });
  await sleep(300);
  await page.screenshot({ path: `${out}${slug}-${name}.png`, fullPage: true, animations: "disabled" });
  await page.screenshot({ path: `${out}${slug}-${name}-fold.png` });
  await ctx.close();

  const rctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const rpage = await rctx.newPage();
  rpage.on("pageerror", (e) => errors.push(`[${name} reduced] pageerror: ${e.message}`));
  await rpage.goto(base + path, { waitUntil: "load" });
  await sleep(500);
  await rpage.screenshot({ path: `${out}${slug}-${name}-reduced-motion.png`, fullPage: true, animations: "disabled" });
  await rctx.close();
}
await browser.close();
console.log(errors.length ? errors.join("\n") : "no page errors");
