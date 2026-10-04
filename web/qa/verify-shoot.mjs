import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const base = "http://localhost:3106";
const A = { bold: "0xB792735F30906101a95Bc4e9dca4fd0f1193eBEa", carR: "0xdc1F0d950cbDC20643cf243e953b10a62E82A0c1", carL: "0xa93962d5d44Ff3F0809754d555924389Fe3A0C0C", boldL: "0x4462A953Db52Cda1fbd745e29cc62E72943Ed9F4" };
const paths = ["/", "/market", "/live", "/party", "/agent/0x230d2a366d7724a6f5F416BB1d80299BC8E487eF", "/agent/0x5B01856061892171408195372c0D94B0b58352E7", `/account/${A.bold}`, `/account/${A.carL}`, "/judge", `/badge/${A.bold}`];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const errs = []; const texts = {};
for (const [w, h] of [[375, 812], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(`[${w}] pageerror ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errs.push(`[${w}] console ${m.text().slice(0, 200)}`));
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: "load" });
    await sleep(2500);
    const hgt = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < hgt; y += 400) { await page.evaluate((t) => scrollTo(0, t), y); await sleep(80); }
    await page.evaluate(() => scrollTo(0, 0)); await sleep(300);
    const slug = (p === "/" ? "home" : p.replace(/\//g, "-").replace(/^-/, "")).slice(0, 40);
    await page.screenshot({ path: `qa/verify-${slug}-${w}.png`, fullPage: p.startsWith("/badge") ? false : true, timeout: 90000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) errs.push(`[${w}] horizontal overflow ${p}`);
    if (w === 1440 && !p.startsWith("/badge")) texts[p] = await page.evaluate(() => document.body.innerText);
  }
  await ctx.close();
}
await browser.close();
writeFileSync("qa/verify-texts.json", JSON.stringify(texts, null, 1));
console.log(errs.length ? errs.join("\n") : "no errors");
