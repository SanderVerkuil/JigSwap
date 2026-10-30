import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const variants = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
const which = process.argv[2];
const context = await browser.newContext({ ...variants[which], storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + "/whats-new?tab=guides", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/jigswap-review/agents/ONB/${which}__guides.jpg`, type: "jpeg", quality: 70, fullPage: which === "mobile" });
  const info = await page.evaluate(() => {
    const region = document.querySelector('[data-scroll-restoration-id="app-content"]');
    return {
      h: (which => 0)(),
      docH: document.documentElement.scrollHeight, regionH: region?.scrollHeight,
      cards: document.querySelectorAll('article[id^="guide-"]').length,
      buttons: [...document.querySelectorAll("main article button")].filter(b=>b.offsetParent).map(b => `${b.innerText.trim()} ${Math.round(b.getBoundingClientRect().height)}`).slice(0,12),
      progress: document.querySelector("main p.text-muted-foreground")?.innerText,
    };
  });
  console.log(JSON.stringify(info));
  // dashboard: is there any entry point to guides/tours?
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const links = await page.evaluate(() => [...document.querySelectorAll("a[href*='whats-new'], button")].filter(e => /guide|tour|rondleiding|what's new/i.test(e.innerText + (e.getAttribute('aria-label')||''))).map(e => `${e.tagName} ${e.innerText.trim().slice(0,30)} vis=${!!e.offsetParent}`));
  console.log("dashboard guide/tour entry points:", JSON.stringify(links));
} finally {
  await context.close();
  await browser.close();
}
