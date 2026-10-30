import { chromium } from "/tmp/jigswap-review/tools/node_modules/playwright-core/index.mjs";
const BASE = "http://localhost:3001";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const variants = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};
const which = process.argv[2] || "mobile";
const route = process.argv[3] || "/dashboard";
const locale = process.argv[4];
const context = await browser.newContext({ ...variants[which], storageState: "/tmp/jigswap-review/tools/auth.json", ...(locale ? { locale } : {}) });
await context.addInitScript(() => { try { sessionStorage.setItem("jigswap.whatsNew.highlightShown", "1"); } catch {} });
const page = await context.newPage();
try {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const res = await page.evaluate(() => {
    const region = document.querySelector('[data-scroll-restoration-id="app-content"]');
    if (!region) return { none: true };
    const rr = region.getBoundingClientRect();
    const s = getComputedStyle(region);
    const info = { cls: region.className.toString(), ox: s.overflowX, oy: s.overflowY, cw: region.clientWidth, sw: region.scrollWidth, left: rr.left, right: rr.right };
    const out = [];
    for (const e of region.querySelectorAll("*")) {
      const r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > rr.left + region.clientWidth + 1) {
        let p = e.parentElement, clipped = false;
        while (p && p !== region) { const ps = getComputedStyle(p); if (["auto","scroll","hidden","clip"].includes(ps.overflowX)) { clipped = true; break; } p = p.parentElement; }
        if (clipped) continue;
        const anc = e.closest("[data-tour]")?.getAttribute("data-tour") || e.closest("section")?.querySelector("h2")?.innerText || "?"; out.push(`[${anc}] ${e.tagName}.${(e.className||'').toString().slice(0,110)} R=${Math.round(r.right - rr.left)} W=${Math.round(r.width)} pos=${getComputedStyle(e).position} text="${(e.innerText||'').trim().slice(0,40).replace(/\n/g,' ')}"`);
      }
    }
    info.offenders = out.slice(0, 30);
    return info;
  });
  console.log(JSON.stringify(res, null, 1));
} finally {
  await context.close();
  await browser.close();
}
