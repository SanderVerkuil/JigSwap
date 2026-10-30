import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
const page = await ctx.newPage();
try {
  await page.goto(BASE + "/catalog", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => [...document.querySelectorAll('[data-slot="select-trigger"]')].map((b) => ({ html: b.innerHTML.slice(0, 300), ariaHidden: [...b.querySelectorAll("[aria-hidden]")].map((e) => e.tagName + ":" + e.getAttribute("aria-hidden")) })));
  console.log(JSON.stringify(info, null, 1));
  const snap = await page.locator("main").ariaSnapshot();
  console.log(snap.split("\n").slice(0, 14).join("\n"));
} finally { await ctx.close(); await browser.close(); }
