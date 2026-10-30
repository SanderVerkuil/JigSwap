import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const OUT = "/tmp/jigswap-review/tiles/first-visit";
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const shots = [
  ["desktop", { viewport: { width: 1440, height: 900 } }, false, "/", "cookie-banner"],
  ["mobile", phone, false, "/", "cookie-banner"],
  ["mobile", phone, true, "/dashboard", "whats-new-modal"],
  ["tablet", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }, true, "/dashboard", "whats-new-modal"],
];
for (const [dev, opts, authed, route, label] of shots) {
  const ctx = await browser.newContext({ ...opts, ...(authed ? { storageState: "auth.json" } : {}) });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3001" + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/${dev}__${label}.jpg`, type: "jpeg", quality: 80 });
  await ctx.close();
}
await browser.close();
