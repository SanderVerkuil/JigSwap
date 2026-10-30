import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  console.log("=== header aria");
  console.log(await page.locator('header').first().ariaSnapshot());
  await page.goto(BASE + "/puzzles/m9712xm5gtgnqszgq5xwvh82ph8a9hdz", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  console.log("=== puzzle main aria (first 80 lines)");
  const snap = await page.locator('main').first().ariaSnapshot();
  console.log(snap.split('\n').slice(0,90).join('\n'));
  // star radiogroup keyboard
  const g = page.locator('[role="radiogroup"]').first();
  console.log('radiogroup label:', await g.getAttribute('aria-label'));
  const tabs = await page.evaluate(()=>[...document.querySelectorAll('[role="radiogroup"] [role="radio"]')].map(b=>b.tabIndex));
  console.log('radio tabIndexes:', tabs);
  await page.goto(BASE + "/my-puzzles", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  console.log("=== my-puzzles main aria (first 60 lines)");
  console.log((await page.locator('main').first().ariaSnapshot()).split('\n').slice(0,60).join('\n'));
} finally { await context.close(); await browser.close(); }
