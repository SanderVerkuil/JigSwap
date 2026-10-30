import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const variants = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
};
const which = process.argv[2];
const context = await browser.newContext({ ...variants[which], storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);
  const sec = page.locator('section[data-tour="dashboard-shelf"]');
  await sec.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await sec.screenshot({ path: `/tmp/jigswap-review/agents/ONB/${which}__shelf.jpg`, type: "jpeg", quality: 75 });
  const info = await page.evaluate(() => {
    const s = document.querySelector('section[data-tour="dashboard-shelf"]');
    const r = s.getBoundingClientRect();
    const canvas = s.querySelector("canvas");
    const plankBox = s.querySelector(".h-\\[300px\\], .md\\:h-\\[360px\\]");
    return { sectionH: Math.round(r.height), sectionW: Math.round(r.width), canvas: canvas ? `${canvas.width}x${canvas.height} css ${Math.round(canvas.getBoundingClientRect().width)}x${Math.round(canvas.getBoundingClientRect().height)}` : null, plankH: plankBox ? Math.round(plankBox.getBoundingClientRect().height) : null, vh: innerHeight };
  });
  console.log(JSON.stringify(info));
} finally {
  await context.close();
  await browser.close();
}
