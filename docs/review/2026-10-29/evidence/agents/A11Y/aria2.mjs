import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
try {
  await page.goto(BASE + "/catalog", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  console.log((await page.locator('main').first().ariaSnapshot()).split('\n').slice(0,40).join('\n'));
  await page.goto(BASE + "/browse", { waitUntil: "networkidle" }).catch(()=>{});
} finally { await context.close(); await browser.close(); }
