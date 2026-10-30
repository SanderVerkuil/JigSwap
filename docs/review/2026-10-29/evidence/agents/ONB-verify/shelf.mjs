// READ-ONLY: goto + measure only.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const variants = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
for (const which of ["mobile", "tablet", "desktop"]) {
  const context = await browser.newContext({ ...variants[which], storageState: "/tmp/jigswap-review/tools/auth.json" });
  await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); localStorage.setItem("jigswap.installTip", JSON.stringify({ visits: 1, snoozedUntil: null, never: true })); } catch {} });
  const page = await context.newPage();
  try {
    await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);
    const res = await page.evaluate(() => {
      const sec = document.querySelector('section[data-tour="dashboard-shelf"]');
      const holder = sec?.querySelector('.h-\\[300px\\]');
      const r = (el) => el ? (({ left, right, width, height, top }) => ({ l: Math.round(left), r: Math.round(right), w: Math.round(width), h: Math.round(height), t: Math.round(top) }))(el.getBoundingClientRect()) : null;
      const container = holder?.firstElementChild;
      const fallback = container?.firstElementChild; // absolute layer
      const plank = fallback?.firstElementChild;
      const canvas = holder?.querySelector("canvas");
      const region = document.querySelector('[data-scroll-restoration-id]');
      return { holder: r(holder), fallbackLayer: r(fallback), fallbackOpacity: fallback && getComputedStyle(fallback).opacity, plank: r(plank), canvas: r(canvas), canvasPx: canvas ? [canvas.width, canvas.height] : null, regionCW: region?.clientWidth, regionSW: region?.scrollWidth, secH: r(sec)?.h };
    });
    console.log(which, JSON.stringify(res));
    const sec = page.locator('section[data-tour="dashboard-shelf"]');
    await sec.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await sec.screenshot({ path: `/tmp/jigswap-review/agents/ONB-verify/${which}__shelf.jpg`, type: "jpeg", quality: 70 });
  } finally {
    await context.close();
  }
}
await browser.close();
