// READ-ONLY: measure which elements overflow the app-content region horizontally.
import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";

const BASE = "http://localhost:3001";
const [, , route = "/profile", vp = "mobile", out = ""] = process.argv;
const VPS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext({
  ...VPS[vp],
  storageState: "/tmp/jigswap-review/tools/auth.json",
});
await context.addInitScript(() => {
  try {
    sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1");
  } catch {}
});
const page = await context.newPage();
try {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const res = await page.evaluate(() => {
    const region = document.querySelector('[data-scroll-restoration-id="app-content"]');
    if (!region) return { err: "no region" };
    const rr = region.getBoundingClientRect();
    const offenders = [];
    for (const el of region.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > rr.right + 1) {
        offenders.push({
          tag: el.tagName,
          cls: (el.getAttribute("class") || "").slice(0, 120),
          text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
      }
    }
    return {
      regionClientWidth: region.clientWidth,
      regionScrollWidth: region.scrollWidth,
      regionRight: Math.round(rr.right),
      overflowXStyle: getComputedStyle(region).overflowX,
      offenders: offenders.slice(0, 25),
    };
  });
  console.log(JSON.stringify(res, null, 1));
  if (out) await page.screenshot({ path: out, type: "jpeg", quality: 70 });
} finally {
  await context.close();
  await browser.close();
}
