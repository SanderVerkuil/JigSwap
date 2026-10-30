import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const variants = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
};
const which = process.argv[2];
const steps = process.argv.slice(3);
const context = await browser.newContext({ ...variants[which], storageState: "/tmp/jigswap-review/tools/auth.json" });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  for (const s of steps) {
    await page.goto(BASE + "/welcome?step=" + s, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const out = `/tmp/jigswap-review/agents/ONB/${which}__welcome_${s}.jpg`;
    await page.screenshot({ path: out, type: "jpeg", quality: 70, fullPage: which === "mobile" });
    const info = await page.evaluate(() => ({
      eyebrow: document.querySelector('p[id^="_r_"], p.font-mono')?.innerText,
      h2: [...document.querySelectorAll("main h2")].map(h => h.innerText),
      buttons: [...document.querySelectorAll("main button, main a[href]")].filter(b => b.offsetParent).map(b => `${(b.innerText||b.getAttribute('aria-label')||'').trim().slice(0,30)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`).slice(0, 25),
    }));
    console.log(s, JSON.stringify(info));
  }
} finally {
  await context.close();
  await browser.close();
}
