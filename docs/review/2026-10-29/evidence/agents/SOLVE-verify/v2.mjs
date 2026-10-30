// READ-ONLY: hover donut slices on desktop to read tooltip labels.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const c = await browser.newContext({ storageState: "/tmp/jigswap-review/tools/auth.json", locale: "en-GB", viewport: { width: 1440, height: 900 } });
await c.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await c.newPage();
try {
  await page.goto(BASE + "/insights", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const sectors = page.locator(".recharts-pie-sector path, .recharts-pie-sector");
  const n = await page.locator(".recharts-pie-sector").count();
  for (let i = 0; i < n; i++) {
    const s = page.locator(".recharts-pie-sector").nth(i);
    await s.scrollIntoViewIfNeeded();
    await s.hover({ force: true });
    await page.waitForTimeout(400);
    const tt = await page.evaluate(() => [...document.querySelectorAll(".recharts-tooltip-wrapper")].filter(w => getComputedStyle(w).visibility !== "hidden").map(w => w.innerText.replace(/\n/g, " / ")));
    console.log("sector", i, JSON.stringify(tt));
  }
  await page.screenshot({ path: "/tmp/jigswap-review/agents/SOLVE-verify/donut-hover-desktop.jpg", type: "jpeg", quality: 70 });
} finally { await c.close(); await browser.close(); }
